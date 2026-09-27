# Functional fidelity roadmap

Target: SimTower PC 1.0. Existing features and known approximations are recorded
in [the fidelity inventory](simtower-fidelity.md). A passing automated test proves
our implementation behaves consistently; it does not prove original-game parity.

## Elevator work: one internally validated batch, four remaining

These are bounded work packages, not five remaining bugs. Close each only when
its acceptance scenarios pass and unresolved original behavior is documented.

| Batch | Scope | Completion evidence |
| --- | --- | --- |
| 1. Transfers and queue lifecycle | Walking between shafts, boarding the next leg, full queues, abandonment, save/load during transfers | End-to-end ground and sky-lobby transfers in both directions; overflow and cancellation leave no stranded passengers or stale calls |
| 2. Service and express rules | Passenger eligibility, express stops, disabled stops, disconnected destinations and route choice | Reference-backed rules and tests for each elevator type, including inaccessible destinations |
| 3. Dispatch and boarding | Multiple cars, priority schedules, home reassignment, waiting response, departure delays, loading and door timing | Morning, lunch and evening scenarios compared with the original; measured discrepancies resolved or listed |
| 4. Passenger consequences | Waiting tolerance, accumulated stress, missed trips and overflow consequences | Original-game observations establish thresholds and resulting tenant behavior; regression tests reproduce them |
| 5. Management and acceptance | Inspector controls, construction/editing feedback and full transport regression | Standard, service and express scenarios playable at common desktop sizes; save/reload and shaft edits preserve active journeys |

Batch 1 is internally validated; original-game comparison remains in batches 3–5.
Per-shaft queue capacity and FIFO persistence are covered.
Cancellation now clears an empty hall call while preserving other shafts and
directions. Rejected queue entry no longer presses a new call. Ground-lobby and
sky-lobby transfers now have end-to-end coverage in both directions, including
saves during walking, waiting, riding and the final approach. A full second-shaft
queue rejects the new passenger without losing existing waiters. Passengers walk
from the final stop to their destination, including same-floor journeys, instead
of teleporting. This adds travel time; original walking speed and schedule timing
remain unverified. The original manual specifies only one elevator change per
trip, so rejecting journeys that require two changes is intentional fidelity.

Batch 2: the manual's fixed express-stop rule is enforced in the simulation and
editor. Previously disabled express stops remain unchanged in old saves and can
be restored, but cannot be disabled again. Regression coverage includes restored
connectivity and both directions of the one-change limit. Mixed routes now join
one elevator ride with a stair or escalator chain at a ground/sky lobby. They
respect four-flight stair and seven-flight escalator limits and escalator
direction. Tests cover full journeys and save/reload during a transfer.
Two-elevator routes retain priority over mixed alternatives; this ordering is
an implementation choice awaiting original-game comparison. The manual's page 51
excludes security and housekeeping staff from standard elevators and identifies
service cars for infrastructure staff. New routes enforce that separation;
existing saved journeys finish normally. Tests cover both staff roles, every
public passenger kind, and housekeeping access gained by adding a service shaft.
Staff use of express cars and stairs remains unchanged and unverified, as do
route-choice priorities. Those comparisons remain before closing this batch.

Hotel inspectors now distinguish missing operating housekeeping offices from
missing routes, report how many offices can reach the floor, and show active
cleaner assignments. This is modernization feedback based on the current routing
rules, not a claim about the original interface or guaranteed cleaning capacity.
Access is checked when the paused inspector opens, including recent stop edits.

Batch 3 now has deterministic two-car scenarios for morning arrivals (40 riders),
lunch cross-traffic (60 riders) and evening departures (60 riders). They check
capacity, exclusive queue/car ownership, delivery to each destination, both cars
being used and save/reload during dispatch. These isolate elevator operation from
daily schedules and patience; they are consistency checks, not original-game
timing benchmarks. Boarding late arrivals during a departure hold now clears the
call when the final waiter boards. Original timing measurements remain pending.

Batch 4: cancelling a trip now releases both queue membership and car occupancy.
Removing an activity destination while a worker, visitor or cleaner was riding
previously left a stale car occupant with no destination. Regression scenarios
verify that remaining riders finish, cancelled people are not moved by the car,
empty calls clear and save/reload preserves the result. Patience and stress
formulas are unchanged; their original-game thresholds remain unverified.

Batch 5: shaft demolition now cancels unfinished routes for walkers and future
transfer passengers as well as existing waiters. Completed legs do not trigger
cancellation, and occupied shafts reject demolition before any mutation. Tests
cover stale walk targets, release from an earlier car, and save/reload. This
extends the existing give-up policy; original demolition consequences still need
comparison.

