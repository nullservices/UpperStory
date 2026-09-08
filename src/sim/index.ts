/**
 * Public sim API surface. The render layer and controller import from here
 * (or from module paths); nothing sim-internal leaks upward.
 */
export { createInitialState, setupNewGame, setupDemoTower } from './state';
export type { GameState } from './state';
export { tick } from './core/engine';
export {
  createTower,
  emptyCell,
  getFloor,
  buildFloor,
  buildFloorError,
  demolishFloor,
  placeStair,
  stairPlacementError,
  floorCostDollars,
  floorHeightPx,
  floorTopY,
  floorIndexAtWorldY,
  cellIndexAtWorldX,
  topFloorIndex,
} from './tower';
export type { Tower, Floor, GridCell, CellContent } from './tower';
export {
  isUnlocked,
  getTenantAt,
  placementError,
  placeTenant,
  demolishTenant,
  demolishAt,
  stepConstruction,
  cyclePricing,
} from './tenants';
export type { Tenant, TenantType, TenantState } from './tenants';
export {
  elevatorPlacementError,
  placeElevatorGroup,
  addElevatorCar,
  removeElevatorCar,
  upgradeCarSpeed,
  setElevatorServiceRange,
  demolishElevatorGroup,
  escalatorPlacementError,
  placeEscalator,
  groupAt,
  carWorldY,
  carSpeed,
  stepElevators,
} from './elevators';
export type { ElevatorGroup, ElevatorCar, ElevatorKind } from './elevators';
export {
  rebuildRouting,
  checkRouting,
  pickupRoute,
  emptyRoutingTables,
} from './routing';
export type { RoutingTables, RouteLeg } from './routing';
export {
  spawnTenantPeople,
  removeTenantPeople,
  giveUp,
  stepPeople,
  tenantCenter,
  population,
} from './people';
export type { Person, PersonKind, PersonState } from './people';
export {
  joinQueue,
  leaveQueue,
  queueLength,
  queueHead,
  pressCall,
  clearCall,
  callPending,
  anyCallPending,
} from './queues';
export type { QueueDir } from './queues';
export { patienceTicks, lobbyWaitStressMultiplier, stepStress } from './stress';
export { tickToMinute, minuteToTick, formatTimeOfDay, stepTime } from './time';
export type { Calendar } from './time';
export { seedRng, rngNext, rngRange, rngInt, rngPick } from './core/rng';
export { nextId } from './core/ids';
export { pushEvent } from './core/events';
export type { SimEvent } from './core/events';
export {
  spend,
  addMoney,
  formatDollars,
  rentMultiplier,
  stepDailySettlement,
} from './money';
export type { MoneyState } from './money';
export { stepEvaluation } from './evaluation';
export { stepProgression } from './progression';
export { serializeGame, deserializeGame, SAVE_VERSION } from './save';
export type { SaveEnvelope } from './save';
