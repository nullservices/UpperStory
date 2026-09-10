import { CONFIG } from '../data/config';
import { startIncident } from './campaign';
import { tick } from './core/engine';
import { placeElevatorGroup, addElevatorCar } from './elevators';
import { setupNewGame, type GameState } from './state';
import { placeTenant } from './tenants';
import { buildFloor, placeStair } from './tower';

/** A playable facilities tour. The normal new game retains its starting budget and rating. */
export function setupShowcaseTower(state: GameState): void {
  setupNewGame(state);
  state.starLevel = 5;
  state.money.balanceCents = 20_000_000_00;
  for (let f = 2; f <= 15; f++) buildFloor(state, f);
  for (let f = -1; f >= -8; f--) buildFloor(state, f);
  for (const floor of [2, 3]) placeStair(state, floor, 0);
  const local = placeElevatorGroup(state, -8, 15, 10);
  for (let i = 0; i < 5; i++) addElevatorCar(state, local.id);
  placeElevatorGroup(state, -8, 15, 14, 'service');
  placeTenant(state, 'skyLobby', 15, 18);
  placeElevatorGroup(state, -8, 15, 18, 'express');
  for (const x of [24, 34, 44, 54]) placeTenant(state, 'office', 2, x);
  for (const x of [24, 40, 56]) placeTenant(state, 'fastfood', 3, x);
  placeTenant(state, 'cinema', 4, 24);
  placeTenant(state, 'partyHall', 6, 24);
  for (const x of [24, 40, 56]) placeTenant(state, 'condo', 8, x);
  for (const x of [24, 28, 32]) placeTenant(state, 'hotel', 9, x);
  for (const x of [38, 44]) placeTenant(state, 'hotelTwin', 9, x);
  const suite = placeTenant(state, 'hotelSuite', 9, 54);
  placeTenant(state, 'housekeeping', 10, 24);
  placeTenant(state, 'security', 10, 42);
  placeTenant(state, 'medical', 11, 24);
  placeTenant(state, 'restaurant', 12, 24);
  for (const x of [24, 36, 48]) placeTenant(state, 'shop', 13, x);
  placeTenant(state, 'hotelSuite', 14, 24);
  placeTenant(state, 'hotelSuite', 14, 34);
  placeTenant(state, 'parkingRamp', 0, 30);
  placeTenant(state, 'parkingRamp', -1, 30);
  for (const x of [90, 94, 98, 102, 106]) placeTenant(state, 'parkingSpace', 0, x);
  placeTenant(state, 'recycling', -1, 60);
  placeTenant(state, 'metro', -8, 30);
  for (let i = 0; i < CONFIG.DAY_TICKS * 2; i++) tick(state);
  state.events.length = 0;
  // The tour presents a real timed response and a VIP taking a real trip.
  const office = [...state.tenants.values()].find(t => t.type === 'office' && t.state === 'open');
  if (office) startIncident(state, 'fire', office.id);
  startIncident(state, 'vip', suite.id);
}
