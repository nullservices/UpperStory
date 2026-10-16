/**
 * Deterministic playthrough bot: plays a normal new game (empty plot, no
 * prebuilt lobby, $2M) using only player commands, so balance and
 * progression regressions show up as a change in how far it gets.
 *
 * Strategy (deliberately plain, not exploit-seeking):
 *  - narrow lobby at x=0, floors upward, one standard bank per 15-floor zone;
 *  - condos while cash is short (their sale funds growth), otherwise offices;
 *  - fast food on floor 2 and every sky-lobby floor, shops/restaurants at 3★;
 *  - a hotel block with housekeeping + a service shaft at 2★, security, then
 *    medical, recycling, metro (via the lobby bank extended down), cathedral;
 *  - sky lobbies only on SKY_LOBBY_FLOORS, one express shaft through them;
 *  - cars added when queues grow; incidents answered; damage repaired.
 * Every command is pre-checked with the sim's *Error helpers or wrapped so a
 * rejected command is counted (with its reason) rather than crashing the run.
 */
import { CONFIG, TENANT_DATA } from '../../src/data/config';
import { respondToIncident, responseQuote } from '../../src/sim/campaign';
import {
  addElevatorCar,
  elevatorPlacementError,
  elevatorServiceRangeError,
  placeElevatorGroup,
  repairElevatorCar,
  repairElevatorCarError,
  setElevatorServiceRange,
  upgradeCarSpeed,
  type ElevatorGroup,
  type ElevatorKind,
} from '../../src/sim/elevators';
import { progressionRequirements } from '../../src/sim/progression';
import { population } from '../../src/sim/people';
import { queueLength } from '../../src/sim/queues';
import { pickupRoute } from '../../src/sim/routing';
import type { GameState } from '../../src/sim/state';
import { isUnlocked, placeTenant, placementError, repairTenant, type Tenant, type TenantType } from '../../src/sim/tenants';
import {
  buildFloor,
  buildFloorError,
  extendFloor,
  floorBounds,
  floorExtensionError,
  getFloor,
  topFloorIndex,
} from '../../src/sim/tower';

const W = CONFIG.FLOOR_WIDTH_CELLS;
const COMMERCIAL_TYPES: readonly TenantType[] = ['fastfood', 'shop', 'restaurant'];
const LOBBY = CONFIG.LOBBY_FLOOR_INDEX;
const SKY_FLOORS: readonly number[] = (CONFIG as { SKY_LOBBY_FLOORS?: readonly number[] }).SKY_LOBBY_FLOORS ?? [15, 30, 45, 60, 75, 90];
const ZONE = 15;
/** Shaft columns live left of this x; rooms fill from here rightward. */
const ROOM_X0 = 41;
const EXPRESS_X = 0;
const SERVICE_X = 36;
const BANKS_PER_ZONE = 3;
/**
 * Floors reserved for hotels (filled once 2★ unlocks them). Low floors keep
 * guests on the lobby bank; five full floors give more beds than the daily
 * guest arrivals, which housekeeping needs to find rooms empty to clean.
 */
const HOTEL_FLOORS: readonly number[] = [4, 5, 6, 7, 8];
/** Condos insulate the hotel block: offices and shops on adjacent floors are noisy. */
const QUIET_FLOORS: readonly number[] = [3, 9];
const INITIAL_LOBBY_CELLS = 200;
/** Lobby cells added per widening step (one condo width). */
const WIDEN_CHUNK = 16;
const CATHEDRAL_FLOOR = TENANT_DATA.cathedral.floorRestriction ?? 97;
const CATHEDRAL_X = 40;
const METRO_FLOOR = TENANT_DATA.metro.floorRestriction ?? -8;
const MEDICAL_X = ROOM_X0;
const SECURITY_X = ROOM_X0 + TENANT_DATA.medical.sizeCells;
const COMMERCIAL_X0 = SECURITY_X + TENANT_DATA.security.sizeCells;

export type FloorRole = 'commercial' | 'hotel' | 'condo' | 'office';

export interface BotStats {
  commands: Record<string, number>;
  rejections: Record<string, number>;
  notes: string[];
}

const dollars = (n: number): number => n * 100;

export class PlaythroughBot {
  readonly stats: BotStats = { commands: {}, rejections: {}, notes: [] };
  private readonly roles = new Map<number, FloorRole>();
  private readonly banks = new Map<string, number>();
  private expressId: number | null = null;
  private serviceId: number | null = null;
  private readonly hotelFloors = HOTEL_FLOORS;
  private readonly noted = new Set<string>();

