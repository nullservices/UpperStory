# Upper Story

A tower-building game inspired by SimTower. Build offices, homes, hotels, and shops, then keep the people inside moving, working, and coming back.

**[Play in your browser](https://nullservices.github.io/UpperStory/)** · **[Try the demo tower](https://nullservices.github.io/UpperStory/?demo=1)**

## Build your tower

Start with a lobby and a budget. Add floors, connect them with elevators, and move in your first tenants. Offices bring the morning commute; restaurants draw lunchtime crowds; homes and hotels keep the building occupied after hours.

As the tower grows, so do its demands. Long elevator queues frustrate tenants. Hotels need housekeeping. New facilities unlock as your population and star rating increase.

Use the tower report to track vacancies, construction, lift queues, and finances. Click a room or elevator to inspect it and manage its settings.

## Getting started

1. Select **Floor** and click above the lobby to build an upper floor.
2. Select **Elevator** and click the lobby to connect the floor above, or drag across several floors. Leave two cells clear for the shaft. **Stairs** can also be placed by clicking the lobby.
3. Place an **Office** or **Condo** upstairs and let construction finish. The time controls can speed things up.
4. Watch your tenants arrive, then expand as your budget allows.

The demo starts with an occupied tower if you'd rather explore before building.

To extend an elevator, build the new floors, select the matching elevator tool, and drag from the existing shaft into the new floors. Your cars keep running; you pay only for the added shaft floors.

## Controls

Designed for a desktop browser with a mouse and keyboard.

| Control | Action |
| --- | --- |
| Left click | Place the selected facility or inspect a room |
| Left drag with a room, stair, or escalator tool | Build a row; each room snaps to its own width |
| Left drag with an elevator tool | Build a shaft or extend an existing one |
| Right drag | Pan the view |
| Mouse wheel | Zoom in or out |
| `I` | Inspect |
| `F` | Build a floor |
| `E` | Build an elevator |
| `O` | Build an office |
| `C` | Build a condo |
| `Space` | Pause or resume |
| `Home` | Center the tower |
| `Escape` | Close a window or return to inspection |

## Saving

Open **Game → Save tower** to save your progress. Saves are stored in the browser you're playing in; they don't sync between devices. Clearing site data removes them.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173/). Add `?demo=1` to start with the demo tower.

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite |
| `npm run lint` | Check code style and module boundaries |
| `npm run smoke` | Run a headless simulation check |
| `npm run perf` | Run the large-tower performance check |

Built with TypeScript, PixiJS, and Vite. The simulation lives in `src/sim`, rendering in `src/render`, and interface code in `src/ui`.

## Deployment

Pushes to `main` run the checks and deploy to GitHub Pages through [the publishing workflow](.github/workflows/pages.yml). The Pages build uses `VITE_BASE_PATH=/UpperStory/`; local builds default to `/`.
