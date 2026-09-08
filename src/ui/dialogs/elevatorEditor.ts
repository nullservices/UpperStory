import { configureDialog } from './accessibility';
import { CONFIG } from '../../data/config';
import type { ElevatorGroup } from '../../sim';
import { elevatorCapacity } from '../../sim/elevators';

/**
 * Actions the controller hands the dialog: each wraps a sim command and
 * routes failures back through setError(). `close` hides the dialog.
 */
export interface ElevatorEditorActions {
  addCar(): void;
  removeCar(carId: number): void;
  upgrade(carId: number): void;
  close(): void;
}

const C = {
  overlay: 'rgba(38,62,52,0.18)',
  bg: '#eceee3',
  panel: '#e0e6d8',
  text: '#34463f',
  dim: '#758170',
  accent: '#3f6958',
  danger: '#a34835',
  hover: '#d1ddc8',
};

const ROW_REFRESH_MS = 250;

/**
 * Elevator shaft editor: per-car rows (speed level, passengers aboard) with
 * upgrade/remove buttons, an "add car" footer, and an error line. Cars move
 * while the dialog is open (the sim keeps ticking behind it), so the rows
 * re-read the live group on an interval.
 */
export class ElevatorEditor {
  /** Invoked when the dialog closes itself; lets the controller tidy up. */
  onClose: (() => void) | null = null;

  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly errorEl: HTMLDivElement;
  private readonly addCarBtn: HTMLButtonElement;
  private readonly rowEls = new Map<
    number,
    {
      row: HTMLDivElement;
      label: HTMLSpanElement;
      speedBtn: HTMLButtonElement;
      removeBtn: HTMLButtonElement;
    }
  >();

  private group: ElevatorGroup | null = null;
  private actions: ElevatorEditorActions | null = null;
  private timer: number | null = null;
  private visible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:fixed;inset:0;z-index:40;display:none;align-items:center;' +
      'justify-content:center;background:' + C.overlay;
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    const panel = document.createElement('div');
    panel.style.cssText =
      `background:${C.bg};border:1px solid ${C.panel};border-radius:8px;` +
      'padding:16px;min-width:340px;max-width:420px;box-sizing:border-box;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);font:12px sans-serif;color:' + C.text;
    configureDialog(this.overlay, panel, 'Elevator management', () => this.close());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'position:absolute;top:6px;right:8px;background:none;border:none;' +
      `color:${C.dim};font:16px sans-serif;cursor:pointer;padding:2px 6px`;
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', () => this.hide());

    this.title = document.createElement('div');
    this.title.style.cssText = 'font-weight:700;margin:2px 26px 10px 0;';

    const body = document.createElement('div');
    body.style.cssText = `background:${C.panel};border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;`;
    this.rows = document.createElement('div');
    this.rows.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    body.appendChild(this.rows);

    this.errorEl = document.createElement('div');
    this.errorEl.style.cssText = `color:${C.danger};font-size:11px;margin-top:8px;min-height:0;`;
    this.errorEl.textContent = ' ';

    this.addCarBtn = this.button(`Add car ($${fmt(CONFIG.ELEVATOR_CAR_COST_DOLLARS)})`);
    this.addCarBtn.style.marginTop = '6px';
    this.addCarBtn.addEventListener('click', () => this.actions?.addCar());

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;';
    footer.appendChild(this.addCarBtn);

    panel.append(closeBtn, this.title, body, this.errorEl, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(group: ElevatorGroup, actions: ElevatorEditorActions): void {
    this.group = group;
    this.actions = actions;
    this.clearError();
    this.overlay.style.display = 'flex';
    this.visible = true;
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), ROW_REFRESH_MS);
  }

  close(): void {
    this.hide();
  }

  /** Show a sim error (e.g. "Not enough funds") under the controls. */
  setError(message: string): void {
    this.errorEl.textContent = message;
  }

  clearError(): void {
    this.errorEl.textContent = ' ';
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = 'none';
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.onClose?.();
  }

  private refresh(): void {
    const group = this.group;
    if (!group || !this.visible) return;
    this.title.textContent = `Elevator — floors ${floorLabel(group.serviceLo)}–${floorLabel(group.serviceHi)}`;
    this.addCarBtn.hidden = group.cars.length >= CONFIG.MAX_CARS_PER_SHAFT;

    // One row per car; rows are keyed by car id so buttons stay stable.
    const seen = new Set<number>();
    for (const car of group.cars) {
      seen.add(car.id);
      let row = this.rowEls.get(car.id);
      if (!row) {
        row = this.makeRow(car.id);
        this.rowEls.set(car.id, row);
      }
      row.label.textContent = carText(car.id, car.speedLevel, car.passengers.length) + ` / ${elevatorCapacity(group.kind)} capacity`;
      row.speedBtn.hidden = car.speedLevel >= CONFIG.ELEVATOR_SPEED_LEVELS.length;
      row.removeBtn.hidden = group.cars.length <= 1;
    }
    for (const [carId, row] of this.rowEls) {
      if (seen.has(carId)) continue;
      row.row.remove();
      this.rowEls.delete(carId);
    }
  }

  private makeRow(
    carId: number,
  ): {
    row: HTMLDivElement;
    label: HTMLSpanElement;
    speedBtn: HTMLButtonElement;
    removeBtn: HTMLButtonElement;
  } {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:8px;background:' + C.bg +
      ';border-radius:4px;padding:5px 7px;';

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const speedBtn = this.button(`Speed ↑ ($${fmt(CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS)})`);
    speedBtn.addEventListener('click', () => this.actions?.upgrade(carId));
    const removeBtn = this.button('Remove');
    removeBtn.style.color = C.danger;
    removeBtn.addEventListener('click', () => this.actions?.removeCar(carId));

    row.append(label, speedBtn, removeBtn);
    this.rows.appendChild(row);
    return { row, label, speedBtn, removeBtn };
  }

  private button(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText =
      `background:${C.panel};color:${C.text};border:1px solid #a5b39b;` +
      'border-radius:3px;padding:3px 8px;font:11px sans-serif;cursor:pointer;white-space:nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = C.hover;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = C.panel;
    });
    return btn;
  }
}

function fmt(dollars: number): string {
  return dollars.toLocaleString('en-US');
}

function carText(id: number, speedLevel: number, passengers: number): string {
  return `Car ${id} · speed Lv ${speedLevel} · ${passengers} aboard`;
}

function floorLabel(floor: number): string {
  return floor === CONFIG.BASEMENT_FLOOR_INDEX ? 'B1' : String(floor);
}
