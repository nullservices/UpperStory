import { configureDialog } from './accessibility';
import { CONFIG, TENANT_DATA, isHotel } from '../../data/config';
import type { Tenant, TenantType } from '../../sim';

/** Snapshot data the controller computed from live sim state at open time. */
export interface TenantInfoData {
  /** Mean stress of the tenant's current people (0 when empty). */
  avgStress: number;
  /** People currently attached to the tenant. */
  occupancy: number;
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
  overlay: 'rgba(38,62,52,0.18)',
  bg: '#eceee3',
  panel: '#e0e6d8',
  text: '#34463f',
  dim: '#758170',
  accent: '#3f6958',
  danger: '#a34835',
  hover: '#d1ddc8',
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
    this.errorEl.textContent = ' ';

    this.demolishBtn = this.button('Demolish');
    this.demolishBtn.style.color = C.danger;
    this.demolishBtn.addEventListener('click', () => this.onDemolishClick());

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;';
    footer.appendChild(this.demolishBtn);

    panel.append(closeBtn, this.title, this.body, this.errorEl, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(tenant: Tenant, data: TenantInfoData, actions: TenantInfoActions): void {
    this.tenant = tenant;
    this.actions = actions;
    this.armed = false;
    this.lastData = data;
    this.paintDemolish();
    this.renderInfo(data);
    this.clearError();
    this.overlay.style.display = 'flex';
    this.visible = true;
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
    this.title.textContent = `${tenantTypeName(tenant.type)} — Floor ${floorLabel(tenant.floor)}`;
    const stateText =
      tenant.state === 'constructing' ? 'Under construction' : tenant.state === 'vacant' ? 'Vacant' : tenant.state === 'damaged' ? 'Damaged — repairs required' : 'Open';
    const capacityText =
      tenant.capacity > 0 ? `${data.occupancy}/${tenant.capacity}` : '—';
    const rows = [
      this.line('State', stateText),
      this.line('Occupancy', capacityText),
      this.line('Avg stress', `${data.avgStress.toFixed(1)}`),
    ];
    if (tenant.state === 'constructing') rows.push(this.line('Time to open', `${Math.ceil(tenant.constructionTicksLeft * CONFIG.TICK_MS / 1000)}s at 1×`));
    // A scaffold's grade/score are just the placeTenant defaults — hide them
    // until the tenant actually opens.
    if (tenant.state !== 'constructing') {
      rows.push(
        this.line('Grade', `${stars(tenant.grade)} (score ${Math.round(tenant.evalScore)})`),
      );
    }
    if (isPricable(tenant.type)) {
      rows.push(this.line('Pricing', CONFIG.PRICING_LEVELS[tenant.pricing]!.label));
    }
    if (isHotel(tenant.type)) {
      rows.push(this.line('Cleanliness', `${Math.round(tenant.cleanliness)}%`));
    }
    if (tenant.type === 'cinema') rows.push(this.line('Film age', `${tenant.movieAge ?? 0} days`));
    this.body.replaceChildren(...rows);
    if (tenant.state === 'damaged') {
      const repair = this.button(`Repair · $${Math.round(TENANT_DATA[tenant.type].costDollars / 4).toLocaleString()}`);
      repair.onclick = () => this.actions?.repair(); this.body.append(repair);
    }
    if (tenant.type === 'cinema' && tenant.state === 'open') {
      const movie = this.button('Change film · $5,000');
      movie.onclick = () => this.actions?.changeMovie(); this.body.append(movie);
    }
    if (isPricable(tenant.type)) {
      this.body.appendChild(this.makePricingButton());
    }
  }

  /** Right-aligned "Change pricing" button under the pricing row. */
  private makePricingButton(): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;';
    const btn = this.button('Change pricing');
    btn.style.color = C.accent;
    btn.title = 'Cycle: very low → low → average → high';
    btn.addEventListener('click', () => this.actions?.cyclePricing());
    row.appendChild(btn);
    return row;
  }

  private line(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;';
    const k = document.createElement('span');
    k.textContent = label;
    k.style.color = C.dim;
    const v = document.createElement('span');
    v.textContent = value;
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
    this.demolishBtn.textContent = this.armed ? 'Are you sure?' : 'Demolish';
  }

  private button(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText =
      `background:${C.panel};color:${C.text};border:1px solid #a5b39b;` +
      'border-radius:3px;padding:4px 10px;font:11px sans-serif;cursor:pointer;white-space:nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = C.hover;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = C.panel;
    });
    return btn;
  }
}

/** "★★☆☆☆" for grade 0..5 (grade is rounded down for display). */
function stars(grade: number): string {
  const g = Math.min(Math.max(grade, 0), 5);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < g ? '★' : '☆';
  return s;
}

/** cyclePricing() applies to every tenant type but the three static ones. */
function isPricable(type: TenantType): boolean {
  return isHotel(type) || ['fastfood', 'restaurant', 'shop', 'cinema', 'partyHall'].includes(type);
}

function tenantTypeName(type: TenantType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function floorLabel(floor: number): string {
  return floor <= 0 ? `B${1 - floor}` : String(floor);
}
