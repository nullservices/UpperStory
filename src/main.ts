import { Application } from 'pixi.js';
import { PALETTE } from './render/palette';
import { TowerAudio } from './audio/towerAudio';
import { installAudioPanel } from './ui/audioPanel';
import './ui/style.css';
import { CONFIG } from './data/config';
import {
  createInitialState,
  setupNewGame,
  tick,
  floorTopY,
  floorHeightPx,
  getFloor,
  carWorldY,
  favoriteIds,
  personName,
  type GameState,
} from './sim';
import { FollowChip, PersonCard, type PersonActions } from './ui/personCard';
import { PeopleWindow } from './ui/peopleWindow';
import { Controller } from './game/controller';
import { IncidentView } from './render/incidents';
import { TowerMap } from './ui/towerMap';
import { Guide } from './ui/guide';
import { StatsWindow } from './ui/statsWindow';
import { ScenarioPanel } from './ui/scenarioPanel';
import { CampaignPanel } from './ui/campaignPanel';
import { Motion } from './render/motion';
import { setupShowcaseTower } from './sim/showcaseTower';
import { setupReferenceTower } from './sim/referenceTower';
import { SkyView } from './render/sky';
import { Camera } from './render/camera';
import { DayNightView } from './render/dayNight';
import { ElevatorView } from './render/elevatorRenderer';
import { PeopleView } from './render/peopleRenderer';
import { PlacementPreview } from './render/placementPreview';
import { StatusOverlayView } from './render/statusOverlay';
import { TowerView } from './render/floorRenderer';
import { Hud } from './ui/hud';
import { ToolPalette } from './ui/toolPalette';
import { SettingsDialog } from './ui/dialogs/settings';
import { CursorTip } from './ui/cursorTip';
import { FinanceWindow } from './ui/finance';
import { TOOL_INFO } from './ui/toolPalette';
import { describeSaveError, openBrowserSaves } from './persistence';

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('missing #app host element');
  const app = new Application();
  await app.init({
    // Size to the fixed full-viewport host; autoDensity keeps the canvas CSS
    // size equal to the viewport on high-DPI screens (no overflow or gaps).
    resizeTo: host,
    autoDensity: true,
    // Matches PALETTE.skyBottom so the canvas edge doesn't flash black.
    backgroundColor: PALETTE.skyBottom,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);

  // --- Sim: fresh game (empty plot with ground and basement building bands), or the
  // demo tower (?demo=1) so people/vertical transport are visible quickly.
  // The demo runs at 5★ so the palette shows every M3/M4 tool unlocked.
  // `state` is reassigned by New game / Load, so the ticker closure below
  // must re-read the variable each frame (it does). ---
  let state = createInitialState(20260907);
  const params = new URLSearchParams(window.location.search);
  // Showcase towers never overwrite the player's autosave until they start
  // or load a tower of their own.
  let autosaveEnabled = !params.has('reference') && !params.has('demo');
  if (params.has('reference')) {
    setupReferenceTower(state);
  } else if (params.has('demo')) {
    setupShowcaseTower(state);
  } else {
    setupNewGame(state);
  }

  // --- World render: tower -> night window lights -> status overlays ->
  // elevators -> people -> placement preview. (Elevators under people so
  // riders draw on top of their moving car; the night tint is screen-space
  // and goes above the whole world view so it shades everything.) ---
  const sky = new SkyView(app);
  const camera = new Camera(app);
  const towerView = new TowerView();
  camera.view.addChild(towerView.container);
  const dayNight = new DayNightView(app, camera);
  camera.view.addChild(dayNight.windowLights);
  const statusOverlay = new StatusOverlayView();
  camera.view.addChild(statusOverlay.container);
  const motion = new Motion();
  const elevatorView = new ElevatorView();
  camera.view.addChild(elevatorView.container);
  const peopleView = new PeopleView(camera, () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  camera.view.addChild(peopleView.container);
  camera.view.addChild(peopleView.stars);
  const incidents = new IncidentView();
  camera.view.addChild(incidents.world);
  app.stage.addChild(incidents.weather);
  const preview = new PlacementPreview();
  camera.view.addChild(preview.graphics);
  app.stage.addChild(dayNight.screenTint);

  // --- UI: HUD, palette wired to the controller, tool highlight echo ---
  const hud = new Hud();
  const audio = new TowerAudio();
  const openSound = installAudioPanel(audio);
  // Centre the camera on a grid cell (journal "Show location", message log).
  const jumpTo = (floor: number, x: number): void => {
    camera.stopFollow();
    camera.x = app.screen.width / 2 - x * CONFIG.CELL_WIDTH_PX * camera.zoom;
    camera.y = app.screen.height / 2 - floorTopY(floor, state.tower.lobbyHeight) * camera.zoom;
    camera.apply();
  };
  hud.onJump = jumpTo;
  const campaignPanel = new CampaignPanel(jumpTo, text => hud.toast(text));
  const finances = new FinanceWindow();
  const cursorTip = new CursorTip();
  // Dev-server only: lets browser checks reach the live state.
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) Object.defineProperty(window, 'upperStory', { configurable: true, value: { get state() { return state; }, camera, peopleView } });
  const towerMap = new TowerMap((x, y) => {
    camera.x = app.screen.width / 2 - x * camera.zoom;
    camera.y = app.screen.height / 2 - y * camera.zoom;
    camera.apply();
  }, () => {
    const a = camera.screenToWorld(0, 0), b = camera.screenToWorld(app.screen.width, app.screen.height);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  });
  const controller = new Controller(app, camera, state, hud);
  const palette = new ToolPalette((tool) => controller.selectTool(tool));
  controller.onToolChange = (tool) => { palette.setActive(tool); audio.toolChanged(); };
  palette.onLocked = (tool, star) => hud.toast(`${TOOL_INFO[tool].label} unlocks at ${'★'.repeat(star)}. Tower › Events & ratings (V) lists what the next rating needs.`, 'hint');
  palette.onBanned = tool => hud.toast(`${TOOL_INFO[tool].label} isn't allowed in this scenario. Open the goals card for its rules.`, 'hint');
  controller.selectTool('select');
  // --- People you can get to know: person card, follow camera, favourites. ---
  /** World centre of someone right now (riders ride their car; off-site = null). */
  const personWorld = (id: number): { x: number; y: number } | null => {
    const person = state.people.get(id);
    if (!person || person.state === 'offscreen') return null;
    const lh = state.tower.lobbyHeight;
    if (person.state === 'riding') {
      for (const group of state.elevatorGroups.values()) {
        const car = group.cars.find(c => c.passengers.includes(id));
        if (car) return { x: (group.x + 1) * CONFIG.CELL_WIDTH_PX, y: carWorldY(car.y, lh) + CONFIG.FLOOR_HEIGHT_PX / 2 };
      }
    }
    const f = Math.round(person.pos.floor);
    const floor = getFloor(state.tower, f);
    const band = floor ? floorHeightPx(floor, lh) : CONFIG.FLOOR_HEIGHT_PX;
    return { x: person.pos.x * CONFIG.CELL_WIDTH_PX, y: floorTopY(f, lh) + band - 8 };
  };
  let followedId: number | null = null;
  const personActions: PersonActions = {
    rename: (id, name) => controller.renamePerson(id, name),
    setFavorite: (id, favorite) => {
      controller.setFavorite(id, favorite);
      refreshFavorites();
      if (favorite) guide.trigger('favourite');
    },
    follow: id => {
      if (id === null) { camera.stopFollow(); return; }
      camera.stopFollow();
      followedId = id;
      peopleView.focusId = id;
      peopleView.focusPos = personWorld(id);
      // The renderer reports the drawn position each frame; fall back to the
      // sim position while they're off the drawn layout (e.g. just starred far away).
      camera.follow(() => peopleView.focusPos ?? personWorld(id));
      followChip.show(personName(state, id));
    },
    following: () => followedId,
    jump: (floor, x) => jumpTo(floor, x),
    jumpToPerson: id => {
      const at = personWorld(id);
      const person = state.people.get(id);
      if (at) {
        camera.stopFollow();
        camera.x = app.screen.width / 2 - at.x * camera.zoom;
        camera.y = app.screen.height / 2 - at.y * camera.zoom;
        camera.apply();
      } else if (person) {
        const home = state.tenants.get(person.tenantId);
        if (home) jumpTo(home.floor, home.x + home.sizeCells / 2);
        hud.toast(`${personName(state, id)} is off-site right now${home ? ', showing where they belong' : ''}.`, 'hint');
      }
    },
    inspect: id => personCard.open(state, id),
  };
  const personCard = new PersonCard(personActions);
  personCard.onOpen = () => guide.trigger('personCard');
  const peopleWindow = new PeopleWindow(personActions);
  const followChip = new FollowChip(() => camera.stopFollow(), () => { if (followedId !== null) personCard.open(state, followedId); });
  camera.onFollowEnd = () => {
    followedId = null;
    peopleView.focusId = -1;
    followChip.show(null);
  };
  /** Favourite ids for the star layer (notes are few; refreshed on change and a few times a second). */
  const refreshFavorites = (): void => { peopleView.favorites = new Set(favoriteIds(state)); };
  let lastFavoriteRefresh = 0;
  // A few screen px of slack, never less than one world px (tiny figures when zoomed out).
  const personUnder = (world: { x: number; y: number }): number => peopleView.hitTest(world.x, world.y, Math.max(1, 3 / camera.zoom));
  controller.personNameAt = world => {
    const id = personUnder(world);
    return id < 0 ? null : personName(state, id);
  };
  controller.pickPerson = (world, anchor) => {
    const id = personUnder(world);
    if (id < 0) return false;
    personCard.open(state, id, anchor);
    return true;
  };
  const statsWindow = new StatsWindow();
  const scenarioPanel = new ScenarioPanel();
  const guide = new Guide();
  guide.tutorialAllowed = autosaveEnabled; // false on ?demo / ?reference
  guide.onSelectTool = tool => controller.selectTool(tool);
  guide.onHighlightTool = tool => palette.highlight(tool);
  hud.tipsEnabled = () => guide.tipsEnabled;
  hud.onCamera = action => action === 'home' ? camera.center() : camera.zoomBy(action === 'in' ? 1.2 : 1 / 1.2);

  // --- Saves: IndexedDB slots (gzip), legacy localStorage import, and an
  // autosave slot. The Game window only calls back; the live state swap
  // happens here so it lands in one place. ---
  const { manager: saves, ready: storageReady } = openBrowserSaves();
  let autosaving = false;
  let lastAutosaveTick = state.tickCount;
  const swapState = (next: GameState): void => {
    state = next;
    controller.setState(state);
    personCard.close();
    refreshFavorites();
    camera.center();
    autosaveEnabled = true;
    // Scenarios come with their own briefing; the first-tower tutorial stays out.
    guide.tutorialAllowed = !next.scenario;
    lastAutosaveTick = state.tickCount;
  };
  const settings = new SettingsDialog({
    onNewGame: (seed: number, lobbyHeight: 1 | 2 | 3) => {
      const next = createInitialState(seed);
      next.tower.lobbyHeight = lobbyHeight;
      setupNewGame(next);
      swapState(next);
      hud.toast('New tower started.');
    },
    getState: () => state,
    onLoaded: (loaded, meta) => {
      swapState(loaded);
      hud.toast(`Loaded “${meta.name}”.`);
    },
    onOpenScenarios: () => scenarioPanel.open(),
  }, saves);
  scenarioPanel.onStart = next => {
    swapState(next);
    hud.toast('Scenario started. Goals are in the card at the top left; pause any time to plan.');
  };
  hud.onOpenMenu = section => settings.open(section);
  hud.canUndo = () => controller.undoLabel !== null;
  hud.onCommand = command => {
    if (command === 'sound') openSound();
    else if (command === 'map') towerMap.open();
    else if (command === 'events') campaignPanel.open();
    else if (command === 'tips') {
      guide.setTips(!guide.tipsEnabled);
      hud.toast(guide.tipsEnabled ? 'Guide on: tips appear as your tower grows.' : 'Guide off. Turn it back on from Help › Show guide.', 'hint');
    } else if (command === 'tutorial') {
      if (guide.tutorialAllowed) guide.restartTutorial();
      else hud.toast('The tutorial runs on your own towers: start one from Game › New tower.', 'hint');
    }
    else if (command === 'finances') finances.toggle();
    else if (command === 'stats') statsWindow.open();
    else if (command === 'people') peopleWindow.toggle();
    else if (command === 'scenarios') scenarioPanel.open();
    else if (command === 'undo') controller.undo();
    else settings.open(command);
  };

  const autosave = (reason: 'quarter' | 'leave'): void => {
    if (!autosaveEnabled || autosaving || state.tickCount === lastAutosaveTick) return;
    autosaving = true;
    lastAutosaveTick = state.tickCount;
    // serializes synchronously; compression and the write finish later.
    saves.autosave(state)
      .catch(err => { if (reason === 'quarter') hud.toast(`Autosave failed: ${describeSaveError(err)}`); })
      .finally(() => { autosaving = false; });
  };
  window.addEventListener('pagehide', () => autosave('leave'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave('leave'); });
  void storageReady.then(warning => {
    if (warning) {
      settings.setStorageWarning(warning);
      hud.toast(warning);
    } else if (autosaveEnabled) {
      void saves.list().then(list => {
        if (list.length) hud.toast(`${list.length === 1 ? 'A saved tower is' : `${list.length} saved towers are`} available — Game › Load tower (Ctrl+O).`);
      }).catch(() => undefined);
    }
  });

  // --- Fixed-timestep sim loop (CONFIG.TICK_MS) + per-frame render.
  // The HUD owns the speed; multiplying frame deltas means 2×/4×/10× run more
  // ticks per real frame and Pause (speed 0) never accumulates at all.
  // Catch-up is bounded per frame (tick count and wall time) and the backlog
  // beyond it is dropped, so a big tower at Ultra slows the clock instead of
  // freezing the UI. ---
  let speed = hud.speedMultiplier;
  hud.onSpeedChange = (mult) => {
    speed = mult;
  };

  let acc = 0;
  let last = performance.now();
  refreshFavorites();
  let held = false;
  app.ticker.add(() => {
    const now = performance.now();
    const frameMs = now - last;
    // Discard suspended-tab time instead of freezing on thousands of catch-up ticks.
    const modalOpen = document.querySelector('[role="dialog"][data-open="true"], dialog[open]') !== null;
    acc += Math.min(now - last, 250) * (modalOpen ? 0 : speed);
    // Show "Paused" in the clock while a window holds the tower.
    if (modalOpen !== held) { held = modalOpen; document.body.classList.toggle('held', held); }
    last = now;
    let ticks = 0;
    while (acc >= CONFIG.TICK_MS) {
      if (ticks >= MAX_TICKS_PER_FRAME || (ticks > 0 && performance.now() - now > TICK_BUDGET_MS)) {
        acc %= CONFIG.TICK_MS;
        break;
      }
      ticks++;
      motion.capture(state);
      tick(state);
      audio.events(state.events);
      if (state.events.some(event => event.type === 'QUARTER_REPORT')) autosave('quarter');
      controller.drainEvents();
      acc -= CONFIG.TICK_MS;
    }
    sky.draw();
    audio.update(state, speed > 0 && !modalOpen, { x: camera.x, y: camera.y, zoom: camera.zoom, width: app.screen.width, height: app.screen.height });
    towerView.draw(state);
    dayNight.draw(state);
    statusOverlay.draw(state, hud.statusMode);
    elevatorView.draw(state, acc / CONFIG.TICK_MS, motion);
    peopleView.draw(state, acc / CONFIG.TICK_MS, motion);
    if (followedId !== null) {
      if (!state.people.has(followedId)) {
        hud.toast(`${personName(state, followedId)} has left the tower.`, 'hint');
        camera.stopFollow();
      } else camera.updateFollow(frameMs);
    }
    if (now - lastFavoriteRefresh > 300) { lastFavoriteRefresh = now; refreshFavorites(); }
    personCard.update(state);
    peopleWindow.update(state);
    preview.draw(
      state,
      controller.tool,
      controller.hover,
      controller.hoverError,
      controller.drag,
    );
    incidents.draw(state, app.screen.width, Math.min(app.screen.height, camera.y), acc / CONFIG.TICK_MS);
    campaignPanel.update(state);
    statsWindow.update(state);
    scenarioPanel.update(state);
    guide.update(state);
    towerMap.update(state);
    hud.update(state);
    palette.update(state);
    hud.setContext(controller.tool, controller.hover, controller.hoverError, camera.zoom);
    finances.update(state);
    cursorTip.update(state, controller);
  });

  // Window 'resize' alone misses some viewport changes (zoom, devtools,
  // screenshot capture). Follow the host element and repaint the screen-space
  // layers at once, so the canvas never shows an unpainted strip.
  new ResizeObserver(() => {
    app.resize();
    sky.draw();
    dayNight.draw(state);
    app.render();
  }).observe(host);
}

/** At most this many sim ticks per rendered frame (Ultra at 60 fps needs ~2). */
const MAX_TICKS_PER_FRAME = 12;
/** Stop catching up once a frame has spent this long ticking. */
const TICK_BUDGET_MS = 12;

void main();
