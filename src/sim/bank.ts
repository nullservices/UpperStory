import { CONFIG } from '../data/config';
import { addMoney, spend } from './money';
import { population } from './people';
import { openTenants } from './services';
import type { GameState } from './state';

/**
 * Bank loans (Upper Story original). An open bank extends a credit line that
 * grows with the number of banks and the tower's population; interest on the
 * outstanding principal is charged at each quarter's settlement (money.ts).
 */

export function loanLimitCents(state: GameState): number {
  const banks = openTenants(state, 'bank').length;
  if (banks === 0) return 0;
  return banks * CONFIG.LOAN_BASE_DOLLARS * 100 + population(state) * CONFIG.LOAN_PER_PERSON_DOLLARS * 100;
}

/** Reason a loan of `cents` cannot be taken, or null. */
export function takeLoanError(state: GameState, cents: number): string | null {
  if (!Number.isInteger(cents) || cents <= 0) return 'Choose a positive amount';
  const limit = loanLimitCents(state);
  if (limit === 0) return 'Requires an open bank';
  if ((state.money.loanCents ?? 0) + cents > limit) return 'That exceeds your credit limit';
  return null;
}

export function takeLoan(state: GameState, cents: number): void {
  const error = takeLoanError(state, cents);
  if (error) throw new Error(error);
  state.money.loanCents = (state.money.loanCents ?? 0) + cents;
  addMoney(state, cents);
}

/** Reason `cents` cannot be repaid, or null. */
export function repayLoanError(state: GameState, cents: number): string | null {
  if (!Number.isInteger(cents) || cents <= 0) return 'Choose a positive amount';
  if (cents > (state.money.loanCents ?? 0)) return 'You do not owe that much';
  if (cents > state.money.balanceCents) return 'Not enough funds';
  return null;
}

export function repayLoan(state: GameState, cents: number): void {
  const error = repayLoanError(state, cents);
  if (error) throw new Error(error);
  if (!spend(state, cents)) throw new Error('Not enough funds');
  state.money.loanCents = (state.money.loanCents ?? 0) - cents;
}
