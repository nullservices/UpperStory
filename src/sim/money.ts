import { CONFIG, TENANT_DATA, type TenantTypeData } from '../data/config';
import { pushEvent } from './core/events';
import type { GameState } from './state';

/**
 * Money is stored in integer cents (deterministic, no float drift) and
 * displayed in dollars — the original stored money ÷100 the same way.
 * Daily settlement (MoneyT's TenantAllDayMoney equivalent) runs on the
 * last tick of each in-game day.
 */
export interface MoneyState {
  balanceCents: number;
  dailyIncomeCents: number;
  dailyUpkeepCents: number;
  quarterIncomeCents: number;
  quarterUpkeepCents: number;
}

/** Returns false (and changes nothing) when funds are insufficient. */
export function spend(state: GameState, cents: number): boolean {
  if (cents < 0) throw new Error(`spend: negative amount ${cents}`);
  if (state.money.balanceCents < cents) return false;
  state.money.balanceCents -= cents;
  pushEvent(state, {
    type: 'MONEY_CHANGED',
    balance: state.money.balanceCents,
    delta: -cents,
  });
  return true;
}

export function addMoney(state: GameState, cents: number): void {
  if (cents < 0) throw new Error(`addMoney: negative amount ${cents}`);
  state.money.balanceCents += cents;
  pushEvent(state, {
    type: 'MONEY_CHANGED',
    balance: state.money.balanceCents,
    delta: cents,
  });
}

/** Rent multiplier by evaluation grade (0..5). */
export function rentMultiplier(grade: number): number {
  return 0.4 + 0.15 * grade;
}

/** End-of-day settlement: rent, commercial revenue, wages and upkeep. */
export function stepDailySettlement(state: GameState): void {
  let income = 0;
  let upkeep = 0;

  for (const tenant of state.tenants.values()) {
    if (tenant.state !== 'open') continue;
    if (tenant.type === 'office') {
      income += Math.round(
        CONFIG.OFFICE_RENT_DAILY_DOLLARS * 100 * rentMultiplier(tenant.grade),
      );
    } else if (tenant.type === 'condo') {
      income += Math.round(
        CONFIG.CONDO_RENT_DAILY_DOLLARS * 100 * rentMultiplier(tenant.grade),
      );
    }
    const data = TENANT_DATA[tenant.type] as TenantTypeData;
    upkeep += (data.upkeepDaily ?? 0) * 100;
    if (['shop', 'restaurant', 'fastfood', 'cinema', 'partyHall'].includes(tenant.type)) {
      tenant.reportedPopulation = Math.min(tenant.capacity, tenant.visitsToday ?? 0);
      tenant.visitsToday = 0;
    }
    if (tenant.type === 'cinema') tenant.movieAge = (tenant.movieAge ?? 0) + 1;
    if (tenant.type === 'parkingSpace' && [...state.tenants.values()].some(t => t.type === 'parkingRamp' && t.floor === tenant.floor && t.state === 'open')) income += 5000;
    // Meals, shop sales and hotel nights accumulate here during the day.
    income += tenant.dailyRevenue;
    tenant.dailyRevenue = 0;
  }

  for (const p of state.people.values()) {
    if (p.kind === 'guard') upkeep += CONFIG.GUARD_WAGE_DAILY_DOLLARS * 100;
    if (p.kind === 'housekeeper') upkeep += CONFIG.HOUSEKEEPER_WAGE_DAILY_DOLLARS * 100;
  }
  for (const group of state.elevatorGroups.values()) {
    upkeep += group.cars.length * CONFIG.ELEVATOR_CAR_UPKEEP_DAILY_DOLLARS * 100;
  }

  state.money.balanceCents += income - upkeep;
  state.money.dailyIncomeCents = income;
  state.money.dailyUpkeepCents = upkeep;
  state.money.quarterIncomeCents += income;
  state.money.quarterUpkeepCents += upkeep;
  pushEvent(state, {
    type: 'MONEY_CHANGED',
    balance: state.money.balanceCents,
    delta: income - upkeep,
  });

  if (state.calendar.day % CONFIG.QUARTER_DAYS === 0) {
    pushEvent(state, {
      type: 'QUARTER_REPORT',
      quarter: Math.floor(state.calendar.day / CONFIG.QUARTER_DAYS),
      income: state.money.quarterIncomeCents,
      upkeep: state.money.quarterUpkeepCents,
    });
    state.money.quarterIncomeCents = 0;
    state.money.quarterUpkeepCents = 0;
  }

  if (state.money.balanceCents < 0) {
    pushEvent(state, { type: 'ALERT', message: 'Funds are negative!' });
  }
}

/** 12_345_678 -> "$123,456.78" (display only; sim math stays integer). */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${String(rem).padStart(2, '0')}`;
}
