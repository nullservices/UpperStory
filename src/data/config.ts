/**
 * ALL tunable game constants live here. Values marked "approx" are our design
 * guesses to tune by playtesting — the original's exact formulas were never
 * decoded from the source or save format.
 */

export const CONFIG = {
  // --- Time ---
  /** Real ms per sim tick at 1x speed. */
  TICK_MS: 100,

  // --- Tower geometry ---
  /** Player-facing floor width in placement cells. (Original stored 375 fine tiles/floor.) */
  FLOOR_WIDTH_CELLS: 375,
  /** World-pixel height of one floor band at zoom 1. */
  FLOOR_HEIGHT_PX: 20,
  /** The lobby floor is visually this many floors tall. */
  LOBBY_HEIGHT_FLOORS: 1,
  /** Floor index of B1 (below ground). */
  BASEMENT_FLOOR_INDEX: 0,
  MIN_FLOOR_INDEX: -8,
  /** Floor index of the ground/lobby floor. */
  LOBBY_FLOOR_INDEX: 1,
  /** Highest buildable floor. */
  MAX_FLOORS: 100,

  // --- Money (approx — tune) ---
  STARTING_FUNDS_DOLLARS: 2_000_000,
  /** Floor N (N≥2) costs base + step×(N−2). */
  FLOOR_COST_BASE_DOLLARS: 15_000,
  FLOOR_COST_STEP_DOLLARS: 5_000,
  /** One stair cell. */
  STAIR_COST_DOLLARS: 5_000,
  MAX_STAIRS_ESCALATORS: 64,

  // --- Day cycle (reverse-engineered: 2600 ticks/day, day starts 7:00 AM) ---
  DAY_TICKS: 2600,
  /**
   * Piecewise-linear tick→minute mapping, in tick order. Minutes run from 420
   * (07:00) to 1860 (07:00 + 24h); normalize with % 1440 for display. The
   * lunch rush and the compressed night match the original's tick budget.
   */
  DAY_SEGMENTS: [
    { fromMin: 420, toMin: 720, ticks: 400 }, // 07:00–12:00
    { fromMin: 720, toMin: 780, ticks: 800 }, // 12:00–13:00 lunch rush
    { fromMin: 780, toMin: 1500, ticks: 1200 }, // 13:00–01:00
    { fromMin: 1500, toMin: 1860, ticks: 200 }, // 01:00–07:00 (night, compressed)
  ],

  // --- Vertical transport (approx — tune) ---
  ELEVATOR_CAPACITY: 21,
  /** Capacities documented in tower-docs, Elevator Header byte 2. */
  ELEVATOR_CAPACITIES: { standard: 21, express: 42, service: 10 },
  /** Floors per tick at speed level 1 (level 2/3 in ELEVATOR_SPEED_LEVELS). */
  ELEVATOR_SPEED_LEVELS: [0.2, 0.3, 0.45],
  ELEVATOR_DOOR_TICKS: 2,
  MAX_CARS_PER_SHAFT: 8,
  MAX_SHAFT_FLOORS: 29,
  ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS: 500,
  ELEVATOR_PRICES: {
    standard: { shaft: 200_000, car: 80_000, shaftUpkeepQuarter: 10_000, carUpkeepQuarter: 10_000 },
    service: { shaft: 100_000, car: 50_000, shaftUpkeepQuarter: 10_000, carUpkeepQuarter: 10_000 },
    express: { shaft: 400_000, car: 150_000, shaftUpkeepQuarter: 20_000, carUpkeepQuarter: 20_000 },
  },
  ELEVATOR_SPEED_UPGRADE_COST_DOLLARS: 1_500,
  ESCALATOR_COST_DOLLARS: 20_000,
  /** Waiting people per direction per floor (reverse-engineered cap). */
  QUEUE_MAX_PER_SIDE: 40,

  // --- People (approx — tune) ---
  PERSON_WALK_CELLS_PER_TICK: 0.5,
  STAIR_TICKS_PER_FLOOR: 12,
  ESCALATOR_TICKS_PER_FLOOR: 8,
  /** People take stairs only for short hops. */
  STAIR_MAX_FLOORS: 4,
  ESCALATOR_MAX_FLOORS: 7,
  PATIENCE_BASE_TICKS: 400,
  PATIENCE_STRESS_DIVISOR: 10,
  STRESS_WALK_PER_TICK: 0.02,
  STRESS_WAIT_PER_TICK: 0.15,
  STRESS_RIDE_PER_TICK: 0.05,
  STRESS_STAIR_PER_TICK: 0.08,
  STRESS_GIVEUP: 25,
  STRESS_DECAY_PER_TICK: 0.01,
  STRESS_MAX: 100,
  /** Waiting in a tall lobby stresses more (CalcLobbyStress equivalent). */
  LOBBY_STRESS_HEIGHT_FACTOR: 0.02,
  ARRIVAL_JITTER_TICKS: 30,

  // --- Schedules (minutes-of-day; 540 = 09:00, 1080 = 18:00) ---
  SCHEDULES: {
    officeWorker: [
      { atMin: 540, action: 'gotoOffice' },
      { atMin: 720, action: 'gotoLunch' }, // 12:00
      { atMin: 780, action: 'returnToOffice' }, // 13:00
      { atMin: 1080, action: 'goHome' }, // 18:00
    ],
    resident: [
      { atMin: 480, action: 'gotoLobby' }, // 08:00
      { atMin: 720, action: 'goHome' }, // 12:00
      { atMin: 810, action: 'gotoLobby' }, // 13:30
      { atMin: 1080, action: 'goHome' }, // 18:00
    ],
    guard: [
      { atMin: 540, action: 'gotoRandom' },
      { atMin: 720, action: 'gotoRandom' },
      { atMin: 900, action: 'gotoRandom' },
      { atMin: 1080, action: 'goHome' },
    ],
    housekeeper: [
      { atMin: 480, action: 'goWork' },
      { atMin: 600, action: 'goWork' },
      { atMin: 720, action: 'goWork' },
      { atMin: 840, action: 'goWork' },
      { atMin: 960, action: 'goWork' },
      { atMin: 1080, action: 'goHome' },
    ],
    hotelGuest: [{ atMin: 660, action: 'leave' }], // checkout 11:00 (next day)
    // Visitors (diner/shopper) have no schedule — they arrive already on a trip
    // and leave when their activity timer ends.
    diner: [],
    shopper: [],
  },

  // --- Visitors (approx — tune) ---
  /** Expected spawns per tick while the window is open. */
  DINER_SPAWN_RATE: 0.6,
  SHOPPER_SPAWN_RATE: 0.15,
  HOTEL_GUEST_SPAWN_RATE: 0.12,
  SHOPPER_WINDOW_MIN: 540, // 09:00
  SHOPPER_WINDOW_MAX: 1080, // 18:00
  GUEST_WINDOW_MIN: 660, // 11:00
  GUEST_WINDOW_MAX: 1380, // 23:00
  /** Hard cap on tracked people (M5 perf target: 5,000 at 60 fps). */
  MAX_PEOPLE: 30_000,
  EAT_TICKS: 250,
  SHOP_TICKS: 180,
  GUEST_CHECKIN_TICKS: 100,

  // --- Economy (approx — tune by playtest) ---
  OFFICE_RENT_DAILY_DOLLARS: 3_333,
  CONDO_RENT_DAILY_DOLLARS: 0,
  HOTEL_RATE_NIGHTLY_DOLLARS: 120,
  RESTAURANT_MEAL_DOLLARS: 15,
  FASTFOOD_MEAL_DOLLARS: 8,
  SHOP_SALE_DOLLARS: 8,
  GUARD_WAGE_DAILY_DOLLARS: 200,
  HOUSEKEEPER_WAGE_DAILY_DOLLARS: 200,
  QUARTER_DAYS: 3,
  /** Pricing levels: visitor volume multiplier vs revenue multiplier. */
  PRICING_LEVELS: [
    { label: 'very low', visitorMult: 1.6, revenueMult: 0.6 },
    { label: 'low', visitorMult: 1.25, revenueMult: 0.8 },
    { label: 'average', visitorMult: 1.0, revenueMult: 1.0 },
    { label: 'high', visitorMult: 0.75, revenueMult: 1.35 },
  ],

  // --- Hotels & cleaning (approx) ---
  HOTEL_CLEAN_DECAY_PER_TICK: 0.02,
  HOUSEKEEPER_CLEAN_PER_TICK: 0.6,
  CLEAN_TICKS: 600,
  DIRTY_HOTEL_THRESHOLD: 30,
  DIRTY_HOTEL_STRESS_PER_TICK: 0.08,

  // --- Evaluation (JudgeT equivalent; approx) ---
  /** Evaluation runs once per day at this minute-of-day (everyone present). */
  EVAL_TIME_MIN: 900, // 15:00
  EVAL_GRADE_THRESHOLDS: [15, 35, 55, 75, 90], // score ≥ threshold → grade
  EVAL_VACANCY_DAYS: 3, // grade ≤ 1 for this many days → tenant vacates
  EVAL_REPOPULATE_DAYS: 2, // grade ≥ 2 for this many days → vacant refills

  // --- Render (tunable but render-side) ---
  /** World-pixel width of one placement cell at zoom 1. */
  CELL_WIDTH_PX: 12,

  // --- Camera ---
  MIN_ZOOM: 0.5,
  MAX_ZOOM: 3,
  ZOOM_STEP: 1.15,
} as const;

