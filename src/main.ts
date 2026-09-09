import { Application } from 'pixi.js';
import { TowerAudio } from './audio/towerAudio';
import { installAudioPanel } from './ui/audioPanel';
import './ui/style.css';
import { CONFIG } from './data/config';
import {
  createInitialState,
  deserializeGame,
  serializeGame,
  setupNewGame,
  tick,
} from './sim';
import { Controller } from './game/controller';
import { IncidentView } from './render/incidents';
import { TowerMap } from './ui/towerMap';
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
import { SAVE_KEY, SettingsDialog } from './ui/dialogs/settings';

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    // Matches PALETTE.skyBottom so the canvas edge doesn't flash black.
    backgroundColor: 0xb9d5cf,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  const host = document.getElementById('app');
  if (!host) throw new Error('missing #app host element');
  host.appendChild(app.canvas);

  // --- Sim: fresh M1 game (B1 + lobby floor + full-width lobby), or the
  // demo tower (?demo=1) so people/vertical transport are visible quickly.
  // The demo runs at 5★ so the palette shows every M3/M4 tool unlocked.
  // `state` is reassigned by New game / Load, so the ticker closure below
  // must re-read the variable each frame (it does). ---
  let state = createInitialState(20260907);
  if (new URLSearchParams(window.location.search).has('reference')) {
    setupReferenceTower(state);
  } else if (new URLSearchParams(window.location.search).has('demo')) {
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
  installAudioPanel(audio);
  const campaignPanel = new CampaignPanel((floor, x) => {
    camera.x = app.screen.width / 2 - x * CONFIG.CELL_WIDTH_PX * camera.zoom;
    camera.y = app.screen.height / 2 - (floor <= 0 ? -floor * CONFIG.FLOOR_HEIGHT_PX : -(floor + 1) * CONFIG.FLOOR_HEIGHT_PX) * camera.zoom;
    camera.apply();
  }, text => hud.toast(text));
  const towerMap = new TowerMap((x, y) => {
    camera.x = app.screen.width / 2 - x * camera.zoom;
    camera.y = app.screen.height / 2 - y * camera.zoom;
    camera.apply();
  });
  const controller = new Controller(app, camera, state, hud);
  const palette = new ToolPalette((tool) => controller.selectTool(tool));
  controller.onToolChange = (tool) => palette.setActive(tool);
  controller.selectTool('select');
  hud.onCamera = action => action === 'home' ? camera.center() : camera.zoomBy(action === 'in' ? 1.2 : 1 / 1.2);

  // --- Menu: new game / save / load. The dialog only calls back; the sim
  // work happens here so the live state swap lands in one place. ---
  const settings = new SettingsDialog({
    onNewGame: (seed: number) => {
      state = createInitialState(seed);
      setupNewGame(state);
      controller.setState(state);
      camera.center();
    },
    onSave: () => {
      try {
        localStorage.setItem(SAVE_KEY, serializeGame(state));
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    onLoad: () => {
      try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (saved === null) return 'No save yet';
        state = deserializeGame(saved);
        controller.setState(state);
        camera.center();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
  });
  hud.onOpenMenu = () => settings.open();

  // --- Fixed-timestep sim loop (CONFIG.TICK_MS) + per-frame render.
  // The HUD owns the speed; multiplying frame deltas means 2×/4× run more
  // ticks per real frame and Pause (speed 0) never accumulates at all. ---
  let speed = hud.speedMultiplier;
  hud.onSpeedChange = (mult) => {
    speed = mult;
  };

  let acc = 0;
  let last = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    // Discard suspended-tab time instead of freezing on thousands of catch-up ticks.
    const modalOpen = document.querySelector('[role="dialog"][data-open="true"], dialog[open]') !== null;
    acc += Math.min(now - last, 250) * (modalOpen ? 0 : speed);
    last = now;
    while (acc >= CONFIG.TICK_MS) {
      motion.capture(state);
      tick(state);
      audio.events(state.events);
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
    towerMap.update(state);
    hud.update(state);
    palette.update(state);
    hud.setContext(controller.tool, controller.hover, controller.hoverError, camera.zoom);
  });
}

void main();
