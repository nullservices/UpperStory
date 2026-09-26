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
traffic and economics, service coverage and incidents, then presentation and
original-save compatibility. Each simulation pass needs measured PC 1.0
comparison scenarios before it can be considered equivalent.


- Compare original PC gameplay against repeatable morning, lunch and evening
  traffic scenarios. Calibrate dispatch, journey times, patience and stress.
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
  Noise evaluation now covers same-floor office/fast-food spacing (11 cells)
  and all hotel types near offices (21 cells), measured between room edges.
  Active sources inside those distances impose a nonstacking 20-point daily
  evaluation penalty, shown in the inspector. The penalty strength and other
  noise pairs remain unverified; existing placement restrictions still apply.
  Housekeeping floor assignments follow the PC reference; daily room quotas,
  work timing and cleaning rates still need original-game comparison.
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
  Lobby height is currently selected when creating a tower, without later resizing. Stair
  and escalator trip limits are four and seven flights; their purchase costs
  are $5,000 and $20,000. Elevator shaft/car purchase and quarterly upkeep now
  use the reference's type-specific amounts. New shafts include one car;
  extensions still use our $500-per-floor rule. Speed upgrades remain custom.
- Replace procedural artwork and compare synthesized audio with the original sound design.
  The current renderer uses 20-pixel floor bands; the reference loader uses 24.
- Original TDT save import/export is not implemented.

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

- [TDT specification](https://github.com/dfloer/tower-docs/blob/main/tdt_spec.md): partial save structure, geometry and elevator fields.
- [SimTower reference](https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/): PC 1.0 facility catalogue and progression reference, checked by its author against gameplay and help screens.
- [Asset loader](https://github.com/fabianschuiki/OpenSkyscraper/blob/master/source/SimTowerLoader.cpp): bitmap, palette and sound extraction from the original executable.
- [OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper): experimental implementation, not a complete behavioral specification.

No original game assets are bundled. No external implementation code was copied
to implement these systems.
- [Original manual](https://ru.scribd.com/document/619283680/SimTower-the-Vertical-Empire-Manual-Win-3x-En): one elevator change per trip; fixed express stops; waiting-car response compares distance against moving cars (default five floors); departure delay defaults to zero game seconds.