export interface TenantTypeData {
  /** Width in placement cells. */
  sizeCells: number;
  /** Upfront construction cost in dollars (paid on placement, no refunds). */
  costDollars: number;
  /** Construction duration in sim ticks; 0 = instant. */
  constructionTicks: number;
  /** Star level at which the tool unlocks (1..5). */
  unlockedAtStar: number;
  /** People capacity once open (0 = no fixed capacity, e.g. lobby). */
  capacity: number;
  /** Must span the entire floor (lobby). */
  requiresFullFloor?: boolean;
  /** If set, only placeable on this floor index. */
  floorRestriction?: number;
  heightFloors?: number;
  basementOnly?: boolean;
  limit?: number;
  upkeepDaily?: number;
}

/**
 * Tenant types and their data. Approx values — tune by playtest.
 * M3 adds restaurant / fastfood / shop / hotel / security / housekeeping.
 */
export const TENANT_DATA = {
  lobby: {
    sizeCells: CONFIG.FLOOR_WIDTH_CELLS,
    costDollars: 0,
    constructionTicks: 0,
    unlockedAtStar: 1,
    capacity: 0,
    requiresFullFloor: true,
    floorRestriction: CONFIG.LOBBY_FLOOR_INDEX,
  },
  office: {
    sizeCells: 9,
    costDollars: 40_000,
    constructionTicks: 1_300,
    unlockedAtStar: 1,
    capacity: 6, // 6 workers per office (reverse-engineered save format)
  },
  condo: {
    sizeCells: 16,
    costDollars: 80_000,
    constructionTicks: 800,
    unlockedAtStar: 1,
    capacity: 3, // 3 residents per condo (reverse-engineered save format)
  },
  fastfood: {
    sizeCells: 16,
    costDollars: 100_000,
    constructionTicks: 600,
    unlockedAtStar: 1,
    capacity: 35, // seats
  },
  security: {
    sizeCells: 16,
    costDollars: 100_000,
    constructionTicks: 900,
    unlockedAtStar: 2,
    capacity: 1, // 1 guard
  },
  housekeeping: {
    sizeCells: 15,
    costDollars: 50_000,
    constructionTicks: 900,
    unlockedAtStar: 2,
    capacity: 6, // 1 housekeeper
  },
  hotel: {
    sizeCells: 4,
    costDollars: 20_000,
    constructionTicks: 2_200,
    unlockedAtStar: 2,
    capacity: 1, // single hotel room
  },
  restaurant: {
    sizeCells: 24,
    costDollars: 200_000,
    constructionTicks: 1_800,
    unlockedAtStar: 3,
    capacity: 35, // seats
  },
  shop: {
    sizeCells: 12,
    costDollars: 100_000,
    constructionTicks: 1_000,
    unlockedAtStar: 3,
    capacity: 25, // concurrent shoppers
  },
  skyLobby: {
    sizeCells: 3, // wide enough for a 2-cell express shaft to run through
    costDollars: 5_000,
    constructionTicks: 400,
    unlockedAtStar: 3,
    capacity: 0, // no fixed capacity; evaluation skips it
  },
  hotelTwin: { sizeCells: 6, costDollars: 50_000, constructionTicks: 1600, unlockedAtStar: 2, capacity: 2 },
  hotelSuite: { sizeCells: 10, costDollars: 100_000, constructionTicks: 2200, unlockedAtStar: 2, capacity: 2 },
  partyHall: { sizeCells: 24, heightFloors: 2, costDollars: 100_000, constructionTicks: 2200, unlockedAtStar: 3, capacity: 50, limit: 16 },
  cinema: { sizeCells: 31, heightFloors: 2, costDollars: 500_000, constructionTicks: 2600, unlockedAtStar: 3, capacity: 120, limit: 16 },
  medical: { sizeCells: 26, costDollars: 500_000, constructionTicks: 1800, unlockedAtStar: 3, capacity: 0, limit: 10 },
  parkingRamp: { sizeCells: 16, costDollars: 50_000, constructionTicks: 600, unlockedAtStar: 3, capacity: 0, basementOnly: true, upkeepDaily: 3333 },
  parkingSpace: { sizeCells: 4, costDollars: 3_000, constructionTicks: 100, unlockedAtStar: 3, capacity: 0, basementOnly: true, limit: 512 },
  recycling: { sizeCells: 25, heightFloors: 2, costDollars: 500_000, constructionTicks: 2600, unlockedAtStar: 3, capacity: 0, basementOnly: true, upkeepDaily: 16667 },
  metro: { sizeCells: 30, heightFloors: 3, costDollars: 1_000_000, constructionTicks: 3900, unlockedAtStar: 4, capacity: 0, basementOnly: true, floorRestriction: -8, limit: 1, upkeepDaily: 33333 },
  cathedral: { sizeCells: 28, heightFloors: 4, costDollars: 3_000_000, constructionTicks: 5200, unlockedAtStar: 5, capacity: 0, floorRestriction: 97, limit: 1 },

} as const satisfies Record<string, TenantTypeData>;

