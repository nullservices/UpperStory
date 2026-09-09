# SimTower fidelity

Upper Story is an independent implementation. Its tests establish internal
consistency, not equivalence to the original game. Original-game timing and
economic comparisons have not been completed.

## Implemented systems

| Area | Current behavior |
| --- | --- |
| Geometry | 375 cells per floor, floors 1–100 and B1–B9; multi-floor footprints; legacy saves expand without moving rooms |
| Construction | Offices, condos, three hotel types, food, shops, cinema, party hall, medical, security, housekeeping, parking ramps and spaces, recycling, metro, cathedral and sky lobbies |
| Transport | Standard, service and express elevators; stairs and directional escalators; 21/10/42 passenger capacities; eight cars per shaft and 24 shafts; operating shaft extension |
| Population | Individual workers, residents, guests, visitors and staff; walking, queues, boarding, rides, activities and departures |
| Economy | One-time condo sales, office rent, guest and visitor revenue, service upkeep, parking fees and film replacement |
| Progression | Population and facility gates, VIP approval, connected metro and the final cathedral wedding |
| Incidents | Fire, bomb threats, infestation, VIP visits, excavation treasure, rain and debt notifications; responses, damage and repair |
| Persistence | Versioned browser saves, campaign history and active incidents; deterministic replay |
| Audio | Original synthesized construction, elevator, interface and event cues; motor and rain ambience; persistent volume/mute controls |
| Elevator management | Per-car home floors, six weekday/weekend priority periods and individual stop controls; existing trips finish when a stop is disabled |

Catalogue dimensions, purchase costs and rating requirements draw on the
reference below. Simulation formulas and event timing remain approximations.
For example, parking income and waste treatment use simplified daily models.
The facilities tour at `?demo=1` begins at five stars; normal games start at one.

## Remaining fidelity work

- Compare original PC gameplay against repeatable morning, lunch and evening
  traffic scenarios. Calibrate dispatch, journey times, patience and stress.
- Compare weekday/weekend schedules, priorities and home-floor dispatch against
  the original. Six configurable periods, direction priority and per-car homes
  are implemented; period boundaries and priority weighting are our own model.
  Original waiting-car response and standard-floor departure settings remain.
- Compare facility demand, rents, upkeep, staffing coverage, event probabilities
  and disaster response behavior against original gameplay.
- Reproduce the original lobby height options and detailed transport restrictions.
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

- [TDT specification](https://github.com/dfloer/tower-docs/blob/main/tdt_spec.md): partial save structure, geometry and elevator fields.
- [SimTower reference](https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/): PC 1.0 facility catalogue and progression reference, checked by its author against gameplay and help screens.
- [Asset loader](https://github.com/fabianschuiki/OpenSkyscraper/blob/master/source/SimTowerLoader.cpp): bitmap, palette and sound extraction from the original executable.
- [OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper): experimental implementation, not a complete behavioral specification.

No original game assets are bundled. No external implementation code was copied
to implement these systems.
