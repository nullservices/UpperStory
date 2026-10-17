import { Application, Container, type FederatedPointerEvent } from 'pixi.js';
import { CHROME_INSETS, cameraAnchor, chromeLeft, deviceZoom, initialCameraZoom, stepZoom } from './cameraLayout';

/**
 * Camera over the tower world. World coordinates are pixels at zoom 1
 * (FLOOR_HEIGHT_PX per floor, CELL_WIDTH_PX per cell), x=0 is the tower's
 * left edge, y=0 is ground level (basement below = positive y, floors above
 * = negative y).
 *
 * Input: middle/right-drag pans (left button is reserved for build tools),
 * wheel zooms around the cursor.
 */
export class Camera {
  /** Container holding all world content; child of app.stage. */
  readonly view = new Container();
  x = 0;
  y = 0;
  zoom = 1;
  /** Ladder level (0.5/1/2/3); `zoom` is this snapped to whole device pixels. */
  private level = 1;
  private wheelDelta = 0;

  private dragging = false;
  private last = { x: 0, y: 0 };
  /** World point the camera keeps centred (a followed person), or null. */
  private followTarget: (() => { x: number; y: number } | null) | null = null;
  /** Called when following stops for any reason (pan, Escape, centre, swap). */
  onFollowEnd: (() => void) | null = null;

  constructor(private readonly app: Application) {
    app.stage.addChild(this.view);
    this.bindInput();
    this.center();
    let previousWidth = app.screen.width;
    let previousHeight = app.screen.height;
    app.renderer.on('resize', (width, height) => {
      const before = cameraAnchor(previousWidth, previousHeight);
      const after = cameraAnchor(width, height);
      this.x += after.x - before.x;
      this.y += after.y - before.y;
      previousWidth = width; previousHeight = height;
      app.stage.hitArea = app.screen;
      this.apply();
    });
  }

  /**
   * Frame the tower's lower floors: its left edge just clear of the floating
   * palette, street level about four fifths down the visible area, so the sky you
   * build into gets most of the screen and a few basements still show.
   */
  center(): void {
    this.stopFollow();
    const { width, height } = this.app.screen;
    this.level = initialCameraZoom(width);
    this.zoom = deviceZoom(this.level, this.dpr);
    this.x = chromeLeft(width) + 40; // room for the floor labels left of the tower
    this.y = CHROME_INSETS.top + (height - CHROME_INSETS.top - CHROME_INSETS.bottom) * 0.82;
    this.apply();
  }

  zoomBy(factor: number): void {
    const { x: cx, y: cy } = cameraAnchor(this.app.screen.width, this.app.screen.height);
    const world = this.screenToWorld(cx, cy);
    this.level = stepZoom(this.level, factor - 1);
    this.zoom = deviceZoom(this.level, this.dpr);
    this.x = cx - world.x * this.zoom;
    this.y = cy - world.y * this.zoom;
    this.apply();
  }

  /** Keep `target()` (world px) centred, easing toward it each frame. */
  follow(target: () => { x: number; y: number } | null): void {
    this.followTarget = target;
  }

  get following(): boolean {
    return this.followTarget !== null;
  }

  stopFollow(): void {
    if (!this.followTarget) return;
    this.followTarget = null;
    this.onFollowEnd?.();
  }

  /**
   * Per-frame follow step: ease the view so the target sits at the framing
   * anchor (clear of the chrome). Snaps when far away so a jump across the
   * tower doesn't take seconds; `apply` keeps whole device pixels.
   */
  updateFollow(dtMs: number): void {
    const at = this.followTarget?.();
    if (!at) return;
    const anchor = cameraAnchor(this.app.screen.width, this.app.screen.height);
    const tx = anchor.x - at.x * this.zoom, ty = anchor.y - at.y * this.zoom;
    const far = Math.abs(tx - this.x) > this.app.screen.width || Math.abs(ty - this.y) > this.app.screen.height;
    const k = far ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / FOLLOW_EASE_MS);
    const nx = this.x + (tx - this.x) * k, ny = this.y + (ty - this.y) * k;
    // Settle exactly once within a fraction of a pixel (no endless sub-pixel creep).
    this.x = Math.abs(tx - nx) < 0.25 ? tx : nx;
    this.y = Math.abs(ty - ny) < 0.25 ? ty : ny;
    this.apply();
  }

  apply(): void {
    // Whole screen pixels keep sprite edges crisp.
    const dpr = this.dpr;
    this.view.position.set(Math.round(this.x * dpr) / dpr, Math.round(this.y * dpr) / dpr);
    this.view.scale.set(this.zoom);
  }

  /** Device pixels per CSS pixel the renderer actually draws at. */
  private get dpr(): number {
    return this.app.renderer.resolution || 1;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }

  private bindInput(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;

    stage.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.last = { x: e.global.x, y: e.global.y };
      }
    });
    stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      if (e.global.x === this.last.x && e.global.y === this.last.y) return;
      this.stopFollow(); // panning by hand takes the camera back
      this.x += e.global.x - this.last.x;
      this.y += e.global.y - this.last.y;
      this.last = { x: e.global.x, y: e.global.y };
      this.apply();
    });
    stage.on('pointerup', () => {
      this.dragging = false;
    });
    stage.on('pointerupoutside', () => {
      this.dragging = false;
    });

    this.app.canvas.addEventListener('wheel', (e) => this.onWheel(e), {
      passive: false,
    });
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Trackpads send many small deltas: step one level per notch's worth.
    this.wheelDelta += e.deltaMode === 0 ? e.deltaY : e.deltaY * 100;
    if (Math.abs(this.wheelDelta) < 100) return;
    const newLevel = stepZoom(this.level, -Math.sign(this.wheelDelta));
    this.wheelDelta = 0;
    if (newLevel === this.level) return;
    this.level = newLevel;
    const newZoom = deviceZoom(newLevel, this.dpr);

    // Zoom around the cursor: keep the world point under it stationary.
    const rect = this.app.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wx = (cx - this.x) / this.zoom;
    const wy = (cy - this.y) / this.zoom;
    this.zoom = newZoom;
    this.x = cx - wx * this.zoom;
    this.y = cy - wy * this.zoom;
    this.apply();
  }
}

/** Follow easing time constant: the view closes ~63% of the gap per this many ms. */
const FOLLOW_EASE_MS = 140;
