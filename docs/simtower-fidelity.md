# SimTower fidelity

Upper Story is an independent implementation. Its tests establish internal
consistency, not equivalence to the original game. Original-game timing and
economic comparisons have not been completed.

## Implemented systems

| Area | Current behavior |
| --- | --- |
| Geometry | 375 cells per floor, floors 1–100 and B1–B9; one-, two- or three-story lobbies selected at new-game creation; multi-floor footprints; legacy saves retain their two-story lobby |
| Construction | Offices, condos, three hotel types, food, shops, cinema, party hall, medical, security, housekeeping, parking ramps and spaces, recycling, metro, cathedral and sky lobbies |
| Transport | Standard, service and express elevators; stairs and directional escalators; 21/10/42 passenger capacities; eight cars per shaft and 24 shafts; operating shaft extension |
| Population | Individual workers, residents, guests, visitors and staff; walking, queues, boarding, rides, activities and departures |
| Service upkeep | Exact quarterly totals for housekeeping, security, parking ramps, recycling, metro and escalators; collected in daily shares with final-day rounding |
| Hotel income | Single/twin/suite full-room baselines of $2k/$3k/$6k per night; guest shares paid at checkout with the selected pricing multiplier |
| Commercial population | Fast food, shops and restaurants update at opening from preceding external visits; office lunch visits earn revenue without counting twice in population |
| Economy | One-time condo sales, office rent, guest and visitor revenue, service upkeep, parking fees and film replacement |
| Condo ownership | Select asking price before sale; lock while owned; reverse original sale on move-out/demolition; sell again to replacement occupants |
| Progression | Population and facility gates, VIP approval, connected metro and the final cathedral wedding |
| Incidents | Fire, bomb threats, infestation, VIP visits, excavation treasure, rain and debt notifications; responses, damage and repair |
| Clock | Date changes and daily settlement at midnight; schedule cycles reset at 07:00 |
| Persistence | Versioned browser saves, campaign history and active incidents; deterministic replay |
| Audio | Original synthesized construction, elevator, interface and event cues; motor and rain ambience; persistent volume/mute controls |
| Housekeeping | Six staff per office; one active cleaner per floor from each office; separate offices can share a floor without duplicating room assignments |
| Elevator management | Per-car home floors, six weekday/weekend priority periods and individual stop controls; existing trips finish when a stop is disabled |
| Construction limits | Shared caps of 64 stairs/escalators, 16 cinemas/party halls and 512 food/retail facilities; 10 security offices; unfinished facilities count |

Catalogue dimensions, purchase costs and rating requirements draw on the
reference below. Simulation formulas and event timing remain approximations.
For example, parking income and waste treatment use simplified daily models.
The facilities tour at `?demo=1` begins at five stars; normal games start at one.

## Incident and modern-facility batch

**Original events (Batch 1, implemented; formulas approximate).**
- Fire response: players choose free security firefighting or paid fire
  rescue, as in the original (manual; fan guides cited in
  [feature-plan.md](feature-plan.md)). Security needs an open office whose
  guards can reach the floor by staff routes; one office arrives in 300 ticks
  with a 40% chance, each extra office adds 15% (cap 90%) and shortens the
  trip. A failed attempt leaves the fire burning and can be retried. Rescue
  costs $50,000 and arrives in 150 ticks. Unverified: the original's
  probabilities, timings and rescue price.
- Fire spread: an unanswered fire tries to spread every 250 ticks, igniting
  each touching room on its floor(s) and each room directly above with a 60%
  chance, at most two per attempt and eight fires at once; new fires start
  their own clocks. A response underway pauses spreading. Spreading is reported
  for the original; its geometry and rate are our approximation.
- Bomb search: the 500-tick sweep is divided by the number of security offices
  whose guards can reach the floor; with none, only the ransom remains.
  Unverified: the original's search timing.
- Journal entries now carry the floor and column where cheap (incidents,
  spread, breakdowns, repairs) so the journal can jump to them.

**Upper Story originals (Batch 2, not in SimTower).**
- Responders: firefighters and mechanics may ride any car, stairs or
  escalators (guards and housekeepers keep to the original's service-car
  rule). A responder reaches a floor that is their own or that any public or
  staff route connects to.
- Fire station (2★): a station within 20 floors whose firefighters can reach
  the fire makes rescue $20,000 and 60 ticks, and prevents spread.
- Maintenance (2★): an office looks after every shaft with a stop within 15
  floors that its mechanics can reach; once inside, they work along the whole
  shaft. Each office has three mechanics, one broken car each, so repair
  capacity scales with offices. A broken car on a covered shaft gets the
  nearest office with a free mechanic; the repair takes 120 ticks plus 2 per
  floor travelled (office to entry stop to car). Cars wait for a free
  mechanic otherwise. A repair stops if its office closes. A new office
  announces how many shafts it covers, and each breakdown message says
  whether mechanics are coming, busy, or that no office covers the shaft.