  constructor(readonly state: GameState) {}

  // --- bookkeeping -------------------------------------------------------

  private ok(label: string): void {
    this.stats.commands[label] = (this.stats.commands[label] ?? 0) + 1;
  }

  private reject(label: string, reason: string): void {
    const key = `${label}: ${reason}`;
    this.stats.rejections[key] = (this.stats.rejections[key] ?? 0) + 1;
  }

  /** Run a command; a thrown Error(reason) is recorded, never fatal. */
  private attempt(label: string, fn: () => void): boolean {
    try {
      fn();
      this.ok(label);
      return true;
    } catch (error) {
      this.reject(label, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private note(key: string, message: string): void {
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.stats.notes.push(`day ${this.state.calendar.day}: ${message}`);
  }

  private get funds(): number {
    return this.state.money.balanceCents;
  }

  /** Cash kept back for fire rescues / ransoms and upkeep swings. */
  private get reserve(): number {
    const s = this.state.starLevel;
    return dollars(s <= 1 ? 100_000 : s === 2 ? 200_000 : s === 3 ? 400_000 : 1_000_000);
  }

  private canSpend(cents: number): boolean {
    return this.funds - cents >= this.reserve;
  }

  /** Relieving congestion outranks new rooms: it may dip into the reserve. */
  private canSpendTransport(cents: number): boolean {
    return this.funds - cents >= dollars(60_000);
  }

  private tenantsOf(type: TenantType): Tenant[] {
    return [...this.state.tenants.values()].filter(t => t.type === type);
  }

  private lobby(): Tenant | undefined {
    return this.tenantsOf('lobby')[0];
  }

  // --- geometry ------------------------------------------------------------

  /** Zone k: 0 = floors 1–15 from the lobby, k ≥ 1 = 15k..15k+15 from a sky lobby. */
  static zoneOf(floor: number): number {
    return floor <= ZONE ? 0 : Math.floor((floor - 1) / ZONE);
  }

  static zoneRange(k: number): [number, number] {
    return k === 0 ? [LOBBY, ZONE] : [ZONE * k, Math.min(ZONE * k + ZONE, CONFIG.MAX_FLOORS)];
  }

  /** Adjacent zones share their sky-lobby floor, so alternate shaft columns. */
  static bankX(k: number, i: number): number {
    return 6 + (k % 2) * 15 + i * 5;
  }

  private group(id: number | null | undefined): ElevatorGroup | undefined {
    return id === null || id === undefined ? undefined : this.state.elevatorGroups.get(id);
  }

  private skyLobbyOn(floor: number): Tenant | undefined {
    return this.tenantsOf('skyLobby').find(t => t.floor === floor);
  }

  /** Highest floor the bot may build right now (zones need their sky lobby + express). */
  private buildCeiling(): number {
    let ceiling = ZONE;
    for (const sky of SKY_FLOORS) {
      const express = this.group(this.expressId);
      if (!this.skyLobbyOn(sky) || !express || express.serviceHi < sky) break;
      ceiling = Math.min(sky + ZONE, CONFIG.MAX_FLOORS);
    }
    return ceiling;
  }

  roleOf(floor: number): FloorRole {
    const known = this.roles.get(floor);
    if (known) return known;
    let role: FloorRole;
    if (floor === 2 || SKY_FLOORS.includes(floor)) role = 'commercial';
    else if (this.hotelFloors.includes(floor)) role = 'hotel';
    else if (QUIET_FLOORS.includes(floor)) role = 'condo';
    else {
      // Condo sales (one-off) fund growth while cash is short; otherwise
      // offices, which pay rent every quarter and house twice the people.
      // Cash-short: condo sales (one-off, +$70k each) fund growth; otherwise
      // offices, which pay rent every quarter and house twice the people.
      role = this.funds < dollars(1_200_000) && floor < CATHEDRAL_FLOOR ? 'condo' : 'office';
    }
    this.roles.set(floor, role);
    return role;
  }

  /** Planned room placements for a floor, left to right. */
  private plannedRooms(floor: number): { type: TenantType; x: number }[] {
    const { lo, hi } = floorBounds(this.state, floor);
    const start = Math.max(lo, ROOM_X0);
    const rooms: { type: TenantType; x: number }[] = [];
    const run = (from: number, types: TenantType[]): void => {
      let x = from;
      let i = 0;
      while (true) {
        const type = types[i % types.length]!;
        const size = TENANT_DATA[type].sizeCells;
        if (x + size > hi) break;
        // Skip the cathedral footprint on the top four floors.
        if (floor >= CATHEDRAL_FLOOR && x < CATHEDRAL_X + TENANT_DATA.cathedral.sizeCells && x + size > CATHEDRAL_X) {
          x = CATHEDRAL_X + TENANT_DATA.cathedral.sizeCells;
          continue;
        }
        rooms.push({ type, x });
        x += size;
        i++;
      }
    };
    const role = this.roleOf(floor);
    if (role === 'commercial') {
      const stars = this.state.starLevel;
      const mix: TenantType[] = stars >= 3 ? ['fastfood', 'shop', 'restaurant'] : ['fastfood'];
      run(floor === 2 ? Math.max(start, COMMERCIAL_X0) : start, mix);
    } else if (role === 'hotel') {
      // VIP inspections (the only reason hotels matter for ratings) start at
      // 3★; earlier, hotel rooms would starve the population push.
      if (this.state.starLevel < 3 && this.funds < dollars(1_500_000)) return rooms;
      // Each hotel floor gets its own housekeeping office (an office sends at
      // most one cleaner per floor), then full-width rooms: guests take any
      // free bed, and an occupied room cannot be cleaned, so spare beds matter.
      if (start + TENANT_DATA.housekeeping.sizeCells <= hi) rooms.push({ type: 'housekeeping', x: start });
      run(start + TENANT_DATA.housekeeping.sizeCells, ['hotelSuite', 'hotelTwin', 'hotel', 'hotel', 'hotelTwin']);
    } else {
      run(start, [role]);
    }
    return rooms;
  }

  // --- the decision loop ----------------------------------------------------

  /** Called by the runner at a regular cadence. */
  decide(): void {
    this.respondToIncidents();
    this.repairCars();
    this.repairDamage();
    if (!this.lobby()) {
      this.buildInitialLobby();
      return;
    }
    this.manageElevators();
    this.buildRequiredFacilities();
    // At 3★+ the next zone needs a sky lobby and the express ($400k): save
    // for it instead of spending everything on rooms first.
    if (this.state.starLevel >= 3 && topFloorIndex(this.state.tower) >= this.buildCeiling() && this.buildCeiling() < CONFIG.MAX_FLOORS) {
      this.ensureTransport();
      if (topFloorIndex(this.state.tower) >= this.buildCeiling()) return;
    }
    this.widenTower();
    this.fillRooms();
    this.growUpward();
  }

  /** Cheap per-tick-ish checks during rushes (incidents have short deadlines). */
  react(): void {
    this.respondToIncidents();
    this.repairCars();
  }

  private buildInitialLobby(): void {
    for (let x = 0; x < INITIAL_LOBBY_CELLS; x++) {
      const error = placementError(this.state, 'lobby', LOBBY, x);
      if (error) { this.reject('lobby', error); return; }
      if (!this.attempt('lobby', () => placeTenant(this.state, 'lobby', LOBBY, x))) return;
    }
  }

  private respondToIncidents(): void {
    for (const incident of [...this.state.campaign.incidents]) {
      if (incident.response !== null || incident.kind === 'vip') continue;
      if (incident.kind === 'fire') {
        // A nearby fire station makes rescue cheap; otherwise try free
        // security first while there is still time for rescue if it fails.
        const rescue = responseQuote(this.state, incident.id, 'rescue');
        const security = responseQuote(this.state, incident.id, 'security');
        const rescueAfter = this.state.tickCount + security.delayTicks + rescue.delayTicks;
        const useSecurity = rescue.costCents > dollars(CONFIG.FIRE_STATION_RESCUE_COST_DOLLARS) &&
          security.error === null && rescueAfter <= incident.deadline;
        if (useSecurity) this.attempt('respond fire (security)', () => respondToIncident(this.state, incident.id, 'security'));
        else this.attempt('respond fire (rescue)', () => respondToIncident(this.state, incident.id, 'rescue'));
      }
      else if (incident.kind === 'infestation') this.attempt('respond infestation', () => respondToIncident(this.state, incident.id, 'exterminate'));
      else if (incident.kind === 'bomb') {
        if (!this.attempt('respond bomb (search)', () => respondToIncident(this.state, incident.id, 'search'))) {
          this.attempt('respond bomb (ransom)', () => respondToIncident(this.state, incident.id, 'ransom'));
        }
      }
    }
  }

  /** Pay to fix broken cars that no maintenance office can reach. */
  private repairCars(): void {
    for (const group of this.state.elevatorGroups.values()) {
      for (const car of group.cars) {
        if (!car.outOfService || car.repairAtTick !== undefined) continue;
        if (repairElevatorCarError(this.state, group.id, car.id)) continue;
        this.attempt('repair elevator car', () => repairElevatorCar(this.state, group.id, car.id));
      }
    }
  }

  private repairDamage(): void {
    for (const tenant of this.state.tenants.values()) {
      if (tenant.state !== 'damaged') continue;
      if (!this.canSpend(dollars(TENANT_DATA[tenant.type].costDollars / 4))) continue;
      this.attempt('repair', () => repairTenant(this.state, tenant.id));
    }
  }

  // --- vertical transport ---------------------------------------------------

  private placeShaft(label: string, lo: number, hi: number, x: number, kind: ElevatorKind, transport = false): ElevatorGroup | undefined {
    const error = elevatorPlacementError(this.state, lo, hi, x, kind);
    if (error) { this.reject(label, error); return undefined; }
    const cost = dollars(CONFIG.ELEVATOR_PRICES[kind].shaft);
    if (!(transport ? this.canSpendTransport(cost) : this.canSpend(cost))) return undefined;
    let group: ElevatorGroup | undefined;
    this.attempt(label, () => { group = placeElevatorGroup(this.state, lo, hi, x, kind); });
    return group;
  }

  private extendShaft(label: string, group: ElevatorGroup, lo: number, hi: number): boolean {
    if (group.serviceLo === lo && group.serviceHi === hi) return true;
    const error = elevatorServiceRangeError(this.state, group.id, lo, hi);
    if (error) { this.reject(label, error); return false; }
    return this.attempt(label, () => setElevatorServiceRange(this.state, group.id, lo, hi));
  }

  /** Make sure zone k's primary bank reaches every built floor in the zone. */
  private ensureBank(k: number): void {
    const [zoneLo, zoneHi] = PlaythroughBot.zoneRange(k);
    const hi = Math.min(zoneHi, topFloorIndex(this.state.tower));
    if (hi <= zoneLo) return;
    for (let i = 0; i < BANKS_PER_ZONE; i++) {
      const key = `${k}:${i}`;
      const existing = this.group(this.banks.get(key));
      if (!existing) {
        if (i > 0) return; // extra banks are added on congestion only
        const group = this.placeShaft(`bank ${key}`, zoneLo, hi, PlaythroughBot.bankX(k, i), 'standard', true);
        if (group) this.banks.set(key, group.id);
        return;
      }
      if (existing.serviceHi < hi) this.extendShaft(`extend bank ${key}`, existing, existing.serviceLo, hi);
    }
  }

  private congestion(group: ElevatorGroup): { max: number; total: number } {
    let max = 0;
    let total = 0;
    for (const floor of group.stops) {
      for (const dir of ['up', 'down'] as const) {
        const n = queueLength(this.state, floor, dir, group.id);
        max = Math.max(max, n);
        total += n;
      }
    }
    return { max, total };
  }

  /** Rough car budget for a shaft from the room capacity on its stops. */
  private carsNeeded(group: ElevatorGroup): number {
    const lo = group.kind === 'express' ? ZONE + 1 : group.serviceLo;
    const hi = group.kind === 'express' ? CONFIG.MAX_FLOORS : group.serviceHi;
    let riders = 0;
    for (const t of this.state.tenants.values()) {
      if (t.floor < lo || t.floor > hi || t.floor === LOBBY || t.state === 'constructing') continue;
      riders += t.type === 'fastfood' || t.type === 'restaurant' || t.type === 'shop' ? 35 : t.capacity;
    }
    // Parallel banks share the load.
    const parallel = [...this.state.elevatorGroups.values()].filter(g => g.kind === group.kind && g.serviceLo === group.serviceLo && g.serviceHi === group.serviceHi).length;
    return Math.max(1, Math.ceil(riders / 100 / parallel));
  }

  private manageElevators(): void {
    for (const group of this.state.elevatorGroups.values()) {
      for (const car of group.cars) {
        while (car.speedLevel < CONFIG.ELEVATOR_SPEED_LEVELS.length && this.canSpend(dollars(CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS))) {
          if (!this.attempt('upgrade car speed', () => upgradeCarSpeed(this.state, group.id, car.id))) break;
        }
      }
    }
    this.checkCongestion();
  }

  /** Add a car where a shaft's queues back up; open a second bank when full. */
  checkCongestion(): void {
    for (const group of [...this.state.elevatorGroups.values()]) {
      const { max, total } = this.congestion(group);
      const busy = max >= 12 || total >= 8 * group.cars.length;
      if (!busy) continue;
      // Cars cost upkeep every quarter: only add one when the floors served
      // actually house enough people to need it (~100 riders per car).
      if (group.cars.length >= this.carsNeeded(group)) continue;
      if (group.cars.length < CONFIG.MAX_CARS_PER_SHAFT) {
        if (this.canSpendTransport(dollars(CONFIG.ELEVATOR_PRICES[group.kind].car))) {
          this.attempt(`add ${group.kind} car`, () => addElevatorCar(this.state, group.id));
          for (const car of group.cars) {
            while (car.speedLevel < CONFIG.ELEVATOR_SPEED_LEVELS.length && this.canSpendTransport(dollars(CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS))) {
              if (!this.attempt('upgrade car speed', () => upgradeCarSpeed(this.state, group.id, car.id))) break;
            }
          }
        }
        continue;
      }
      // A full standard bank gets a parallel bank over the same floors.
      for (const [key, id] of [...this.banks]) {
        if (id !== group.id) continue;
        const k = Number(key.split(':')[0]);
        for (let i = 1; i < BANKS_PER_ZONE; i++) {
          const twinKey = `${k}:${i}`;
          if (this.group(this.banks.get(twinKey))) continue;
          const twin = this.placeShaft(`bank ${twinKey}`, group.serviceLo, group.serviceHi, PlaythroughBot.bankX(k, i), 'standard', true);
          if (twin) this.banks.set(twinKey, twin.id);
          break;
        }
      }
      if (group.kind === 'standard' && this.state.elevatorGroups.size >= 24) this.note('shaft-cap', 'a congested bank is at 8 cars and the 24-shaft limit is reached');
      if (group.kind === 'express') this.note('express-full', `express shaft at ${CONFIG.MAX_CARS_PER_SHAFT} cars is still congested (max queue ${max}, ${total} waiting)`);
    }
  }

  // --- tower shape ------------------------------------------------------------

  private widenTower(): void {
    const lobby = this.lobby()!;
    const lobbyCost = dollars(TENANT_DATA.lobby.costDollars);
    // Widen the lobby a room-width at a time whenever cash allows; floors
    // follow below, so every chunk turns into new rentable space.
    const floorsAbove = this.state.tower.floors.filter(f => f.index > LOBBY).length;
    const chunkCost = WIDEN_CHUNK * (lobbyCost + dollars(500) * floorsAbove);
    // Building up is far cheaper per room than widening, so widen only when
    // the tower cannot grow taller yet (or cash is plentiful).
    const capped = topFloorIndex(this.state.tower) >= this.buildCeiling();
    if ((capped || this.funds > dollars(2_500_000)) && lobby.x + lobby.sizeCells < W && this.canSpend(chunkCost + dollars(capped ? 0 : 300_000))) {
      for (let i = 0; i < WIDEN_CHUNK && lobby.x + lobby.sizeCells < W; i++) {
        const x = lobby.x + lobby.sizeCells;
        const error = placementError(this.state, 'lobby', LOBBY, x);
        if (error) { this.reject('extend lobby', error); break; }
        if (!this.attempt('extend lobby', () => placeTenant(this.state, 'lobby', LOBBY, x))) break;
      }
    }
    // Then carry the extra width up (and down) floor by floor.
    const lobbyHi = lobby.x + lobby.sizeCells;
    for (const floor of this.state.tower.floors) {
      if (floor.index === LOBBY) continue;
      const { hi } = floorBounds(this.state, floor.index);
      if (hi >= lobbyHi) continue;
      const cost = dollars(500) * (lobbyHi - hi);
      if (!this.canSpend(cost + dollars(capped ? 0 : 300_000))) break;
      const error = floorExtensionError(this.state, floor.index, lobbyHi - 1);
      if (error) { this.reject('extend floor', error); if (floor.index > LOBBY) break; continue; }
      this.attempt('extend floor', () => extendFloor(this.state, floor.index, lobbyHi - 1));
    }
  }

  private growUpward(): void {
    const top = topFloorIndex(this.state.tower);
    // Only grow when every built floor's planned rooms are placed.
    // Rooms still locked behind a star rating (reserved hotel floors) wait.
    for (let f = 2; f <= top; f++) if (this.freeRooms(f).some(room => isUnlocked(this.state, room.type))) return;
    if (top >= this.buildCeiling()) {
      if (top < CONFIG.MAX_FLOORS) this.note(`ceiling-${top}`, `growth paused at floor ${top} (needs ${this.state.starLevel < 3 ? '3★ for sky lobbies/express' : 'sky lobby + express'})`);
      return;
    }
    const next = top + 1;
    const error = buildFloorError(this.state, next);
    if (error) { this.reject('build floor', error); return; }
    if (!this.canSpend(dollars(CONFIG.FLOOR_COST_BASE_DOLLARS + CONFIG.FLOOR_COST_STEP_DOLLARS * Math.max(0, next - 2)) + dollars(150_000))) return;
    if (!this.attempt('build floor', () => buildFloor(this.state, next))) return;
    this.ensureTransport();
  }

  /** Banks for every zone, sky lobbies + express, the hotel service shaft. */
  private ensureTransport(): void {
    const top = topFloorIndex(this.state.tower);
    for (let k = 0; k <= PlaythroughBot.zoneOf(top); k++) this.ensureBank(k);
    if (this.state.starLevel >= 3) {
      for (const sky of SKY_FLOORS) {
        if (sky > top) break;
        if (!this.skyLobbyOn(sky)) {
          const error = placementError(this.state, 'skyLobby', sky, EXPRESS_X);
          if (error) { this.reject('sky lobby', error); break; }
          if (!this.attempt('sky lobby', () => placeTenant(this.state, 'skyLobby', sky, EXPRESS_X))) break;
        }
        const express = this.group(this.expressId);
        if (!express) {
          const group = this.placeShaft('express', LOBBY, sky, EXPRESS_X, 'express', true);
          if (!group) break;
          this.expressId = group.id;
        } else if (express.serviceHi < sky && !this.extendShaft('extend express', express, express.serviceLo, sky)) break;
      }
    }
    const lo = Math.min(...this.hotelFloors);
    const hi = Math.min(Math.max(...this.hotelFloors), top);
    if (hi > lo && this.state.starLevel >= 2) {
      const service = this.group(this.serviceId);
      if (!service) {
        const group = this.placeShaft('service shaft', lo, hi, SERVICE_X, 'service', true);
        if (group) this.serviceId = group.id;
      } else if (service.serviceHi < hi) this.extendShaft('extend service', service, service.serviceLo, hi);
    }
  }

  private freeRooms(floor: number): { type: TenantType; x: number }[] {
    const f = getFloor(this.state.tower, floor);
    if (!f) return [];
    const free = this.plannedRooms(floor).filter(room => {
      const size = TENANT_DATA[room.type].sizeCells;
      return f.cells.slice(room.x, room.x + size).every(c => c.content === 'empty');
    });
    if (this.roleOf(floor) !== 'commercial') return free;
    // Shops and restaurants pay back slowly: open one per ~150 residents/workers.
    const commercial = [...this.state.tenants.values()].filter(t => COMMERCIAL_TYPES.includes(t.type)).length;
    return free.slice(0, Math.max(0, Math.max(1, Math.floor(population(this.state) / 150)) - commercial));
  }

  private fillRooms(): void {
    this.ensureTransport();
    const top = topFloorIndex(this.state.tower);
    let placed = 0;
    for (let floor = 2; floor <= top && placed < 40; floor++) {
      // Rooms only go where a passenger route from the lobby already exists.
      if (pickupRoute(this.state, LOBBY, floor, 'officeWorker') === null) continue;
      for (const room of this.freeRooms(floor)) {
        if (!this.canSpend(dollars(TENANT_DATA[room.type].costDollars))) return;
        const error = placementError(this.state, room.type, floor, room.x);
        if (error) {
          // Locked types wait for their star; anything else is worth knowing.
          if (!error.startsWith('Requires')) this.reject(`place ${room.type}`, error);
          continue;
        }
        if (this.attempt(`place ${room.type}`, () => placeTenant(this.state, room.type, floor, room.x))) placed++;
      }
    }
  }

  // --- star requirements --------------------------------------------------------

  private placeOnce(type: TenantType, floor: number, x: number, extraReserve = 0): void {
    if (this.tenantsOf(type).length > 0) return;
    if (!this.canSpend(dollars(TENANT_DATA[type].costDollars) + extraReserve)) return;
    const error = placementError(this.state, type, floor, x);
    if (error) { if (!error.startsWith('Requires')) this.reject(`place ${type}`, error); return; }
    this.attempt(`place ${type}`, () => placeTenant(this.state, type, floor, x));
  }

  private ensureBasements(lowest: number): boolean {
    for (let f = -1; f >= lowest; f--) {
      if (getFloor(this.state.tower, f)) continue;
      const error = buildFloorError(this.state, f);
      if (error) { this.reject('build basement', error); return false; }
      if (!this.canSpend(dollars(15_000 + 5_000 * -f) + dollars(100_000))) return false;
      if (!this.attempt('build basement', () => buildFloor(this.state, f))) return false;
    }
    return true;
  }

  private buildRequiredFacilities(): void {
    const stars = this.state.starLevel;
    if (stars >= 2) this.placeOnce('security', 2, SECURITY_X);
    // Mechanics on floor 2 cover the lobby banks (they walk to their landing).
    if (stars >= 2 && this.tenantsOf('maintenance').length === 0) {
      const { hi } = floorBounds(this.state, 2);
      const x = hi - TENANT_DATA.maintenance.sizeCells;
      if (getFloor(this.state.tower, 2)?.cells.slice(x, hi).every(c => c.content === 'empty')) this.placeOnce('maintenance', 2, x);
    }
    if (stars >= 3) {
      this.placeOnce('medical', 2, MEDICAL_X);
      // Waste grows by people/500 a day and each center removes 10: keep up.
      const wanted = Math.max(1, Math.ceil(this.state.people.size / 5000));
      const centers = this.tenantsOf('recycling').length;
      if (centers < wanted && this.ensureBasements(-2)) {
        const x = 40 + centers * TENANT_DATA.recycling.sizeCells;
        if (this.canSpend(dollars(TENANT_DATA.recycling.costDollars + 200_000))) {
          const error = placementError(this.state, 'recycling', -2, x);
          if (error) this.reject('place recycling', error);
          else this.attempt('place recycling', () => placeTenant(this.state, 'recycling', -2, x));
        }
      }
      // Parking: one ramp on B1 with spaces once the tower is comfortably rich.
      if (this.funds > dollars(5_000_000)) {
        this.placeOnce('parkingRamp', 0, 100);
        if (this.tenantsOf('parkingRamp').length > 0) {
          const { hi } = floorBounds(this.state, 0);
          for (let x = 116; x + 4 <= hi; x += 4) {
            const cell = getFloor(this.state.tower, 0)?.cells[x];
            if (cell?.content !== 'empty') continue;
            if (placementError(this.state, 'parkingSpace', 0, x)) continue;
            if (!this.canSpend(dollars(TENANT_DATA.parkingSpace.costDollars))) break;
            this.attempt('place parkingSpace', () => placeTenant(this.state, 'parkingSpace', 0, x));
          }
        }
      }
    }
    if (stars >= 4 && this.tenantsOf('metro').length === 0 && this.funds > dollars(3_000_000)) {
      if (this.ensureBasements(METRO_FLOOR)) {
        // Extend the lobby bank down so passengers can reach the station.
        const bank = this.group(this.banks.get('0:0'));
        if (bank && bank.serviceLo > METRO_FLOOR) this.extendShaft('extend bank to basement', bank, METRO_FLOOR, bank.serviceHi);
        this.placeOnce('metro', METRO_FLOOR, 40);
      }
    }
    if (stars >= 5 && topFloorIndex(this.state.tower) >= CATHEDRAL_FLOOR + 3) this.placeOnce('cathedral', CATHEDRAL_FLOOR, CATHEDRAL_X);
  }

  /** Unmet requirements for the next rating, for progress lines. */
  unmetNext(): string[] {
    if (this.state.starLevel >= 6) return [];
    return progressionRequirements(this.state, this.state.starLevel + 1).filter(r => !r.met).map(r => r.label);
  }
}
