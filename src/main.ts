import { Application } from 'pixi.js';
import './ui/style.css';
import { CONFIG } from './data/config';
import {
  createInitialState,
  deserializeGame,
  serializeGame,
  setupDemoTower,
  placeTenant,
  setupNewGame,
  tick,
} from './sim';
import { Controller } from './game/controller';
import { Motion } from './render/motion';
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
  if (new URLSearchParams(window.location.search).has('demo')) {
    setupDemoTower(state);
    state.starLevel = 5;
    // Upper-floor residents and offices create real demand for the lift.
    placeTenant(state, 'office', 5, 20);
    placeTenant(state, 'office', 5, 34);
    placeTenant(state, 'condo', 6, 20);
    placeTenant(state, 'condo', 6, 26);
    placeTenant(state, 'condo', 6, 32);
    placeTenant(state, 'fastfood', 6, 40);
    // The tour opens with finished rooms and an active second-day commute.
    for (let i = 0; i < CONFIG.DAY_TICKS + 150; i++) tick(state);
    state.events.length = 0;
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
  const preview = new PlacementPreview();
  camera.view.addChild(preview.graphics);
  app.stage.addChild(dayNight.screenTint);

  // --- UI: HUD, palette wired to the controller, tool highlight echo ---
  const hud = new Hud();
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
      controller.drainEvents();
      acc -= CONFIG.TICK_MS;
    }
    sky.draw();
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
    hud.update(state);
    palette.update(state);
    hud.setContext(controller.tool, controller.hover, controller.hoverError, camera.zoom);
  });
}

void main();
