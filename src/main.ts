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
  type GameState,
} from './sim';
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
    camera.x = app.screen.width / 2 - x * CONFIG.CELL_WIDTH_PX * camera.zoom;
    camera.y = app.screen.height / 2 - floorTopY(floor, state.tower.lobbyHeight) * camera.zoom;
    camera.apply();
  };
  hud.onJump = jumpTo;
  const campaignPanel = new CampaignPanel(jumpTo, text => hud.toast(text));
  const finances = new FinanceWindow();
  const cursorTip = new CursorTip();
  // Dev-server only: lets browser checks reach the live state.
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) Object.defineProperty(window, 'upperStory', { configurable: true, value: { get state() { return state; } } });
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
  controller.selectTool('select');
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
    else if (command === 'scenarios') scenarioPanel.open();
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
  // The HUD owns the speed; multiplying frame deltas means 2×/4× run more
  // ticks per real frame and Pause (speed 0) never accumulates at all. ---
  let speed = hud.speedMultiplier;
  hud.onSpeedChange = (mult) => {
    speed = mult;
  };

  let acc = 0;
  let last = performance.now();
  let held = false;
  app.ticker.add(() => {
    const now = performance.now();
    // Discard suspended-tab time instead of freezing on thousands of catch-up ticks.
    const modalOpen = document.querySelector('[role="dialog"][data-open="true"], dialog[open]') !== null;
    acc += Math.min(now - last, 250) * (modalOpen ? 0 : speed);
    // Show "Paused" in the clock while a window holds the tower.
    if (modalOpen !== held) { held = modalOpen; document.body.classList.toggle('held', held); }
    last = now;
    while (acc >= CONFIG.TICK_MS) {
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

void main();