/**
 * Star progression. Original gates (allthetropes.org/wiki/SimTower): 2★@300,
 * 3★@1000, 4★@5000, 5★@10000. Facility and event requirements are
 * enforced by progression.ts; the final wedding requires over 15,000 people.
 */
export const PROGRESSION: ReadonlyArray<{ star: number; population: number }> = [
  { star: 2, population: 300 },
  { star: 3, population: 1_000 },
  { star: 4, population: 5_000 },
  { star: 5, population: 10_000 },
  { star: 6, population: 15_001 },
];

/**
 * Kinsoku (placement-adjacency) rules: a tenant of the key type may not be
 * placed directly left/right of any tenant of a forbidden type. The mechanism
 * matches the original (CheckLeftKinsoku/CheckRightKinsoku); the exact
 * original table is undocumented — these are approximations to tune.
 */
export const KINSOKU_FORBIDDEN: Partial<
  Record<keyof typeof TENANT_DATA, readonly (keyof typeof TENANT_DATA)[]>
> = {
  office: ['shop', 'restaurant', 'fastfood'], // noise disturbs the workers
  condo: ['restaurant', 'fastfood'], // smells and crowds
  hotel: ['fastfood'], // noise
};

/** Hotel IDs share guest, housekeeping and evaluation behavior. */
export function isHotel(type: string): boolean {
  return type === 'hotel' || type === 'hotelTwin' || type === 'hotelSuite';
}
export function facilityHeight(type: keyof typeof TENANT_DATA): number {
  return (TENANT_DATA[type] as TenantTypeData).heightFloors ?? 1;
}
