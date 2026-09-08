# SimTower fidelity

Upper Story's simulation is an independent implementation. A passing internal
test establishes consistency, not equivalence to SimTower.

## Reference scenario

Open `?reference=1` to load a repeatable ten-floor tower using the default seed:
one standard elevator, stairs near the lobby, food on floors 2–3, offices on
4–7, and condos on 8–10. Construction completes during one simulated day before
the scenario opens. Reload to repeat from the same state. This scenario uses
normal simulation rules and does not raise the star rating artificially.

Record morning arrivals, lunch trips, evening departures, queue lengths,
occupancy and daily finances. The original-game comparison has not yet been
performed; the scenario is a test fixture, not a parity claim.

## Evidence and outstanding work

| Area | Evidence | Upper Story |
| --- | --- | --- |
| Car capacities | TDT elevator header: standard 21, express 42, service 10 | Implemented and boarding tested |
| Car count | TDT header records up to eight cars | Existing limit |
| Elevator schedules | TDT describes weekday/weekend settings, priorities and home floors | Not implemented |
| Geometry | TDT describes 375 tiles per floor; loader uses 24-pixel room bands | Current 60-cell, 20-pixel geometry still differs; requires coordinated placement, rendering and save migration |
| Assets | SimTowerLoader extracts executable bitmaps, palettes and sound | Procedural artwork; importer not implemented |
| Movement and stress | Save fields do not establish all timing/formulas | Approximate; must compare against original gameplay |
| Star progression | Current implementation only checks population | Facility/event requirements remain to be established and implemented |
| Original saves | Partial TDT specification | No TDT import/export |

Transport fixes in this pass also synchronize boarding positions, stop cars
exactly at intermediate pickups, serve the requested direction after an empty
car arrives, and rebuild stops after resizing a shaft. Extensions preserve active cars and routes and charge only for added floors. These are local
correctness fixes, not independently verified original dispatch algorithms.

## Sources

- [TDT specification](https://github.com/dfloer/tower-docs/blob/main/tdt_spec.md)
- [Asset loader](https://github.com/fabianschuiki/OpenSkyscraper/blob/master/source/SimTowerLoader.cpp)
- [OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper)

The documentation and reference implementations are incomplete. Use the original
game as the behavioral reference. Record its platform/version with every capture.
Original asset import should remain separate from the distributed art pack.
