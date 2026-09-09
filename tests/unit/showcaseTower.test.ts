import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { createInitialState } from '../../src/sim/state';
import { setupShowcaseTower } from '../../src/sim/showcaseTower';
import { respondToIncident } from '../../src/sim/campaign';
import { tickN } from '../helpers/simHarness';

it('runs the facilities tour through rescue, visitor spending and a VIP inspection', () => {
  const state = createInitialState(20260907);
  setupShowcaseTower(state);
  const fire = state.campaign.incidents.find(i => i.kind === 'fire')!;
  const vip = state.campaign.incidents.find(i => i.kind === 'vip')!;
  const office = state.tenants.get(fire.tenantId)!;
  const cinema = [...state.tenants.values()].find(t => t.type === 'cinema')!;
  const party = [...state.tenants.values()].find(t => t.type === 'partyHall')!;
  respondToIncident(state, fire.id, 'rescue');
  let cinemaRevenue = 0;
  let partyRevenue = 0;
  for (let i = 0; i < CONFIG.DAY_TICKS; i++) {
    tickN(state, 1);
    cinemaRevenue = Math.max(cinemaRevenue, cinema.dailyRevenue);
    partyRevenue = Math.max(partyRevenue, party.dailyRevenue);
  }
  expect(office.state).toBe('open');
  expect(state.campaign.incidents.some(i => i.id === fire.id || i.id === vip.id)).toBe(false);
  expect(vip.stayed).toBe(true);
  expect(cinemaRevenue).toBeGreaterThan(0);
  expect(partyRevenue).toBeGreaterThan(0);
  expect(state.campaign.vipApproved).toBe(true);
  expect(state.campaign.history.some(e => e.message.includes('VIP'))).toBe(true);
});
