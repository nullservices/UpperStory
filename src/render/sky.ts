import { Application, Graphics } from 'pixi.js';

/** Screen-space sky stays continuous while the tower is panned. */
export class SkyView {
  private graphics = new Graphics();
  private key = '';
  constructor(private app: Application) {
    this.graphics.eventMode = 'none';
    app.stage.addChildAt(this.graphics, 0);
  }
  draw(): void {
    const { width, height } = this.app.screen;
    const key = `${width}:${height}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics; g.clear();
    for (let i = 0; i < 64; i++) {
      const t = i / 63;
      const color = (Math.round(168 + t * 58) << 16) | (Math.round(206 + t * 24) << 8) | Math.round(209 + t * 4);
      g.rect(0, i * height / 64, width, height / 64 + 1).fill(color);
    }
    for (const [x, y, scale] of [[0.29, 0.28, 1], [0.76, 0.22, 0.8], [0.54, 0.4, 0.6]]) {
      const cx = width * x!, cy = height * y!, s = scale!;
      g.ellipse(cx, cy, 68 * s, 9 * s).fill({ color: 0xf5f6e9, alpha: 0.7 });
      g.ellipse(cx - 15 * s, cy - 8 * s, 29 * s, 13 * s).fill({ color: 0xf5f6e9, alpha: 0.7 });
      g.ellipse(cx + 16 * s, cy - 5 * s, 34 * s, 10 * s).fill({ color: 0xf5f6e9, alpha: 0.7 });
    }
  }
}