Stair and escalator demolition now also cancels unfinished dependent journeys.
An occupied connection rejects removal before any passenger or tile changes.
Completed route legs and adjacent escalators sharing a landing are preserved.
These are construction safety improvements; original-game demolition policy is
still an explicit comparison gap.

## Work beyond elevators

Noise now includes fast food, restaurants, shops and cinemas disturbing offices,
and those businesses plus offices disturbing condos and hotel rooms. The existing
11/21-cell horizontal distances and nonstacking 20-point penalty are generalized
approximations. Noise reaches the same and immediately neighboring floor bands,
including both occupied floors of a cinema. The inspector identifies the source
floor. Tests cover each pair, horizontal and vertical boundaries, inactive
sources and daily evaluation. One intervening floor currently blocks noise;
original radial falloff and per-source tuning remain unverified, so this does
not close the noise fidelity item.

Housekeeping now skips hotels with guests inside and rechecks room occupancy and
operating state before each cleaning step. A newly occupied or damaged room
releases its assignment. This uses actual guest presence rather than cached
occupancy and retains existing cleaning rates. Each cleaner now has a saved
19-completed-job allowance per operating day, shown in the housekeeping inspector.
Only bringing a dirty room to 100% counts; cancelled, timed-out and already-clean
jobs do not. Repeat cleanings consume additional jobs. Old saves start at zero;
the next operating day resets the count. The value comes from the reported game
help text and PC reference, but daily accounting and equal treatment of all hotel
types are provisional interpretations, not recovered formulas.

New cleaning jobs stop at 16:30; active cleaning ends at 17:00. Staff finish a
current elevator/stair/escalator leg before taking a route home, without a failed
trip penalty. Late arrivals at a room do not begin cleaning. Partial cleanliness
and unused quota persist until the next day. The inspector displays the hours.
These times follow [Brad Stuart's historical gameplay FAQ](https://gamefaqs.gamespot.com/mac/564236-simtower/faqs/2168),
which covers Macintosh versions; PC 1.0 equivalence and exact in-transit behavior
remain unverified. Tests cover both cutoff boundaries, partial work, saves during
a return transition and the next morning's resumption.

VIP incidents now retain cleanliness at first arrival, so later room turnover
does not replace that observation in the cleanliness check. Stress, connectivity
and grade checks remain. Old incidents without an arrival observation fall back
to current cleanliness. This evaluation adjustment is an implementation choice,
not a recovered original formula.

The facility catalogue exists. The remaining scope is primarily behavioral
accuracy and validation, with some missing features identified below.

| Track | Remaining work | Completion evidence |
| --- | --- | --- |
| Construction | Lobby height changes, sky-lobby geometry, support rules, extension pricing and original limits | Reference-backed placement/resize matrix, including edges and basements |
| Population and routines | Household behavior, visitor demand, office lunches, hotel arrivals/departures and destination selection | Full weekday/weekend journeys compared with original observations |
| Economy | Rent and occupancy response, sales, business demand, upkeep and quarterly accounting | Matched tower layouts produce explained income/expense differences across multiple quarters |
| Services | Housekeeping quotas and timing, parking, waste, medical/security coverage and noise interactions | Coverage, capacity and failure scenarios match documented original rules |
| Incidents | Fire response/damage, bomb threats, infestation, VIP visits and event probabilities | Each event tested from trigger through resolution, including saves and failed responses |
| Progression | Rating gates, VIP approval, metro and cathedral finale | Normal new game can reach the finale; every promotion and rejection condition verified |
| Presentation and release | Art, animation, sound, responsive controls, performance, onboarding and accessibility | Playable review at ordinary desktop sizes and sustained large-tower performance checks |
| Original save compatibility | TDT import/export is absent | Round-trip fixtures and explicit handling of unsupported fields; track separately from gameplay parity |

## Order and completion policy

Resolve batch 2 where reference evidence permits, while building the comparison
scenarios needed for 3–5. Do not hold independent work behind unresolved rules.
After transport, work through population/economy, services/incidents, progression,
construction discrepancies and presentation. Original save compatibility is a
separate milestone and must not silently become a prerequisite for gameplay work.

Do not report a percentage until there is an enumerated comparison suite. Record
each rule as implemented, verified against a cited reference, or still approximate.
When original evidence is unavailable, document the gap and move to independent
work rather than endlessly tuning an unverified formula.
