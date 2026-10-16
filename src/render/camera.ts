import { Application, Container, type FederatedPointerEvent } from 'pixi.js';
import { CHROME_INSETS, cameraAnchor, chromeLeft, initialCameraZoom, stepZoom } from './cameraLayout';

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
  private wheelDelta = 0;

  private dragging = false;
  private last = { x: 0, y: 0 };

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
    const { width, height } = this.app.screen;
    this.zoom = initialCameraZoom(width);
    this.x = chromeLeft(width) + 40; // room for the floor labels left of the tower
    this.y = CHROME_INSETS.top + (height - CHROME_INSETS.top - CHROME_INSETS.bottom) * 0.82;
    this.apply();
  }

  zoomBy(factor: number): void {
    const { x: cx, y: cy } = cameraAnchor(this.app.screen.width, this.app.screen.height);
    const world = this.screenToWorld(cx, cy);
    this.zoom = stepZoom(this.zoom, factor - 1);
    this.x = cx - world.x * this.zoom;
    this.y = cy - world.y * this.zoom;
    this.apply();
  }

  apply(): void {
    // Whole screen pixels keep sprite edges crisp.
    this.view.position.set(Math.round(this.x), Math.round(this.y));
    this.view.scale.set(this.zoom);
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
    const newZoom = stepZoom(this.zoom, -Math.sign(this.wheelDelta));
    this.wheelDelta = 0;
    if (newZoom === this.zoom) return;

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
