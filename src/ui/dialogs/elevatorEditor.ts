import { configureDialog } from './accessibility';
import { keepInView, placeNear } from '../windowing';
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
  /** Paid manual repair of an out-of-service car. */
  repair(carId: number): void;
  home(carId: number, floor: number | null): void;
  priority(day: 'weekday' | 'weekend', period: number, priority: ElevatorPriority): void;
  response(day: 'weekday' | 'weekend', period: number, floors: number): void;
  departure(day: 'weekday' | 'weekend', period: number, seconds: number): void;
  stop(floor: number, enabled: boolean): void;
  /** Maintenance offices looking after this shaft (0 = uncovered). */
  maintenanceOffices?(): number;
  close(): void;
}

const C = {
  overlay: 'rgba(20,32,48,0.10)',
  bg: '#dededa',
  panel: '#fbfbf7',
  text: '#1f2933',
  dim: '#5b6470',
  accent: '#2a64b4',
  danger: '#b3261e',
  hover: '#e3ecf8',
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
  /** Live game tick, for mechanics' arrival countdowns. */
  now: () => number = () => 0;
  private readonly rowEls = new Map<
    number,
    {
      row: HTMLDivElement;
      label: HTMLSpanElement;
      status: HTMLSpanElement;
      speedBtn: HTMLButtonElement;
      removeBtn: HTMLButtonElement;
      repairBtn: HTMLButtonElement;
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
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.textContent = ' ';

    this.addCarBtn = this.button('Add car');
    this.addCarBtn.style.marginTop = '6px';
    this.addCarBtn.addEventListener('click', () => this.actions?.addCar());

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;';
    footer.appendChild(this.addCarBtn);

    this.schedules.style.cssText = 'margin:12px 0;line-height:1.6';
    this.stops.style.cssText = 'margin:12px 0;line-height:1.6';
    // Opening a section grows the window: keep it on screen.
    for (const section of [this.schedules, this.stops]) section.addEventListener('toggle', () => keepInView(panel));
    this.runningCost.style.cssText = 'font-size:11px;line-height:1.6';
    panel.append(closeBtn, this.title, body, this.runningCost, this.schedules, this.stops, this.errorEl, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(group: ElevatorGroup, actions: ElevatorEditorActions, anchor?: { x: number; y: number }): void {
    this.group = group;
    this.actions = actions;
    this.renderSchedules();
    this.renderStops();
    this.clearError();
    this.overlay.style.display = 'flex';
    this.visible = true;
    // Build the car rows first so the window is placed at its real size.
    this.refresh();
    if (anchor) placeNear(this.overlay.firstElementChild as HTMLElement, anchor.x, anchor.y);
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
    const kind = group.kind === 'service' ? 'Service elevator' : group.kind === 'express' ? 'Express elevator' : 'Elevator';
    // Runs every ROW_REFRESH_MS: write the DOM only when text changes.
    setText(this.title, `${kind} · floors ${floorLabel(group.serviceLo)}–${floorLabel(group.serviceHi)}`);
    this.addCarBtn.hidden = group.cars.length >= CONFIG.MAX_CARS_PER_SHAFT;
    setText(this.addCarBtn, `Add car ($${fmt(CONFIG.ELEVATOR_PRICES[group.kind].car)})`);
    const prices = CONFIG.ELEVATOR_PRICES[group.kind];
    const offices = this.actions?.maintenanceOffices?.() ?? 0;
    const coverage = offices > 0
      ? `Maintenance: looked after by ${offices} office${offices === 1 ? '' : 's'}; broken cars are repaired for free.`
      : 'Maintenance: no office covers this shaft. Build Maintenance within 15 floors of one of its stops, or repair broken cars yourself.';
    setText(this.runningCost, `${coverage} Quarterly upkeep: $${fmt(prices.shaftUpkeepQuarter)} for the shaft + $${fmt(prices.carUpkeepQuarter)} per car. Total: $${fmt(prices.shaftUpkeepQuarter + group.cars.length * prices.carUpkeepQuarter)}. Charged across the three days of the quarter.`);

    // One row per car; rows are keyed by car id so buttons stay stable.
    const seen = new Set<number>();
    for (const [index, car] of group.cars.entries()) {
      seen.add(car.id);
      let row = this.rowEls.get(car.id);
      if (!row) {
        row = this.makeRow(car.id);
        this.rowEls.set(car.id, row);
      }
      // Car ids are tower-wide; players count the cars of this shaft.
      const label = `Car ${index + 1} · speed ${car.speedLevel} · ${car.passengers.length}/${elevatorCapacity(group.kind)} aboard`;
      if (row.label.textContent !== label) row.label.textContent = label;
      row.label.title = `${car.passengers.length} passengers aboard; capacity ${elevatorCapacity(group.kind)}`;
      row.home.setAttribute('aria-label', `Car ${index + 1} home floor`);
      const broken = car.outOfService === true;
      row.row.style.boxShadow = broken ? `inset 3px 0 ${C.danger}` : '';
      row.repairBtn.hidden = !broken;
      row.status.style.color = broken ? C.danger : C.dim;
      const status = broken
        ? `Out of service at ${floorLabel(Math.round(car.y))} · ${car.repairAtTick !== undefined
          ? `mechanics arriving in ${Math.max(1, Math.ceil((car.repairAtTick - this.now()) / 10))}s`
          : offices > 0 ? 'waiting for a free mechanic' : 'no mechanics cover this shaft — repair it or build Maintenance'}`
        : car.state === 'moving' && car.targetFloor !== null
        ? `${car.dir > 0 ? 'Going up' : 'Going down'} to ${floorLabel(car.targetFloor)}`
        : `${car.state === 'doors' ? (car.departureAt !== undefined && car.doorsTicksLeft <= 0 ? 'Waiting to depart' : 'Doors open') : 'Idle'} at ${floorLabel(Math.round(car.y))}`;
      if (row.status.textContent !== status) row.status.textContent = status;
      row.speedBtn.hidden = car.speedLevel >= CONFIG.ELEVATOR_SPEED_LEVELS.length;
      row.removeBtn.hidden = group.cars.length <= 1;
      const homeOptions = `${group.stops.join(',')}:${car.homeFloor == null}`;
      if (row.home.dataset.stops !== homeOptions) {
        row.home.replaceChildren();
        if (car.homeFloor == null) row.home.add(new Option('Unassigned (legacy save)', ''));
        for (const floor of group.stops) row.home.add(new Option(`Home: ${floorLabel(floor)}`, String(floor)));
        row.home.dataset.stops = homeOptions;
      }
      row.home.value = car.homeFloor == null ? '' : String(car.homeFloor);
      row.home.disabled = group.kind === 'express';
      row.home.title = group.kind === 'express'
        ? 'Express elevator waiting floors cannot be reassigned.'
        : 'Where this car waits when idle.';
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
    status: HTMLSpanElement;
    speedBtn: HTMLButtonElement;
    removeBtn: HTMLButtonElement;
    repairBtn: HTMLButtonElement;
    home: HTMLSelectElement;
  } {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:' + C.bg +
      ';border-radius:4px;padding:5px 7px;';

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const speedBtn = this.button(`Faster ($${fmt(CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS)})`);
    speedBtn.title = 'Upgrade this car to the next speed level';
    speedBtn.addEventListener('click', () => this.actions?.upgrade(carId));
    const removeBtn = this.button('Remove');
    removeBtn.title = 'Remove this car (no refund)';
    removeBtn.classList.add('danger');
    removeBtn.addEventListener('click', () => this.actions?.removeCar(carId));
    const repairBtn = this.button(`Repair ($${fmt(CONFIG.ELEVATOR_REPAIR_COST_DOLLARS)})`);
    repairBtn.classList.add('armed');
    repairBtn.title = 'Return this car to service now';
    repairBtn.addEventListener('click', () => this.actions?.repair(carId));
    repairBtn.hidden = true;

    const home = document.createElement('select');
    home.onchange = () => this.actions?.home(carId, home.value === '' ? null : Number(home.value));
    const status = document.createElement('span');
    status.style.cssText = `flex-basis:100%;color:${C.dim};font-size:11px;`;
    row.append(label, repairBtn, speedBtn, removeBtn, home, status);
    this.rows.appendChild(row);
    return { row, label, status, speedBtn, removeBtn, repairBtn, home };
  }

  private renderSchedules(): void {
    this.schedules.replaceChildren();
    const summary = document.createElement('summary'); summary.textContent = 'Weekday & weekend service'; this.schedules.append(summary);
    const help = document.createElement('p'); help.textContent = 'Priority chooses which waiting calls empty cars serve first. A changed home is visited before new pickups, after delivering riders already aboard. Cars then return home whenever no calls remain.';
    const responseHelp = document.createElement('p');
    responseHelp.textContent = 'Resp. (waiting-car response): how many floors closer an idle car must be to take a call from an approaching moving car. Lower values use idle cars sooner. Default: 5 floors.';
    const departureHelp = document.createElement('p');
    departureHelp.textContent = 'Delay (departure delay): the minimum stop time in game seconds. Doors stay open for later arrivals. Default: 0; normal boarding time still applies. Changes apply at the next stop.';
    this.schedules.append(help, responseHelp, departureHelp);
    // One compact row per period: priority, response and delay for weekdays, then weekends.
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto repeat(2,minmax(84px,1fr) 52px 52px);gap:4px 6px;align-items:center;line-height:1.3;overflow-x:auto';
    const head = (text: string, span = 1, title = ''): void => {
      const strong = document.createElement('strong'); strong.textContent = text; if (title) strong.title = title;
      strong.style.cssText = `grid-column:span ${span};font-size:11px`; grid.append(strong);
    };
    head('Period'); head('Weekday', 3); head('Weekend', 3);
    head('');
    for (let i = 0; i < 2; i++) { head('Priority'); head('Resp.', 1, 'Waiting-car response, in floors'); head('Delay', 1, 'Departure delay, in seconds'); }
    for (const [period, data] of SERVICE_PERIODS.entries()) {
      const time = document.createElement('span'); time.textContent = data.label; time.style.whiteSpace = 'nowrap'; grid.append(time);
      for (const day of ['weekday', 'weekend'] as const) {
        const select = document.createElement('select'); select.setAttribute('aria-label', `${day} ${data.label} priority`);
        for (const [value, label] of [['normal', 'Normal'], ['up', 'Up first'], ['down', 'Down first']]) select.add(new Option(label, value));
        select.value = this.group?.schedule?.[day][period] ?? 'normal';
        select.onchange = () => this.actions?.priority(day, period, select.value as ElevatorPriority);
        const response = document.createElement('input'); response.type = 'number'; response.min = '0'; response.max = '100'; response.step = '1';
        response.style.cssText = 'width:100%;box-sizing:border-box';
        response.title = 'Waiting-car response (floors)';
        response.setAttribute('aria-label', `${day} ${data.label} waiting-car response`);
        response.value = String(this.group?.waitingResponse?.[day][period] ?? 5);
        response.onchange = () => {
          this.actions?.response(day, period, response.value === '' ? NaN : Number(response.value));
          response.value = String(this.group?.waitingResponse?.[day][period] ?? 5);
        };
        const departure = document.createElement('input'); departure.type = 'number'; departure.min = '0'; departure.max = '300'; departure.step = '1';
        departure.style.cssText = 'width:100%;box-sizing:border-box';
        departure.title = 'Departure delay (seconds)';
        departure.setAttribute('aria-label', `${day} ${data.label} departure delay`);
        departure.value = String(this.group?.departureDelay?.[day][period] ?? 0);
        departure.onchange = () => {
          this.actions?.departure(day, period, departure.value === '' ? NaN : Number(departure.value));
          departure.value = String(this.group?.departureDelay?.[day][period] ?? 0);
        };
        grid.append(select, response, departure);
      }
    }
    this.schedules.append(grid);
  }

  private renderStops(): void {
    this.stops.replaceChildren();
    const summary = document.createElement('summary'); summary.textContent = 'Floors served';
    const help = document.createElement('p'); help.textContent = 'Uncheck a floor to exclude it from new trips. People already on their way finish their trips. Move every car assigned to this home floor before disabling its stop.';
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:180px;overflow:auto';
    const group = this.group!;
    if (group.kind === 'express') help.textContent = 'Express stops are fixed at the lobby, basement levels and sky lobbies. Unchecked stops from older saves can be restored.';
    for (const floor of [...group.stops, ...(group.disabledStops ?? [])].sort((a, b) => a - b)) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = group.stops.includes(floor);
      checkbox.disabled = group.kind === 'express' && checkbox.checked;
      checkbox.setAttribute('aria-label', `Serve floor ${floorLabel(floor)}`);
      checkbox.onchange = () => {
        this.actions?.stop(floor, checkbox.checked);
        checkbox.checked = group.stops.includes(floor);
        checkbox.disabled = group.kind === 'express' && checkbox.checked;
      };
      label.append(checkbox, ` ${floorLabel(floor)}`); grid.append(label);
    }
    this.stops.append(summary, help, grid);
  }

  /** A button in the shared window style (src/ui/style.css). */
  private button(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    return btn;
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function fmt(dollars: number): string {
  return dollars.toLocaleString('en-US');
}

function floorLabel(floor: number): string {
  return floor <= 0 ? `B${1 - floor}` : String(floor);
}
