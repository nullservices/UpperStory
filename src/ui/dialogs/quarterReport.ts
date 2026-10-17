import { closeButton, raiseWindow } from '../windowing';

/** Whole dollars, like the info bar and Finances window ("-$103,144"). */
const cash = (cents: number): string => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Snapshot data shown by the report; the sim pushes QUARTER_REPORT events at
 * the end of every CONFIG.QUARTER_DAYS-th day (income/upkeep in cents, the
 * per-quarter totals already folded into the balance).
 */
export interface QuarterReportData {
  quarter: number;
  income: number;
  upkeep: number;
  balanceCents: number;
  /** Loan interest already included in upkeep (cents). */
  interest?: number;
}

/** Time the card stays up on its own (held while hovered or focused). */
const AUTO_CLOSE_MS = 20_000;

/**
 * End-of-quarter summary: income (green), upkeep (red), net and the current
 * balance. A floating card, not a dialog: it arrives every few game days and
 * must not pause the tower or block building, so it closes itself after a
 * while (× / Continue / Escape close it sooner).
 */
export class QuarterReport {
  /** Invoked when the card closes; lets the controller tidy up. */
  onClose: (() => void) | null = null;

  private readonly root = document.createElement('section');
  private readonly title = document.createElement('span');
  private readonly body = document.createElement('div');
  private visible = false;
  private timer = 0;

  constructor() {
    const root = this.root;
    root.className = 'quarter-report ui-window';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Quarterly report');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'window-title';
    this.title.className = 'title-text';
    bar.append(this.title, closeButton('Close quarterly report', () => this.hide()));
    this.body.className = 'quarter-body';
    const footer = document.createElement('div');
    footer.className = 'window-footer';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'default';
    ok.textContent = 'Continue';
    ok.onclick = () => this.hide();
    footer.append(ok);
    root.append(bar, this.body, footer);
    // Reading it holds it open.
    root.addEventListener('pointerenter', () => window.clearTimeout(this.timer));
    root.addEventListener('pointerleave', () => this.arm());
    root.addEventListener('focusin', () => window.clearTimeout(this.timer));
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.hide(); } });
    document.body.append(root);
  }

  open(data: QuarterReportData): void {
    // data.quarter counts quarters since the tower opened (1, 2, …).
    const index = Math.max(0, data.quarter - 1);
    const ordinal = ['1st', '2nd', '3rd', '4th'][index % 4];
    this.title.textContent = `Quarterly report · ${ordinal} Qtr / Year ${Math.floor(index / 4) + 1}`;
    const net = data.income - data.upkeep;
    this.body.replaceChildren(
      this.moneyLine('Income', data.income, 'good'),
      this.moneyLine(data.interest ? 'Upkeep (incl. loan interest)' : 'Upkeep', data.upkeep, 'bad'),
      this.moneyLine('Net', net, net >= 0 ? 'good' : 'bad'),
      this.moneyLine('Current balance', data.balanceCents, ''),
    );
    this.root.hidden = false;
    this.visible = true;
    raiseWindow(this.root);
    this.arm();
  }

  close(): void {
    this.hide();
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    if (this.visible) this.timer = window.setTimeout(() => this.hide(), AUTO_CLOSE_MS);
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    window.clearTimeout(this.timer);
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.hidden = true;
    this.onClose?.();
  }

  private moneyLine(label: string, cents: number, tone: 'good' | 'bad' | ''): HTMLDivElement {
    const row = document.createElement('div');
    const k = document.createElement('span');
    k.textContent = label;
    const v = document.createElement('b');
    v.textContent = cash(cents);
    if (tone) v.className = tone;
    row.append(k, v);
    return row;
  }
}
