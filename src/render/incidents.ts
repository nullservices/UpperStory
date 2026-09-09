import { Graphics } from 'pixi.js';
import { CONFIG } from '../data/config';
import { floorTopY } from '../sim/tower';
import type { GameState } from '../sim/state';

export class IncidentView {
  readonly world = new Graphics();
  readonly weather = new Graphics();
  constructor() { this.world.eventMode = 'none'; this.weather.eventMode = 'none'; }
  draw(state: GameState, width: number, height: number, alpha: number): void {
    const g = this.world; g.clear();
    const time = state.tickCount + alpha;
    for (const incident of state.campaign.incidents) {
      const tenant = state.tenants.get(incident.tenantId);
      if (!tenant) continue;
      const x = tenant.x * CONFIG.CELL_WIDTH_PX;
      const y = floorTopY(tenant.floor);
      const w = tenant.sizeCells * CONFIG.CELL_WIDTH_PX;
      if (incident.kind === 'fire') {
        for (let i = 0; i < Math.min(16, tenant.sizeCells); i++) {
          const px = x + 4 + i * (w - 8) / Math.min(16, tenant.sizeCells);
          const h = 5 + (Math.floor(time * 2 + i * 7) % 12);
          g.poly([px, y + 19, px + 3, y + 19 - h, px + 7, y + 19]).fill(0xe38a3c);
          g.rect(px + 2, y + 15, 3, 4).fill(0xf4d080);
          g.circle(px + 3, y - (time + i * 11) % 25, 4).fill({ color: 0x5b6060, alpha: 0.3 });
        }
      } else if (incident.kind === 'vip') {
        g.rect(x, y + 1, w, 18).stroke({ color: 0xd1ac54, width: 2 });
      } else {
        g.rect(x, y + 1, w, 18).fill({ color: incident.kind === 'bomb' ? 0xc3594f : 0x817d45, alpha: 0.15 + Math.sin(time / 5) * 0.08 });
      }
    }
    const rain = this.weather; rain.clear();
    if (state.campaign.weather === 'rain') {
      rain.rect(0, 94, width, height - 94).fill({ color: 0x5c7580, alpha: 0.12 });
      for (let i = 0; i < 90; i++) {
        const x = (i * 127 + time * 3) % width;
        const y = 94 + (i * 83 + time * 13) % Math.max(1, height - 94);
        rain.moveTo(x, y).lineTo(x - 3, y + 9).stroke({ width: 1, color: 0xc7dbe0, alpha: 0.35 });
      }
    }
  }
}
