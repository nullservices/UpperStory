import { Application, Container, type FederatedPointerEvent } from 'pixi.js';
import { CONFIG } from '../data/config';

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

  private dragging = false;
  private last = { x: 0, y: 0 };

  constructor(private readonly app: Application) {
    app.stage.addChild(this.view);
    this.bindInput();
    this.center();
  }

  /**
   * Center the view on the demo tower's lower floors. The x offset keeps the
   * tower clear of the DOM tool palette (a ~160px strip on the left).
   */
  center(): void {
    const width = this.app.screen.width;
    this.zoom = Math.min(1.8, Math.max(CONFIG.MIN_ZOOM, (width - 270) / (60 * CONFIG.CELL_WIDTH_PX)));
    this.x = width < 620 ? 184 : 230;
    this.y = this.app.screen.height * 0.79;
    this.apply();
  }

  zoomBy(factor: number): void {
    const cx = (this.app.screen.width + 200) / 2;
    const cy = this.app.screen.height / 2;
    const world = this.screenToWorld(cx, cy);
    this.zoom = Math.min(CONFIG.MAX_ZOOM, Math.max(CONFIG.MIN_ZOOM, this.zoom * factor));
    this.x = cx - world.x * this.zoom;
    this.y = cy - world.y * this.zoom;
    this.apply();
  }

  apply(): void {
    this.view.position.set(this.x, this.y);
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
    const factor = e.deltaY < 0 ? CONFIG.ZOOM_STEP : 1 / CONFIG.ZOOM_STEP;
    const newZoom = Math.min(
      Math.max(this.zoom * factor, CONFIG.MIN_ZOOM),
      CONFIG.MAX_ZOOM,
    );
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
