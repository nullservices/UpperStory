import { configureDialog } from './accessibility';
import { placeNear } from '../windowing';
import { TOOL_INFO } from '../toolPalette';
import type { HousekeepingAccess } from '../../sim/housekeepingAccess';
import { hotelCheckoutCents } from '../../sim/hotelEconomy';
import { apartmentQuarterRentCents, officeQuarterRentCents, officeRentScoreAdjustment } from '../../sim/money';
import { condoSaleCents } from '../../sim/condoEconomy';
import { commercialOpeningMinute } from '../../sim/commercialPopulation';
import { formatTimeOfDay } from '../../sim/time';
import { CONFIG, TENANT_DATA, isHotel } from '../../data/config';
import type { Tenant, TenantType } from '../../sim';
import { voicesFromFacts, type Voice } from '../../sim/complaints';

/** Snapshot data the controller computed from live sim state at open time. */
export interface TenantInfoData {
  /** Mean stress of the tenant's current people (0 when empty). */
  avgStress: number;
  /** People currently attached to the tenant. */
  occupancy: number;
  housekeepingFloors?: number[];
  cleaningRemaining?: number[];
  housekeepingAccess?: HousekeepingAccess;
  /** Maintenance offices only. */
  maintenance?: { shafts: number; totalShafts: number; crews: number; busy: number };
  lobbyUpkeepQuarter?: number;
  officeLeaseDaysRemaining?: number;
  condoAccess?: boolean;
  noiseSources?: { type: TenantType; x: number; floor: number; floorDistance: number; gap: number; clearance: number }[];
  /** Tenant voices from live state (`tenantVoices`); derived from the fields above when absent. */
  voices?: Voice[];
}

/**
 * Actions the controller hands the dialog. `demolish` performs the sim
 * command (confirming is the dialog's own job); `cyclePricing` steps the
 * tenant's pricing level (commercial types only); `close` hides it.
 */
export interface TenantInfoActions {
  demolish(): void;
  repair(): void;
  changeMovie(): void;
  cyclePricing(): void;
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

/**
 * Info popup for a tenant under the select tool: type, floor, state,
 * occupancy, average person stress, evaluation grade, pricing (commercial)
 * and hotel cleanliness, plus a two-step demolish button. Rows re-read the
 * live tenant object, so a pricing change refreshes in place.
 */
export class TenantInfo {
  /** Invoked when the dialog closes itself; lets the controller tidy up. */
  onClose: (() => void) | null = null;

  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly errorEl: HTMLDivElement;
  private readonly demolishBtn: HTMLButtonElement;

  private tenant: Tenant | null = null;
  private actions: TenantInfoActions | null = null;
  private visible = false;
  private armed = false;
  /** Occupancy/stress snapshot from open time, kept for refresh(). */
  private lastData: TenantInfoData | null = null;

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
      'padding:16px;min-width:280px;max-width:380px;box-sizing:border-box;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);font:12px sans-serif;color:' + C.text;
    panel.style.position = 'relative';
    configureDialog(this.overlay, panel, 'Room inspection', () => this.close());
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

    this.body = document.createElement('div');
    this.body.style.cssText =
      `background:${C.panel};border-radius:6px;padding:8px 10px;` +
      'display:flex;flex-direction:column;gap:3px;';
    this.body.style.color = C.text;

    this.errorEl = document.createElement('div');
    this.errorEl.style.cssText = `color:${C.danger};font-size:11px;margin-top:8px;min-height:0;`;
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.textContent = ' ';

    this.demolishBtn = this.button('Demolish');
    this.demolishBtn.classList.add('danger');
    this.demolishBtn.addEventListener('click', () => this.onDemolishClick());

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;';
    footer.appendChild(this.demolishBtn);

