import { CONFIG } from '../data/config';
import { loanLimitCents, repayLoan, repayLoanError, takeLoan, takeLoanError, type GameState } from '../sim';
import { chromeInsets, clampWindow, closeButton, makeDraggable, raiseWindow, readUiPref, writeUiPref } from './windowing';

const cash = (cents: number): string => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const AMOUNTS = [100_000, 250_000, 500_000, 1_000_000, 2_500_000];

/**
 * Tower → Finances & loans: balance, this quarter's books and the bank loan
 * (balance, limit, take / repay). A floating window like the Tower report,
 * not a dialog, so the tower keeps running while the player decides.
 */
export class FinanceWindow {
  private readonly root = document.createElement('section');
  private readonly books = document.createElement('dl');
  private readonly loan = document.createElement('dl');
  private readonly note = document.createElement('p');
  private readonly amount = document.createElement('select');
  private readonly takeButton = document.createElement('button');
  private readonly repayButton = document.createElement('button');
  private readonly repayAllButton = document.createElement('button');
  private readonly message = document.createElement('p');
  private state: GameState | null = null;
  private lastKey = '';
  private prefs = readUiPref<{ x: number | null; y: number | null }>('finance', { x: null, y: null });

  constructor() {
    const root = this.root;
    root.className = 'finance-window ui-window';
    root.setAttribute('aria-label', 'Finances and loans');
    // Focusable as a whole so opening it doesn't park focus in the amount
    // list (where letter keys would change the amount and shortcuts stop).
    root.tabIndex = -1;
    root.hidden = true;
    const title = document.createElement('div');
    title.className = 'window-title';
    title.innerHTML = '<span class="title-text">Finances &amp; loans</span>';
    title.append(closeButton('Close finances', () => this.close()));
    const body = document.createElement('div');
    body.className = 'window-body';
    const booksHead = document.createElement('h3');
    booksHead.textContent = 'Funds & this quarter';
    const loanHead = document.createElement('h3');
    loanHead.textContent = 'Bank loan';
    this.note.className = 'window-hint';
    const controls = document.createElement('div');
    controls.className = 'loan-controls';
    const label = document.createElement('label');
    label.textContent = 'Amount ';
    for (const dollars of AMOUNTS) this.amount.add(new Option(cash(dollars * 100), String(dollars * 100)));
    this.amount.onchange = () => { this.lastKey = ''; if (this.state) this.update(this.state); };
    label.append(this.amount);
    this.takeButton.type = this.repayButton.type = this.repayAllButton.type = 'button';
    this.takeButton.textContent = 'Borrow';
    this.repayButton.textContent = 'Repay';
    this.repayAllButton.textContent = 'Repay all';
    this.takeButton.onclick = () => this.run(state => takeLoan(state, this.selected()), 'Borrowed');
    this.repayButton.onclick = () => this.run(state => repayLoan(state, Math.min(this.selected(), owed(state))), 'Repaid');
    this.repayAllButton.onclick = () => this.run(state => repayLoan(state, owed(state)), 'Repaid');
    controls.append(label, this.takeButton, this.repayButton, this.repayAllButton);
    this.message.className = 'finance-message';
    this.message.setAttribute('role', 'status');
    body.append(booksHead, this.books, loanHead, this.loan, controls, this.message, this.note);
    root.append(title, body);
    document.body.append(root);
    makeDraggable(root, title, 'fixed', (x, y) => { this.prefs = { x, y }; writeUiPref('finance', this.prefs); });
    window.addEventListener('resize', () => { if (!root.hidden) this.place(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(): void {
    if (this.root.hidden) this.open(); else this.close();
  }

  open(): void {
    this.root.hidden = false;
    raiseWindow(this.root);
    this.place();
    this.lastKey = '';
    this.message.textContent = '';
    if (this.state) this.update(this.state);
    this.root.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.hidden = true;
  }

  update(state: GameState): void {
    this.state = state;
    if (this.root.hidden) return;
    const debt = owed(state);
    const limit = loanLimitCents(state);
    const m = state.money;
    const key = `${m.balanceCents}:${m.quarterIncomeCents}:${m.quarterUpkeepCents}:${debt}:${limit}:${this.amount.value}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const rate = CONFIG.LOAN_INTEREST_QUARTER;
    this.books.innerHTML = `<dt>Funds</dt><dd class="${m.balanceCents < 0 ? 'error' : ''}">${cash(m.balanceCents)}</dd>`
      + `<dt>Income</dt><dd>${cash(m.quarterIncomeCents)}</dd><dt>Upkeep</dt><dd>${cash(m.quarterUpkeepCents)}</dd>`
      + `<dt>Net</dt><dd>${cash(m.quarterIncomeCents - m.quarterUpkeepCents)}</dd>`;
    this.loan.innerHTML = `<dt>Owed</dt><dd>${cash(debt)}</dd><dt>Credit limit</dt><dd>${cash(limit)}</dd>`
      + `<dt>Available</dt><dd>${cash(Math.max(0, limit - debt))}</dd>`
      + `<dt>Interest (${Math.round(rate * 1000) / 10}% per quarter)</dt><dd>${cash(Math.round(debt * rate))}</dd>`;
    const amount = this.selected();
    const takeError = takeLoanError(state, amount);
    const repayError = debt > 0 ? repayLoanError(state, Math.min(amount, debt)) : 'You owe nothing';
    const repayAllError = debt > 0 ? repayLoanError(state, debt) : 'You owe nothing';
    this.setButton(this.takeButton, takeError);
    this.setButton(this.repayButton, repayError);
    this.setButton(this.repayAllButton, repayAllError);
    this.note.textContent = limit === 0
      ? 'Build a Bank (three stars) to borrow against your tower. More banks and more people raise the limit.'
      : `Interest is charged at each quarter's settlement. Borrow up to your limit; repay any time from your funds.${takeError ? ` Borrowing ${cash(amount)}: ${takeError.toLowerCase()}.` : ''}`;
  }

  private selected(): number {
    return Number(this.amount.value);
  }

  /** Disabled buttons keep their reason in the tooltip and accessible name. */
  private setButton(button: HTMLButtonElement, error: string | null): void {
    button.disabled = error !== null;
    button.title = error ?? '';
  }

  private run(action: (state: GameState) => void, verb: string): void {
    const state = this.state;
    if (!state) return;
    const before = owed(state);
    try {
      action(state);
      this.message.classList.remove('error');
      this.message.textContent = `${verb} ${cash(Math.abs(owed(state) - before))}.`;
    } catch (err) {
      this.message.classList.add('error');
      this.message.textContent = err instanceof Error ? err.message : String(err);
    }
    this.lastKey = '';
    this.update(state);
  }

  private place(): void {
    const { top } = chromeInsets();
    const width = this.root.offsetWidth || 300;
    const spot = clampWindow(this.root, this.prefs.x ?? window.innerWidth - width - 300, this.prefs.y ?? top + 10);
    this.root.style.left = `${spot.x}px`;
    this.root.style.top = `${spot.y}px`;
  }
}

function owed(state: GameState): number {
  return state.money.loanCents ?? 0;
}
