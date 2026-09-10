import { CONFIG } from '../data/config';
import { shaftWidth } from '../sim/elevators';
import { TENANT_COLORS } from '../render/palette';
import { floorTopY } from '../sim/tower';
import { facilityHeight } from '../data/config';
import type { GameState } from '../sim/state';

export class TowerMap {
  private readonly dialog = document.createElement('dialog');
  private readonly canvas = document.createElement('canvas');
  private state: GameState | null = null;
  private top = 0;
  private bottom = 0;
  constructor(private readonly move: (worldX: number, worldY: number) => void) {
    const button = document.createElement('button'); button.textContent = 'Map';
    button.onclick = () => { this.draw(); this.dialog.showModal(); };
    document.querySelector('.game-header nav')!.append(button);
    this.dialog.className = 'campaign-window tower-map-window';
    this.dialog.setAttribute('aria-label', 'Tower map');
    const title = document.createElement('h2'); title.textContent = 'Your whole tower';
    const help = document.createElement('p'); help.textContent = 'Click the map to move the view. The gold line marks the lobby.';
    this.canvas.width = 600; this.canvas.height = 400;
    this.canvas.style.cssText = 'width:100%;height:auto;cursor:crosshair;background:#d1d8ca';
    this.canvas.setAttribute('aria-label', 'Overview of tower rooms and elevator shafts');
    this.canvas.onclick = e => {
      const bounds = this.canvas.getBoundingClientRect();
      this.move((e.clientX - bounds.left) / bounds.width * CONFIG.FLOOR_WIDTH_CELLS * CONFIG.CELL_WIDTH_PX,
        this.top + (e.clientY - bounds.top) / bounds.height * (this.bottom - this.top));
      this.dialog.close();
    };
    const close = document.createElement('button'); close.textContent = 'Close map'; close.onclick = () => this.dialog.close();
    this.dialog.append(title, help, this.canvas, close); document.body.append(this.dialog);
  }
  update(state: GameState): void { this.state = state; }
  private draw(): void {
    const state = this.state; if (!state) return;
    const ctx = this.canvas.getContext('2d')!;
    this.top = floorTopY(state.tower.floors.at(-1)!.index, state.tower.lobbyHeight) - 20;
    this.bottom = floorTopY(state.tower.floors[0]!.index, state.tower.lobbyHeight) + 40;
    const scaleX = this.canvas.width / (CONFIG.FLOOR_WIDTH_CELLS * CONFIG.CELL_WIDTH_PX);
    const scaleY = this.canvas.height / (this.bottom - this.top);
    ctx.clearRect(0, 0, 600, 400);
    ctx.fillStyle = '#b7c2b1';
    for (const floor of state.tower.floors) ctx.fillRect(0, (floorTopY(floor.index, state.tower.lobbyHeight) - this.top) * scaleY, 600, 1);
    for (const tenant of state.tenants.values()) {
      ctx.fillStyle = tenant.state === 'damaged' ? '#9c493f' : '#' + TENANT_COLORS[tenant.type].toString(16).padStart(6, '0');
      const height = facilityHeight(tenant.type);
      ctx.fillRect(tenant.x * CONFIG.CELL_WIDTH_PX * scaleX,
        (floorTopY(tenant.floor + height - 1, state.tower.lobbyHeight) - this.top) * scaleY,
        tenant.sizeCells * CONFIG.CELL_WIDTH_PX * scaleX, Math.max(2, (tenant.type === 'lobby' ? state.tower.lobbyHeight : height) * 20 * scaleY));
    }
    ctx.fillStyle = '#425e5d';
    for (const group of state.elevatorGroups.values()) ctx.fillRect(group.x * CONFIG.CELL_WIDTH_PX * scaleX,
      (floorTopY(group.serviceHi, state.tower.lobbyHeight) - this.top) * scaleY, shaftWidth(group) * CONFIG.CELL_WIDTH_PX * scaleX, (floorTopY(group.serviceLo, state.tower.lobbyHeight) + 20 * (group.serviceLo === 1 ? state.tower.lobbyHeight : 1) - floorTopY(group.serviceHi, state.tower.lobbyHeight)) * scaleY);
    ctx.fillStyle = '#c5a04f'; ctx.fillRect(0, (floorTopY(1, state.tower.lobbyHeight) - this.top) * scaleY, 600, 2);
  }
}