    panel.append(closeBtn, this.title, this.body, this.errorEl, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(tenant: Tenant, data: TenantInfoData, actions: TenantInfoActions, anchor?: { x: number; y: number }): void {
    this.tenant = tenant;
    this.actions = actions;
    this.armed = false;
    this.lastData = data;
    this.paintDemolish();
    this.renderInfo(data);
    this.clearError();
    this.overlay.style.display = 'flex';
    this.visible = true;
    if (anchor) placeNear(this.overlay.firstElementChild as HTMLElement, anchor.x, anchor.y);
  }

  /** Re-render from live tenant fields (e.g. right after a pricing cycle). */
  refresh(): void {
    if (this.tenant && this.lastData) this.renderInfo(this.lastData);
  }

  close(): void {
    this.hide();
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = 'none';
    this.onClose?.();
  }

  /** Show a sim error (e.g. from a failed demolish) under the details. */
  setError(message: string): void {
    this.errorEl.textContent = message;
  }

  private clearError(): void {
    this.errorEl.textContent = ' ';
  }

  private renderInfo(data: TenantInfoData): void {
    const tenant = this.tenant;
    if (!tenant) return;
    this.title.textContent = `${tenantTypeName(tenant.type)} · ${tenant.floor <= 0 ? floorLabel(tenant.floor) : `Floor ${tenant.floor}`}`;
    const stateText =
      tenant.state === 'constructing' ? 'Under construction' : tenant.state === 'vacant' ? 'Vacant' : tenant.state === 'damaged' ? 'Damaged — repairs required' : 'Open';
    const capacityText =
      tenant.capacity > 0 ? `${data.occupancy}/${tenant.capacity}` : '—';
    // The lobby and other spaces without tenants have no occupancy, stress or grade.
    const hasPeople = tenant.capacity > 0 && tenant.type !== 'lobby';
    const rows = [this.line('State', stateText)];
    if (hasPeople) rows.push(this.line('Occupancy', capacityText), this.line('Average stress', `${data.avgStress.toFixed(1)}`));
    if (tenant.state === 'constructing') rows.push(this.line('Time to open', `${Math.ceil(tenant.constructionTicksLeft * CONFIG.TICK_MS / 1000)}s at 1×`));
    // A scaffold's grade/score are just the placeTenant defaults — hide them
    // until the tenant actually opens.
    if (tenant.state !== 'constructing' && tenant.type !== 'lobby') {
      rows.push(
        this.line('Grade', `${stars(tenant.grade)} (score ${Math.round(tenant.evalScore)})`),
        this.line('Noise at last evaluation', tenant.noisePenalty === undefined ? 'Not yet evaluated' : tenant.noisePenalty === 0 ? 'No penalty' : `${tenant.noisePenalty}-point penalty`),
      );
    }
    if (isPricable(tenant.type)) {
      const pricing = CONFIG.PRICING_LEVELS[tenant.pricing]!.label;
      rows.push(this.line('Pricing', pricing.charAt(0).toUpperCase() + pricing.slice(1)));
    }
    if (tenant.type === 'apartment') {
      rows.push(this.line('Rent / quarter', `${cash(apartmentQuarterRentCents(tenant))}`));
      rows.push(this.line('Collection', tenant.state === 'open' ? 'Collected daily while occupied' : 'No rent until tenants move in'));
    }
    if (tenant.type === 'office') {
      rows.push(this.line('Rent / quarter', `${cash(officeQuarterRentCents(tenant))}`));
      rows.push(this.line('Collection', tenant.state === 'open' ? 'Collected daily while occupied' : 'No rent until occupied'));
      const adjustment = officeRentScoreAdjustment(tenant);
      rows.push(this.line('Rent effect at next evaluation', `${adjustment > 0 ? '+' : ''}${adjustment} points`));
      if (tenant.rentScoreAdjustment !== undefined) rows.push(this.line('Rent effect last evaluated', `${tenant.rentScoreAdjustment > 0 ? '+' : ''}${tenant.rentScoreAdjustment} points`));
      if (tenant.state === 'open') rows.push(this.line('Minimum lease remaining', (data.officeLeaseDaysRemaining ?? 0) > 0
        ? `${data.officeLeaseDaysRemaining!.toFixed(1)} days` : 'Complete; unhappy tenants may leave'));
    }
    const operatingCost = (TENANT_DATA[tenant.type] as { upkeepQuarter?: number }).upkeepQuarter;
    if (tenant.type === 'condo') {
      rows.push(this.line('Lobby access', data.condoAccess ? 'Connected in both directions' : 'Missing a route to or from the lobby'));
      if (!tenant.sold && !data.condoAccess) rows.push(this.line('Waiting for buyers', 'Connect this floor with public transport'));
      rows.push(this.line(tenant.sold ? 'Owner purchase price' : 'Asking price', `${cash((tenant.sold ? tenant.condoSaleCents ?? 150_000_00 : condoSaleCents(tenant)))}`));
      rows.push(this.line('Ownership', tenant.sold ? 'Sold · price locked' : 'Available for sale'));
      rows.push(this.line('Move-out / demolition', 'Original sale price returned at daily settlement'));
    }
    if (tenant.type === 'lobby') {
      rows.push(this.line('Built width', `${tenant.sizeCells} cells`));
      rows.push(this.line('Lobby upkeep', `${dollars(data.lobbyUpkeepQuarter ?? 0)} / quarter`));
      rows.push(this.line('Upkeep per cell', '1–2★: free · 3★: $300 · 4★+: $1,000'));
    }
    if (operatingCost) rows.push(this.line('Operating cost', `${dollars(operatingCost)} / quarter`));
    if (data.maintenance) {
      const m = data.maintenance;
      rows.push(this.line('Elevator shafts covered', `${m.shafts} of ${m.totalShafts}`));
      rows.push(this.line('Mechanics busy', `${m.busy} of ${m.crews}`));
      if (m.shafts < m.totalShafts) rows.push(this.line('Coverage', 'Covers shafts with a stop within 15 floors that mechanics can reach'));
    }
    if (isHotel(tenant.type)) {
      rows.push(this.line('Cleanliness', `${Math.round(tenant.cleanliness)}%`));
      const access = data.housekeepingAccess;
      if (access) {
        rows.push(this.line('Housekeeping access', access.openOffices === 0
          ? 'No operating housekeeping office'
          : access.reachableOffices === 0 ? 'No route from an operating office'
          : `${access.reachableOffices} office${access.reachableOffices === 1 ? '' : 's'} can reach this floor`));
        rows.push(this.line('Assigned cleaners', String(access.assignedCleaners)));
        if (access.reachableOffices === 0) rows.push(this.line('To provide cleaning',
          access.openOffices === 0 ? 'Build housekeeping here or on a connected floor'
          : 'Add housekeeping on this floor or connect an office by service elevator'));
        else rows.push(this.line('Note', 'A reachable office may still have no free cleaner'));
      }
      rows.push(this.line('Checkout per guest', `${cash(hotelCheckoutCents(tenant))}`));
      rows.push(this.line('Full room / night', `${cash(hotelCheckoutCents(tenant) * TENANT_DATA[tenant.type].capacity)}`));
    }
    for (const source of data.noiseSources ?? []) {
      const where = source.floor <= 0 ? floorLabel(source.floor) : `floor ${source.floor}`;
      rows.push(this.line(`Noise: ${tenantTypeName(source.type)}`,
        `${source.floorDistance === 0 ? 'same floor' : where}, cell ${source.x + 1} · ${source.gap} of ${source.clearance} cells apart`));
    }
    if (tenant.type === 'housekeeping') {
      rows.push(this.line('Rooms remaining per cleaner', data.cleaningRemaining?.join(' · ') || 'Staff not yet available'));
      rows.push(this.line('Daily limit', `${CONFIG.HOUSEKEEPER_ROOMS_PER_DAY} completed rooms per cleaner`));
      rows.push(this.line('Shift', 'Last room starts before 16:30 · return home at 17:00'));
      rows.push(this.line('Assigned floors', data.housekeepingFloors?.length ? data.housekeepingFloors.map(floorLabel).join(', ') : 'None'));
      rows.push(this.line('Assignments', 'One cleaner per floor from this office'));
      rows.push(this.line('Extra coverage', 'Build another office to share a floor'));
    }
    if (tenant.type === 'cinema') rows.push(this.line('Film age', `${tenant.movieAge ?? 0} day${(tenant.movieAge ?? 0) === 1 ? '' : 's'}`));
    const opening = commercialOpeningMinute(tenant.type);
    if (opening !== null) {
      if (tenant.type === 'fastfood') rows.push(this.line('External arrivals / target', `${tenant.externalArrivals ?? 0} / ${tenant.externalDemand ?? 'opens at 10:00'}`));
      rows.push(this.line('Revenue today', `${cash(tenant.dailyRevenue)}`));
      rows.push(this.line('External / office visits', `${tenant.paidExternalVisits ?? 0} / ${tenant.paidOfficeVisits ?? 0}`));
      rows.push(this.line('Tower population', String(tenant.reportedPopulation ?? 0)));
      rows.push(this.line('Population update', `${formatTimeOfDay(opening)} · preceding patron count`));
    }
    this.body.replaceChildren(...rows);
    const voices = data.voices ?? voicesFromData(tenant, data);
    if (voices.length) this.body.prepend(voiceSection(voices));
    // Room actions share one right-aligned row under the details.
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:4px';
    if (tenant.state === 'damaged') {
      const repair = this.button(`Repair ($${Math.round(TENANT_DATA[tenant.type].costDollars / 4).toLocaleString('en-US')})`);
      repair.classList.add('default');
      repair.onclick = () => this.actions?.repair(); actions.append(repair);
    }
    if (tenant.type === 'cinema' && tenant.state === 'open') {
      const movie = this.button('Change film ($5,000)');
      movie.title = 'New films draw bigger audiences';
      movie.onclick = () => this.actions?.changeMovie(); actions.append(movie);
    }
    if (isPricable(tenant.type)) actions.append(this.makePricingButton());
    if (actions.childElementCount) this.body.append(actions);
  }

  /** "Change pricing" (rent / asking price) button for the actions row. */
  private makePricingButton(): HTMLButtonElement {
    const btn = this.button(this.tenant?.type === 'office' ? 'Change rent' : 'Change pricing');
    if (this.tenant?.type === 'condo') {
      btn.textContent = 'Change asking price';
      btn.disabled = !!this.tenant.sold || this.tenant.state === 'open';
    }
    btn.title = this.tenant?.type === 'condo' && btn.disabled
      ? 'The asking price is fixed once a condo is sold or occupied.'
      : 'Cycle: very low → low → average → high';
    btn.addEventListener('click', () => this.actions?.cyclePricing());
    return btn;
  }

  private line(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;';
    const k = document.createElement('span');
    k.textContent = label;
    k.style.color = C.dim;
    const v = document.createElement('span');
    v.textContent = value;
    v.style.textAlign = 'right';
    row.append(k, v);
    return row;
  }

  /** First click arms the confirm state; a second click really demolishes. */
  private onDemolishClick(): void {
    if (!this.actions || !this.tenant) return;
    if (!this.armed) {
      this.armed = true;
      this.paintDemolish();
      return;
    }
    this.actions.demolish();
  }

  private paintDemolish(): void {
    this.demolishBtn.textContent = this.armed ? 'Click again to confirm' : this.tenant?.type === 'lobby' ? 'Trim leftmost cell' : 'Demolish';
    this.demolishBtn.title = this.armed ? '' : 'Construction costs are not refunded.';
    this.demolishBtn.classList.toggle('armed', this.armed);
  }

  /** A button in the shared window style (src/ui/style.css). */
  private button(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    return btn;
  }
}

/** Rebuild voice facts from the dialog snapshot when the controller sent none. */
function voicesFromData(tenant: Tenant, data: TenantInfoData): Voice[] {
  const noise = [...(data.noiseSources ?? [])].sort((a, b) => a.floorDistance - b.floorDistance || a.gap - b.gap)[0] ?? null;
  return voicesFromFacts(tenant, {
    avgStress: data.avgStress, noise, access: data.condoAccess, housekeeping: data.housekeepingAccess,
  });
}

/** "What tenants say": speech-bubble lines above the numeric rows. */
function voiceSection(voices: Voice[]): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'tenant-voices';
  const head = document.createElement('div');
  head.className = 'tenant-voices-head';
  head.textContent = 'What tenants say';
  box.append(head);
  for (const voice of voices) {
    const line = document.createElement('div');
    line.className = `tenant-voice voice-${voice.tone}`;
    line.dataset.cause = voice.cause;
    line.textContent = `“${voice.text}”`;
    box.append(line);
  }
  return box;
}

/** Whole dollars in the same format as the info bar ("$12,345"). */
function cash(cents: number): string {
  return dollars(cents / 100);
}

function dollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/** "★★☆☆☆" for grade 0..5 (grade is rounded down for display). */
function stars(grade: number): string {
  const g = Math.min(Math.max(grade, 0), 5);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < g ? '★' : '☆';
  return s;
}

/** Rooms with player-adjustable rent or commercial prices. */
function isPricable(type: TenantType): boolean {
  return isHotel(type) || ['office', 'condo', 'apartment', 'fastfood', 'restaurant', 'shop', 'cinema', 'partyHall',
    'gym', 'supermarket', 'bar', 'conference', 'observationDeck'].includes(type);
}

/** Player-facing name, matching the construction palette ("Hotel suite"). */
function tenantTypeName(type: TenantType): string {
  return (TOOL_INFO as Partial<Record<string, { label: string }>>)[type]?.label ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function floorLabel(floor: number): string {
  return floor <= 0 ? `B${1 - floor}` : String(floor);
}
