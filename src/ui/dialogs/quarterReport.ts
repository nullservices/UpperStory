import { configureDialog } from './accessibility';
import { formatDollars } from '../../sim';

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
  money: '#477a53',
};

/**
 * Dark end-of-quarter summary modal: income (green), upkeep (red), net, and
 * the current balance. Informational only — the Close button (or overlay /
 * Escape via the controller) dismisses it. Same visual language as the other
 * dialogs.
 */
export class QuarterReport {
  /** Invoked when the dialog closes itself; lets the controller tidy up. */
  onClose: (() => void) | null = null;

  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;

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
      'padding:16px;min-width:300px;max-width:360px;box-sizing:border-box;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);font:12px sans-serif;color:' + C.text;
    panel.style.position = 'relative';
    configureDialog(this.overlay, panel, 'Quarterly report', () => this.close());
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
      'display:flex;flex-direction:column;gap:4px;';

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:12px;display:flex;justify-content:flex-end;';
    const okBtn = this.button('Close');
    okBtn.addEventListener('click', () => this.hide());
    footer.appendChild(okBtn);

    panel.append(closeBtn, this.title, this.body, footer);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  open(data: QuarterReportData): void {
    this.title.textContent = `Quarterly Report — Q${data.quarter}`;
    const net = data.income - data.upkeep;
    this.body.replaceChildren(
      this.moneyLine('Income', data.income, C.money),
      this.moneyLine('Upkeep', data.upkeep, C.danger),
      this.moneyLine('Net', net, net >= 0 ? C.money : C.danger),
      this.moneyLine('Current balance', data.balanceCents, C.text),
    );
    this.overlay.style.display = 'flex';
    this.visible = true;
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

  private moneyLine(label: string, cents: number, color: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;';
    const k = document.createElement('span');
    k.textContent = label;
    k.style.color = C.dim;
    const v = document.createElement('span');
    v.textContent = formatDollars(cents);
    v.style.color = color;
    v.style.font = '12px monospace';
    row.append(k, v);
    return row;
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
