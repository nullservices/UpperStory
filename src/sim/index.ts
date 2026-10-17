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
  repairElevatorCar,
  repairElevatorCarError,
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
export { tickToMinute, minuteToTick, formatTimeOfDay, stepTime, isWeekend, isWeekendDay, towerDate, formatTowerDate } from './time';
export type { TowerDate } from './time';
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
export {
  recordEvent,
  startIncident,
  respondToIncident,
  responseQuote,
  stepCampaign,
} from './campaign';
export type { Incident, IncidentKind, IncidentResponse, ResponseQuote, HistoryEntry, CampaignState } from './campaign';
export { takeLoan, takeLoanError, repayLoan, repayLoanError, loanLimitCents } from './bank';
export {
  blackoutActive,
  elevatorsPowered,
  hasOpenGenerator,
  fireStationCovers,
  maintenanceReaches,
  maintenanceCoverage,
  maintenanceOfficeReport,
  maintenanceSummary,
  reachableSecurityCount,
} from './services';
export type { MaintenanceCoverage, MaintenanceOfficeReport, MaintenanceSummary } from './services';
export { stepProgression } from './progression';
export {
  SCENARIOS,
  getScenario,
  startScenario,
  stepScenario,
  scenarioProgress,
  scenarioPlacementError,
  scenarioFloorError,
  scenarioLotError,
  scenarioElevatorError,
} from './scenarios';
export type { ScenarioDef, ScenarioState, ScenarioRules, ScenarioOutcome, ScenarioProgress, ObjectiveDef, ObjectiveKind, ObjectiveProgress } from './scenarios';
export { serializeGame, deserializeGame, SAVE_VERSION } from './save';
export type { SaveEnvelope } from './save';
export { towerMetrics, flattenMetrics } from './metrics';
export type { TowerMetrics } from './metrics';
export { stepStats, createStats, compactStats, mergeSamples, statsHistory, tradeOf, STATS_LIMITS } from './stats';
export type { StatsState, StatsSample, StatsField, StatsToday } from './stats';