- Elevator breakdowns (from 2★): each car rolls daily for a breakdown (mean
  once per 12 days; a quarter as often on covered shafts). A broken car
  coasts to the nearest floor and unloads riders (who re-plan from there). It
  is ignored by dispatch, and by routing once every car in the shaft is
  broken; people already queued for such a shaft re-plan at once instead of
  waiting out their patience. Uncovered cars stay broken until a $10,000
  manual repair.
- Blackouts (from 2★): a 3% daily chance in clear weather, 15% in rain; lasts
  60–120 game minutes. Cars hold position (doors finish) unless an open
  basement generator exists; waiting stress accrues normally.
- Bank (3★): weekday customers 09:00–17:00 pay $150 each and count toward
  population like shop visitors; loans up to $500,000 per bank plus $200 per
  person, at 3% interest per quarter charged at quarterly settlement (included
  in the quarter report's expenses).
- Rooftop pool (3★) and helipad (4★): roof only (no built floor above the
  footprint; no floor may be built or extended over them). Residents and hotel
  guests swim in the evenings and all weekend; condos and hotel rooms within
  10 floors gain 8 evaluation points. VIPs fly in to a connected helipad, and a
  helipad extends any open medical center's cover tower-wide.
- Fire stations, maintenance offices, generators, pools and helipads are not
  graded on occupancy. Tower events use their own seeded random stream, so
  they never shift the main stream. Saves are version 11 (cars record the
  repairing office); version 10 repairs in progress finish on their old clock,
  and version 9 saves load with fresh spread clocks for active fires.

## Remaining fidelity work

See the [bounded work roadmap](fidelity-roadmap.md) for elevator batch status,
wider work tracks and their completion criteria.

### Current checkpoint

Construction width controls are implemented but still need original-game
comparison; the active pass is elevator management. Player-built lobby
width, drag extension, maintenance and transport coverage are implemented.
New upper floors inherit the built bounds below them. The Floor tool extends
either edge within the support below; upper floors retain their own widths
when lower floors expand. Rooms and transport require built floor coverage.
Version 9 saves preserve these bounds; older floors retain their full width.
Extension pricing ($500 per cell) is provisional. Empty upper-floor edges can
be trimmed one cell at a time, working downward, without refunds. Occupied edges
require removing the room or transport first. Clicking inside a completely empty
top floor still removes the whole floor. These trimming rules remain unverified
against the original. New towers receive B1 beneath built lobby cells; deeper
basements inherit the width above. Side excavation uses the Basement tool,
working downward at a provisional $500 per cell. Existing basements retain their
widths. Empty basement edges can be backfilled one cell at a time, working from
the deepest level upward, without refunds. Empty deepest B2–B9 levels can still
be removed whole from an interior cell. B1 can be backfilled completely and
re-excavated with the Basement tool; its level record remains in the save.
These excavation and backfilling rules need original-game verification.
Lobby edge demolition is implemented,
with transport protection and a continuous-lobby restriction that remains
unverified against the original. Existing saves retain their dimensions.

Desktop camera scale now starts at 140% from 1366px-wide windows through
ultrawide, and resizing preserves the world point at the viewport center.
This is a modern usability change, not an original-game fidelity claim.
Comprehensive visual checks across screen sizes remain outstanding.

After construction, work proceeds through elevator dispatch and controls,
traffic and economics, service coverage and incidents, then presentation.
Each simulation pass needs measured PC 1.0 comparison scenarios before it can
be considered equivalent. Importing or exporting original TDT saves is out of
scope.


- Compare original PC gameplay against repeatable morning, lunch and evening
  traffic scenarios. Calibrate dispatch, journey times, patience and stress.
  Queue patience now falls as stress rises (400 ticks unstressed, 350 at maximum
  stress), so stressed people give up sooner instead of later. The direction
  follows the original's stress model; the amount remains an approximation.
  Dispatch now filters occupied hall queues by the passenger's assigned shaft
  and direction, including calls collected while moving. A different shaft
  clearing the shared hall signal no longer hides waiting passengers. This fixes
  an internal routing inconsistency; it does not establish original dispatch
  equivalence. Car management displays current movement, destination and door state.
  Hall queue capacity is now 40 people per shaft, floor and direction, rather
  than shared by every shaft on a floor. Routing congestion scores count only
  the candidate shaft's waiters. Arrival order and existing queue saves are
  preserved; the congestion weighting remains an approximation.
- Compare weekday/weekend schedules, priorities and home-floor dispatch against
  the original. Six configurable periods, direction priority and per-car homes
  are implemented; period boundaries and priority weighting are our own model.
  New cars receive a home at the lowest enabled stop. Home stops cannot be
  disabled or excluded by shaft resizing until all assigned cars are moved to
  another home. Legacy unassigned cars remain unchanged until assigned a home.
  Reassigning a home schedules a visit before new pickups. Cars finish their
  current movement and deliver riders already aboard first; they skip new
  pickups until reaching that home. Pending visits survive saves. Default home
  selection and the exact treatment of an occupied or moving car still need
  original-game comparison.
  Waiting-car response is configurable per period, defaulting to the manual's
  five-floor advantage: an idle car waits for an approaching eligible moving car
  unless it is at least the configured number of floors closer. Full cars,
  opposite-direction cars and cars turning before the call are excluded.
  The 0–100 input range, exact eligibility and tie behavior need gameplay
  comparison. Existing saves without this setting use five floors.
  Standard-floor departure delay is configurable for each weekday/weekend
  period, defaulting to zero game seconds. Stops sample the delay on arrival,
  retain normal boarding time, and accept later passengers while held. The saved
  deadline follows the game clock through midnight and 07:00 rollover. The
  0–300-second input range, arrival-based timing and tick rounding are our
  implementation choices pending original-game comparison.
- Compare facility demand, rents, upkeep, staffing coverage, event probabilities
  and disaster response behavior against original gameplay.
  Office rent is now player-selected in the inspector and collected in three
  exact daily installments per quarter, independent of grade. The documented
  average is $10,000; other tiers still use provisional pricing multipliers.
  Workday evaluation now applies +20/+10/0/-20 points from very low through high
  rent. These are provisional satisfaction adjustments. New office occupants
  receive a saved three-day minimum term before dissatisfaction can evict them;
  old saves without a timestamp receive no fresh grace period. The manual states
  a one-quarter minimum, but elapsed-tick timing, renewal decisions and lease price
  locking remain unverified. The inspector shows term remaining and rent effects.
  Hotel nightly baselines are derived from reference quarterly income, not a
  verified reproduction of original checkout accounting. Partial occupancy is
  proportional to guest count; pricing multipliers remain our own model.
  Fast-food population updates at 10:00. Shop (09:00) and restaurant (12:00)
  update times retain our visitor windows pending original-game verification.
  Commercial income uses calibrated, capped patron curves: fast food $3k base
  plus up to $2k from 15 weekday office lunches, restaurants $6k and shops $5k
  per trading day at average pricing. These curves and the visitor demand ramp
  remain approximations, not recovered original formulas. Existing saves retain
  accrued revenue; their new receipt counters begin from zero for the first day.
  Fast-food demand now starts at 10 external arrivals, rises to 20 for the next
  three trading days, then settles at 35 (48 on established weekends). Early
  weekends add 20%; rain halves the target; pricing scales it. This simplified
  ramp omits the reference's later transient values. Arrival budgets persist
  through saves and exclude office lunches. Each fast-food business releases
  its own budget gradually during the lunch hour, without the additional global
  rain throttle. This arrival timing is an approximation; capacity, transport,
  and the simulation population limit can still reduce actual turnout.
  Five of each six office workers now seek reachable fast food on weekdays,
  subject to available capacity. The nonparticipating worker is chosen by stable
  roster order; destination selection remains random, not a recovered original
  algorithm. Workers without an eligible destination take a break at the office.
  Office workers take weekends off and resume their commute the next weekday.
  Open offices retain their previous grade and dissatisfaction streak on weekends;
  vacant office refill timers continue. This avoids grading expected absence as
  a failed commute, but is not a recovered original evaluation formula.
  Noise evaluation covers offices near fast food, restaurants, shops and cinemas,
  plus condos and all hotel types near those businesses or offices. It uses
  horizontal edge spacing: 11 cells for offices and 21 for residential rooms.
  Extending the original office/fast-food and hotel/office distances to these
  additional pairs is an approximation. Open sources impose a nonstacking
  20-point daily evaluation penalty and appear with their floor in the inspector.
  Noise also reaches immediately neighboring floor bands, accounting for the
  full height of cinemas. Above/below propagation follows the manual's description,
  but the one-floor reach is provisional: a full intervening floor insulates
  rooms in this model. Original radial falloff, source-specific distances and
  penalty strength remain unverified; existing placement restrictions still apply.
  Housekeeping floor assignments follow the PC reference. Cleaners now have a
  saved 19-completed-job allowance per operating day. Counting repeat cleanings
  and all hotel types equally is provisional; quotas, work timing and cleaning
  rates still need original-game comparison.
- Normal games now start without a lobby. Drag construction builds a continuous
  lobby at $5,000 per cell, extendable from either edge. Existing saves and demo
  lobbies retain their width. Lobby maintenance is free at 1–2 stars, $300 per built cell per quarter
  at 3 stars, and $1,000 at 4 stars and above, collected in daily shares
  at the rating and width in effect at settlement. The lobby tool snaps to
  ground level, and new transport entrances require full lobby coverage.
  New upper floors follow their support width and can be extended from either
  edge, working upward from the lobby. Lobby edges can be trimmed one cell at
  a time without refunds; interior cuts and removal beneath transport are
  blocked, as is removal beneath a bounded upper floor. The inspector trims
  the left edge; the bulldozer selects either edge.
- Compare remaining original lobby construction rules. New stairs and escalators occupy
  eight cells; legacy single-cell installations remain usable.
  New standard/service shafts occupy four cells and express shafts six;
  saved two-cell shafts retain their dimensions, including extensions. New sky
  lobbies occupy six cells to fit express shafts; original lobby sizing rules
  still need comparison.
  Sky lobbies can only be placed on floors 15, 30, 45, 60, 75 and 90, matching
  the original's every-15-floors rule (original manual; PC reference).
  Each stair or escalator links exactly two adjacent floors, and any pair of
  built floors qualifies, including B1↔lobby and basement↔basement links. A
  stair no longer needs another stair directly below; consecutive offset stairs
  form a walkable chain. Stair cells sit on the floor farther from the lobby
  (lobby tiles stay untouched), so saved upper-floor stairwells keep their
  meaning without a save migration. Routing, placement and demolition all
  treat one placed stair as one link; demolishing one leaves neighbors usable.
  Walking between offset stairs and the cell-ownership convention are our own.
  Lobby height is currently selected when creating a tower, without later resizing. Stair
  and escalator trip limits are four and seven flights; their purchase costs
  are $5,000 and $20,000. Elevator shaft/car purchase and quarterly upkeep now
  use the reference's type-specific amounts. New shafts include one car;
  extensions still use our $500-per-floor rule. Speed upgrades remain custom.
- Replace procedural artwork and compare synthesized audio with the original sound design.
  Floor bands are 24 pixels and each width unit (cell) is 8 pixels, matching
  the reference loader: OpenSkyscraper crops the original Office art at 72×24
  px for its 9 units and Fast Food at 128×24 px for 16 units. With the same
  unit counts, an office is 72 px wide, a condo or fast food 128 px, a single
  hotel room 32 px, stairs/escalators 64 px and a standard (express) shaft
  32 (48) px, so rooms keep the original proportions. Room, elevator and
  people art is original procedural drawing in SimTower's visual language; no
  original assets are bundled.

## Reference scenario

Open `?reference=1` for a seeded ten-floor tower: a standard elevator, stairs near
the lobby, food on floors 2–3, offices on 4–7 and condos on 8–10. Construction
completes during one simulated day before the scenario opens. Reloading repeats
the initial state. Record the original game's platform and version alongside
arrival times, queue lengths, occupancy, stress and finances when comparing.

## Sources

The original manual limits each trip to one elevator change and disallows
individual express-stop deactivation. Both rules are enforced. Older Upper Story
saves retain disabled express stops until the player restores them in the editor.
This compatibility exception avoids silently altering an existing tower's routes.
The manual also restricts elevator-to-stair/escalator transfers to lobby floors.
Mixed routes now support one elevator ride plus a stair/escalator chain at those
floors, with existing flight limits and direction rules. Route preference between
two-elevator and mixed alternatives remains approximate.
Pages 51–52 exclude security and housekeeping from standard and express elevators.
Page 52 also prohibits express waiting-floor reassignment; the simulation rejects
these edits and the editor disables the control. Existing saved assignments are
preserved. The first serviced floor remains our default for new cars; that
default has not been verified against the original.
New staff routes use service cars, including at transfers; public passengers
cannot use service cars. Already-planned trips in older saves still finish.
Staff eligibility for stairs remains unverified and unchanged. Towers that relied
on public elevators for staff may need a service shaft for subsequent trips.

- [TDT specification](https://github.com/dfloer/tower-docs/blob/main/tdt_spec.md): partial save structure, geometry and elevator fields.
- [SimTower reference](https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/): PC 1.0 facility catalogue and progression reference, checked by its author against gameplay and help screens.
- [Asset loader](https://github.com/fabianschuiki/OpenSkyscraper/blob/master/source/SimTowerLoader.cpp): bitmap, palette and sound extraction from the original executable.
- [OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper): experimental implementation, not a complete behavioral specification.

No original game assets are bundled. No external implementation code was copied
to implement these systems.
- [Original manual](https://ru.scribd.com/document/619283680/SimTower-the-Vertical-Empire-Manual-Win-3x-En): one elevator change per trip; fixed express stops; waiting-car response compares distance against moving cars (default five floors); departure delay defaults to zero game seconds.
