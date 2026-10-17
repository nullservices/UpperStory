import { Container } from 'pixi.js';

/** World px of tower height per bucket (four ordinary floors). */
const BUCKET_PX = 96;

interface Row {
  container: Container;
  top: number;
  bottom: number;
}

/**
 * A layer of retained world sprites split into horizontal row buckets, so a
 * tall tower renders only the rows on screen: `cull` toggles whole bucket
 * containers (a few dozen checks a frame) instead of walking thousands of
 * room, band and shaft sprites. Children keep their own positions; a bucket
 * only groups them by the world y they were placed at.
 */
export class RowBuckets {
  readonly root = new Container();
  private readonly rows = new Map<number, Row>();

  constructor() {
    this.root.eventMode = 'none';
  }

  /** File `child` (top at world y, `h` tall) under its row, re-parenting if it moved. */
  add(child: Container, y: number, h: number): void {
    const key = Math.floor(y / BUCKET_PX);
    let row = this.rows.get(key);
    if (!row) {
      row = { container: new Container(), top: y, bottom: y + h };
      row.container.eventMode = 'none';
      this.rows.set(key, row);
      this.root.addChild(row.container);
    } else {
      if (y < row.top) row.top = y;
      if (y + h > row.bottom) row.bottom = y + h;
    }
    if (child.parent !== row.container) row.container.addChild(child);
  }

  /** Show only rows overlapping the world band [top, bottom]. */
  cull(top: number, bottom: number): void {
    for (const row of this.rows.values()) row.container.visible = row.bottom >= top && row.top <= bottom;
  }

  /** Show every row (no viewport known). */
  showAll(): void {
    for (const row of this.rows.values()) row.container.visible = true;
  }

  /** Destroy every child and forget the rows. */
  clear(): void {
    for (const row of this.rows.values()) row.container.destroy({ children: true });
    this.rows.clear();
  }

  /** Number of children across all rows (diagnostics/tests). */
  get size(): number {
    let n = 0;
    for (const row of this.rows.values()) n += row.container.children.length;
    return n;
  }
}

/**
 * World-space vertical span under the browser viewport for a container
 * placed directly in the camera view (null outside a browser or before it is
 * on stage). Reads the camera view's own position and scale, which the
 * camera sets immediately, so culling never lags a pan or zoom by a frame.
 */
export function visibleWorldBand(container: Container, margin = 0): { top: number; bottom: number } | null {
  const view = container.parent;
  if (typeof window === 'undefined' || !view) return null;
  const scale = view.scale.y;
  if (!scale) return null;
  const a = (0 - view.y) / scale, b = (window.innerHeight - view.y) / scale;
  return { top: Math.min(a, b) - margin, bottom: Math.max(a, b) + margin };
}
