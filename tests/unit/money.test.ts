import { describe, expect, it } from 'vitest';
import { addMoney, formatDollars, spend } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

describe('money', () => {
  it('starts with $2,000,000', () => {
    const state = newTestGame();
    expect(state.money.balanceCents).toBe(200_000_000);
  });

  it('spend deducts and emits MONEY_CHANGED', () => {
    const state = newTestGame();
    expect(spend(state, 1_000_00)).toBe(true); // $1,000
    expect(state.money.balanceCents).toBe(199_900_000);
    expect(state.events).toContainEqual({
      type: 'MONEY_CHANGED',
      balance: 199_900_000,
      delta: -1_000_00,
    });
  });

  it('spend fails without touching the balance', () => {
    const state = newTestGame();
    expect(spend(state, 999_999_999_99)).toBe(false);
    expect(state.money.balanceCents).toBe(200_000_000);
  });

  it('addMoney adds and emits', () => {
    const state = newTestGame();
    addMoney(state, 500_00); // $500
    expect(state.money.balanceCents).toBe(200_050_000);
  });

  it('negative amounts are rejected', () => {
    const state = newTestGame();
    expect(() => spend(state, -1)).toThrow();
    expect(() => addMoney(state, -1)).toThrow();
  });

  it('formatDollars renders the stored ÷100 convention', () => {
    expect(formatDollars(0)).toBe('$0.00');
    expect(formatDollars(100)).toBe('$1.00');
    expect(formatDollars(5)).toBe('$0.05');
    expect(formatDollars(12_345_678)).toBe('$123,456.78');
    expect(formatDollars(-50)).toBe('-$0.50');
  });
});
