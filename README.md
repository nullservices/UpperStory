# Upper Story

A tower-building game inspired by SimTower. Build offices, homes, hotels, and shops, then keep the people inside moving, working, and coming back.

**[Play in your browser](https://nullservices.github.io/UpperStory/)** · **[Try the demo tower](https://nullservices.github.io/UpperStory/?demo=1)**

## Build your tower

Start with a lobby and a budget. Add floors, connect them with elevators, and move in your first tenants. Offices bring the morning commute; restaurants draw lunchtime crowds; homes and hotels keep the building occupied after hours.

As the tower grows, so do its demands. Long elevator queues frustrate tenants. Hotels need housekeeping. New facilities unlock as your population and star rating increase.

Use the tower report to track vacancies, construction, lift queues, and finances. Click a room or elevator to inspect it and manage its settings. Open **Map** to jump between the upper floors and basements.

## Facilities and ratings

Build up to 100 floors above ground and nine basement levels. Large facilities occupy several floors, so leave their entire footprint clear before placing them.

| Rating | New facilities |
| --- | --- |
| 1 star | Offices, condos, fast food, elevators, stairs and escalators |
| 2 stars | Single and twin hotel rooms, suites, housekeeping, security and service elevators |
| 3 stars | Restaurants, shops, cinemas, party halls, medical centers, parking, recycling, sky lobbies and express elevators |
| 4 stars | Metro station |
| 5 stars | Cathedral |

Population earns your second star at 300 people. Later ratings also require services: security at 1,000; a suite, favorable VIP inspection, recycling and medical care at 5,000; and an accessible metro at 10,000. Reach more than 15,000 people and connect a cathedral on floors 97–100 for the final weekend wedding.

Open **Events & ratings** for your next requirements, active emergencies and tower journal. Fires need rescue, bomb threats need security or a ransom payment, and cockroaches need cleaning or pest control. Unanswered emergencies can close rooms; inspect damaged facilities to repair them. VIPs must actually reach a clean, well-served suite to approve the tower.

Condos sell once when completed. Offices earn rent, visitors pay for their activities, and services incur running costs. Keep cinemas fresh by changing their films from the room inspection window. Parking requires aligned basement ramps; the three-floor metro starts in B9.

## Getting started

1. Select **Floor** and click above the lobby to build an upper floor.
2. Select **Elevator** and click the lobby to connect the floor above, or drag across several floors. Leave two cells clear for the shaft. **Stairs** can also be placed by clicking the lobby.
3. Place an **Office** or **Condo** upstairs and let construction finish. The time controls can speed things up.
4. Watch your tenants arrive, then expand as your budget allows.

The demo starts with a furnished 15-floor tower, all nine basements, five-star tools and extra funds. It includes a fire to respond to and a visiting VIP. Its starting rating is provided for exploration; a new game earns each rating normally.

To extend an elevator, build the new floors, select the matching elevator tool, and drag from the existing shaft into the new floors. Your cars keep running; you pay only for the added shaft floors.

Inspect an elevator to add cars, upgrade speed or choose each car's home floor. Expand **Weekday & weekend service** to prioritize upward or downward calls in six time periods. Cars deliver passengers before returning home, and still answer other calls when no preferred calls remain.

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

## Sound

Open **Sound** for master volume, elevator and weather ambience, or mute. Sound starts after your first click or key press. Elevator arrivals, construction, completed rooms, new ratings and incidents have distinct cues. Background sounds fade while paused, and hidden tabs are silent. Sound preferences are saved separately from your tower.

## Saving your tower

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
