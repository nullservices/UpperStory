# Upper Story — A Vertical World

A browser-based tower simulation inspired by **SimTower** (Maxis 1994, by Yoot Saito / OPeNBooK — aka *The Tower* / *Yoot Tower*).

- **Stack**: TypeScript + Vite + PixiJS. The simulation core (`src/sim/**`) is pure,
  deterministic TypeScript (seeded RNG, tick-based time) with no DOM or rendering
  imports — fully unit-tested with Vitest.
- **Reference**: the official [YootTower](https://github.com/YootTowerManagement/YootTower)
  code-drop documentation (cloned locally at `reference/YootTower`, git-ignored) and
  reverse-engineering notes on the original `.TDT` save format.
- **Art**: procedural rooms with furniture silhouettes and a city backdrop; pixel art can swap in later
  behind the render layer's visual-model seam. Original assets are off-limits.

## Development

```sh
npm install
npm run dev      # Vite dev server at http://localhost:5173  (?demo=1 for the demo tower)
npm test         # Vitest unit tests (sim core, node environment)
npm run smoke    # headless multi-day simulation run with invariants
npm run perf     # 100-floor / ~2k-people sim performance check
npm run lint     # ESLint incl. the sim-purity boundary rules
```

## Hosting

GitHub Actions builds, tests, and publishes `main` to GitHub Pages using
`.github/workflows/pages.yml`. The repository's Pages source must be **GitHub Actions**.
The deployment sets `VITE_BASE_PATH=/UpperStory/`; local development keeps `/`.
The public URL is `https://nullservices.github.io/UpperStory/` once Pages is enabled
and the first deployment succeeds. Add `?demo=1` for the populated demonstration tower.

## Gameplay

Build and run a tower: lobby, offices, condos, hotels, restaurants, fast food,
shops, security, housekeeping — elevators (standard/service/express),
escalators, stairs, sky lobbies. People commute on schedules, lunch crowds
flood in, hotel guests check in and out, staff patrol and clean, tenants
grade daily and vacate if conditions are bad. Population gates raise the star
rating (2★@300, 3★@1,000, 4★@5,000, 5★@10,000), unlocking new facilities.
Save/load via the in-game menu (localStorage).

## Upper Story interface

Upper Story uses an original SimTower-inspired visual identity, replacing the dashboard-style UI with
an original illustrated construction palette and a compact desktop-simulation layout.

- A continuous tower cutaway: glass lobby, furnished offices and homes, shops,
  restaurants, construction scaffolding, trees, and a soft city skyline.
- Funds, population, rating, clock, and speed controls remain visible in a compact bar.
- Construction tools show current floor prices and star unlocks. Inspect is the default tool.
- Contextual guidance and placement errors appear beside the world and in the status bar.
- Tower report shows progression, open/vacant facilities, construction, lift queues, and quarterly finances.
- Room/elevator/game windows pause simulation, trap keyboard focus, and close with Escape.
- Save/load retains the original localStorage key. Loading and starting over require a second click to discard unsaved progress.
- People remain visible inside occupied rooms; walking and elevator travel interpolate between simulation ticks. Elevator doors animate and riders stay attached to their cabin.
- `?demo=1` opens the existing demonstration tower after construction has completed.

Controls: **I** inspect, **F** floor, **E** elevator, **O** office, **C** condo,
**Space** pause/resume, **Home** recenter, **Escape** return to inspection.
Right-drag pans; the wheel and on-screen buttons zoom. The palette scrolls in smaller windows.

Validation: 110 simulation/render-motion tests, TypeScript, ESLint, and production build.
Browser checks cover construction, elevator dragging, room inspection, keyboard
cancellation/pause, save/load restoration, and 1280×720 / 800×600 layouts.

The simulation remains an adaptation rather than complete feature parity with the
original game. This pass focuses on presentation and interaction, not adding the
original's missing facilities, disasters, or later-game progression requirements.

## Status

- [x] M0 — Scaffold, deterministic sim tick, grid render, camera
- [x] M1 — Building: floors, lobby, tenants, construction
- [x] M2 — Elevators, routing, people + stress
- [x] M3 — Economy, full tenants, time, visitors, staff, evaluation
- [x] M4 — Star progression, express elevators + sky lobbies
- [x] M5 — Save/load, speed controls, perf pass, smoke runs
