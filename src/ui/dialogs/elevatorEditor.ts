import { configureDialog } from './accessibility';
import { CONFIG } from '../../data/config';
import type { ElevatorGroup } from '../../sim';
import { elevatorCapacity, SERVICE_PERIODS, type ElevatorPriority } from '../../sim/elevators';

/**
 * Actions the controller hands the dialog: each wraps a sim command and
 * routes failures back through setError(). `close` hides the dialog.
 */
export interface ElevatorEditorActions {
  addCar(): void;
  removeCar(carId: number): void;
  upgrade(carId: number): void;
  home(carId: number, floor: number | null): void;
  priority(day: 'weekday' | 'weekend', period: number, priority: ElevatorPriority): void;
  stop(floor: number, enabled: boolean): void;
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
  private readonly schedules = document.createElement('details');
  private readonly stops = document.createElement('details');
  private readonly runningCost = document.createElement('p');
  private readonly rowEls = new Map<
    number,
    {
      row: HTMLDivElement;
      label: HTMLSpanElement;
      speedBtn: HTMLButtonElement;
      removeBtn: HTMLButtonElement;
      home: HTMLSelectElement;
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
      'padding:16px;width:560px;max-width:95vw;max-height:90vh;overflow:auto;box-sizing:border-box;position:relative;' +
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

    this.addCarBtn = this.button('Add car');
    this.addCarBtn.style.marginTop = '6px';
    this.addCarBtn.addEventListener('click', () => this.actions?.addCar());

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;';
    footer.appendChild(this.addCarBtn);

    this.schedules.style.cssText = 'margin:16px 0;line-height:1.7';
    this.stops.style.cssText = 'margin:16px 0;line-height:1.7';
    this.runningCost.style.cssText = 'font-size:11px;line-height:1.6';
    panel.append(closeBtn, this.title, body, this.runningCost, this.schedules, this.stops, this.errorEl, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(group: ElevatorGroup, actions: ElevatorEditorActions): void {
    this.group = group;
    this.actions = actions;
    this.renderSchedules();
    this.renderStops();
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
    this.addCarBtn.textContent = `Add car ($${fmt(CONFIG.ELEVATOR_PRICES[group.kind].car)})`;
    const prices = CONFIG.ELEVATOR_PRICES[group.kind];
    this.runningCost.textContent = `Quarterly upkeep: $${fmt(prices.shaftUpkeepQuarter)} for the shaft + $${fmt(prices.carUpkeepQuarter)} per car. Total: $${fmt(prices.shaftUpkeepQuarter + group.cars.length * prices.carUpkeepQuarter)}. Charged across the three days of the quarter.`;

    // One row per car; rows are keyed by car id so buttons stay stable.
    const seen = new Set<number>();
    for (const car of group.cars) {
      seen.add(car.id);
      let row = this.rowEls.get(car.id);
      if (!row) {
        row = this.makeRow(car.id);
        this.rowEls.set(car.id, row);
      }
      row.label.textContent = `Car ${car.id} · Lv${car.speedLevel} · ${car.passengers.length}/${elevatorCapacity(group.kind)}`;
      row.label.title = `${car.passengers.length} passengers aboard; capacity ${elevatorCapacity(group.kind)}`;
      row.speedBtn.hidden = car.speedLevel >= CONFIG.ELEVATOR_SPEED_LEVELS.length;
      row.removeBtn.hidden = group.cars.length <= 1;
      if (row.home.dataset.stops !== group.stops.join(',')) {
        row.home.replaceChildren(new Option('Stay where idle', ''));
        for (const floor of group.stops) row.home.add(new Option(`Home: ${floorLabel(floor)}`, String(floor)));
        row.home.dataset.stops = group.stops.join(',');
      }
      row.home.value = car.homeFloor == null ? '' : String(car.homeFloor);
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
    home: HTMLSelectElement;
  } {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:' + C.bg +
      ';border-radius:4px;padding:5px 7px;';

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const speedBtn = this.button(`Speed ↑ ($${fmt(CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS)})`);
    speedBtn.addEventListener('click', () => this.actions?.upgrade(carId));
    const removeBtn = this.button('Remove');
    removeBtn.style.color = C.danger;
    removeBtn.addEventListener('click', () => this.actions?.removeCar(carId));

    const home = document.createElement('select'); home.setAttribute('aria-label', `Car ${carId} home floor`);
    home.onchange = () => this.actions?.home(carId, home.value === '' ? null : Number(home.value));
    row.append(label, speedBtn, removeBtn, home);
    this.rows.appendChild(row);
    return { row, label, speedBtn, removeBtn, home };
  }

  private renderSchedules(): void {
    this.schedules.replaceChildren();
    const summary = document.createElement('summary'); summary.textContent = 'Weekday & weekend service'; this.schedules.append(summary);
    const help = document.createElement('p'); help.textContent = 'Priority chooses which waiting calls empty cars serve first. Passengers already aboard keep their destinations. Idle cars return to their home floors when no calls remain.';
    this.schedules.append(help);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center';
    for (const title of ['Period', 'Weekday', 'Weekend']) { const strong = document.createElement('strong'); strong.textContent = title; grid.append(strong); }
    for (const [period, data] of SERVICE_PERIODS.entries()) {
      const time = document.createElement('span'); time.textContent = data.label; grid.append(time);
      for (const day of ['weekday', 'weekend'] as const) {
        const select = document.createElement('select'); select.setAttribute('aria-label', `${day} ${data.label} priority`);
        for (const [value, label] of [['normal', 'Normal'], ['up', 'Up first'], ['down', 'Down first']]) select.add(new Option(label, value));
        select.value = this.group?.schedule?.[day][period] ?? 'normal';
        select.onchange = () => this.actions?.priority(day, period, select.value as ElevatorPriority);
        grid.append(select);
      }
    }
    this.schedules.append(grid);
  }

  private renderStops(): void {
    this.stops.replaceChildren();
    const summary = document.createElement('summary'); summary.textContent = 'Floors served';
    const help = document.createElement('p'); help.textContent = 'Uncheck a floor to exclude it from new trips. People already on their way finish their trips. Disabling a car’s home floor clears its home assignment.';
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:180px;overflow:auto';
    const group = this.group!;
    for (const floor of [...group.stops, ...(group.disabledStops ?? [])].sort((a, b) => a - b)) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = group.stops.includes(floor);
      checkbox.setAttribute('aria-label', `Serve floor ${floorLabel(floor)}`);
      checkbox.onchange = () => { this.actions?.stop(floor, checkbox.checked); checkbox.checked = group.stops.includes(floor); };
      label.append(checkbox, ` ${floorLabel(floor)}`); grid.append(label);
    }
    this.stops.append(summary, help, grid);
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

function floorLabel(floor: number): string {
  return floor <= 0 ? `B${1 - floor}` : String(floor);
}
