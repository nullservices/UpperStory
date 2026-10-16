# Feature plan: completing the original and modern additions

Working plan for the next batches. Fidelity status of individual rules is
tracked in [simtower-fidelity.md](simtower-fidelity.md) and
[fidelity-roadmap.md](fidelity-roadmap.md). Original-game sources: the SimTower
PC reference, the original manual, Wikipedia and fan guides cited there.

## Batch 1: finish the original's events

| Feature | Original behavior (sources) | Upper Story plan |
| --- | --- | --- |
| Fire response | Security fights fires for free but unreliably, or the player pays for fire rescue | Choice of `security` (free, success depends on reachable guards) or `rescue` (paid fire department) |
| Fire spread | Fires spread when unanswered | Unanswered fires ignite adjacent rooms and the room above over time; a nearby fire station stops spread |
| Bomb search | Guards sweep floors through the emergency stairwells | Search time scales with the number of security offices whose guards can reach the floor |
| Santa Claus | Santa and reindeer fly past at the end of each year's fourth quarter (cosmetic) | Flyover on the last day of the 4th quarter |
| Halloween witch | A witch flies over on 31 October (system date easter egg) | Flyover when the computer's date is 31 October |
| Queue sides | People going up wait left of a shaft, down on the right | Render queues on opposite sides |

## Batch 2: modern additions (Upper Story originals, not in SimTower)

| Facility | Placement | Effect |
| --- | --- | --- |
| Fire station | Any floor above ground; 2★ | Cheaper, faster fire rescue and no fire spread within reach |
| Maintenance office | Any floor; 2★ | Mechanics prevent and repair elevator breakdowns on shafts they can reach |
| Backup generator | Basement; 3★ | Elevators and lights keep running during blackouts |
| Bank | Any floor above ground; 3★ | Weekday customers pay fees; unlocks loans |
| Rooftop pool | Roof only; 3★ | Residents and guests visit; lifts nearby condo and hotel evaluations |
| Helipad | Roof only; 4★ | VIPs arrive by helicopter; medevac extends medical cover tower-wide |

New events: elevator car breakdowns (needing repair), blackouts (rarer in clear
weather, more likely in rain).

**Status (simulation):** fire response choice, fire spread, bomb search
scaling, breakdowns, blackouts, bank/loans, pool, helipad, fire station,
maintenance and generator rules are implemented and tested (save version 10).
Extra sim APIs beyond the contracts: `responseQuote(state, id, action)`,
`repairElevatorCarError`, `takeLoanError`, `repayLoanError`,
`floorLabel(floor)`; `QUARTER_REPORT` events carry `interest` when charged and
`state.money.lastQuarterInterestCents` records the last charge.

## Batch 3: UI/UX

Labelled selected-tool readout; "Show guide (tutorial & tips)"; cursor-side
cost and error while placing; hover tooltips for rooms; a message log with
click-to-jump; overlay legends; landing queue counts coloured by congestion;
floating money changes; street-and-sky framing for new towers; lit night
windows; pixel-art stairs and escalators; riders hidden behind closed doors;
clouds pause with the game; guide tips for the new systems.

## Shared contracts

These names are fixed so the simulation, render and UI work can proceed in
parallel.

**Simulation state**
- `state.campaign.blackoutUntilTick?: number`: a blackout is active while
  `state.tickCount < blackoutUntilTick`.
- `ElevatorCar.outOfService?: boolean`: a broken car; it holds position and
  takes no passengers until repaired.
- `state.money.loanCents?: number`: outstanding loan principal.
- `campaign.history` entries gain optional `floor?: number` and `x?: number`
  so messages can jump the camera to the event.
- Fires remain `Incident` objects with `kind: 'fire'`; spread creates new fire
  incidents on the neighbouring rooms.

**Simulation commands** (throw `Error(reason)` like other commands)
- `respondToIncident(state, id, 'security')`: new response for fires (free)
  alongside the existing `'rescue'`.
- `repairElevatorCar(state, groupId, carId)`: paid manual repair of a broken car.
- `takeLoan(state, cents)`, `repayLoan(state, cents)`, `loanLimitCents(state)`.

**Tenant types** (already registered in `TENANT_DATA`, the `Tool` union,
`TOOL_INFO` and the palette, filed with their peers: helipad under
Transport; bank and rooftop pool under Rooms; fire station, maintenance and
generator under Services): `fireStation`, `maintenance`,
`generator`, `bank`, `rooftopPool`, `helipad`.
