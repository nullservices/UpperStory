# Functional fidelity roadmap

Target: SimTower PC 1.0. Existing features and known approximations are recorded
in [the fidelity inventory](simtower-fidelity.md). A passing automated test proves
our implementation behaves consistently; it does not prove original-game parity.

## Elevator work: five remaining batches

These are bounded work packages, not five remaining bugs. Close each only when
its acceptance scenarios pass and unresolved original behavior is documented.

| Batch | Scope | Completion evidence |
| --- | --- | --- |
| 1. Transfers and queue lifecycle | Walking between shafts, boarding the next leg, full queues, abandonment, save/load during transfers | End-to-end ground and sky-lobby transfers in both directions; overflow and cancellation leave no stranded passengers or stale calls |
| 2. Service and express rules | Passenger eligibility, express stops, disabled stops, disconnected destinations and route choice | Reference-backed rules and tests for each elevator type, including inaccessible destinations |
| 3. Dispatch and boarding | Multiple cars, priority schedules, home reassignment, waiting response, departure delays, loading and door timing | Morning, lunch and evening scenarios compared with the original; measured discrepancies resolved or listed |
| 4. Passenger consequences | Waiting tolerance, accumulated stress, missed trips and overflow consequences | Original-game observations establish thresholds and resulting tenant behavior; regression tests reproduce them |
| 5. Management and acceptance | Inspector controls, construction/editing feedback and full transport regression | Standard, service and express scenarios playable at common desktop sizes; save/reload and shaft edits preserve active journeys |

Current work is batch 1. Per-shaft queue capacity and FIFO persistence are covered.
Cancellation now clears an empty hall call while preserving other shafts and
directions. Rejected queue entry no longer presses a new call. Transfer journeys
still need end-to-end coverage; this batch is not complete.

## Work beyond elevators

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

Finish elevator batches 1–2, then build the comparison scenarios needed for 3–5.
After transport, work through population/economy, services/incidents, progression,
construction discrepancies and presentation. Original save compatibility is a
separate milestone and must not silently become a prerequisite for gameplay work.

Do not report a percentage until there is an enumerated comparison suite. Record
each rule as implemented, verified against a cited reference, or still approximate.
When original evidence is unavailable, document the gap and move to independent
work rather than endlessly tuning an unverified formula.
