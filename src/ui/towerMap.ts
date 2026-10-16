import { floorBounds } from '../sim/tower';
import { CONFIG } from '../data/config';
import { shaftWidth } from '../sim/elevators';
import { TENANT_COLORS } from '../render/palette';
import { floorTopY } from '../sim/tower';
import { facilityHeight } from '../data/config';
import type { GameState } from '../sim/state';
import { closeButton, makeDraggable } from './windowing';

export class TowerMap {
  private readonly dialog = document.createElement('dialog');
  private readonly canvas = document.createElement('canvas');
  private state: GameState | null = null;
  private top = 0;
  private bottom = 0;
  constructor(private readonly move: (worldX: number, worldY: number) => void) {
    this.dialog.className = 'ui-dialog tower-map-window';
    this.dialog.setAttribute('aria-label', 'Tower map');
    const title = document.createElement('div'); title.className = 'window-title';
    title.innerHTML = '<span class="title-text">Tower map</span>';
    title.append(closeButton('Close map', () => this.dialog.close()));
    const body = document.createElement('div'); body.className = 'window-body';
    const help = document.createElement('p'); help.className = 'window-hint'; help.textContent = 'Click the map to move the view. The gold line marks the lobby.';
    this.canvas.width = 600; this.canvas.height = 400;
    this.canvas.className = 'map-canvas';
    this.canvas.setAttribute('aria-label', 'Overview of tower rooms and elevator shafts');
    this.canvas.onclick = e => {
      const bounds = this.canvas.getBoundingClientRect();
      this.move((e.clientX - bounds.left) / bounds.width * CONFIG.FLOOR_WIDTH_CELLS * CONFIG.CELL_WIDTH_PX,
        this.top + (e.clientY - bounds.top) / bounds.height * (this.bottom - this.top));
      this.dialog.close();
    };
    body.append(this.canvas, help);
    const footer = document.createElement('div'); footer.className = 'window-footer';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close map'; close.onclick = () => this.dialog.close();
    footer.append(close);
    this.dialog.append(title, body, footer); document.body.append(this.dialog);
    makeDraggable(this.dialog, title, 'offset');
  }
  /** View › Tower map (M). */
  open(): void {
    if (this.dialog.open || !this.state) return;
    this.draw();
    this.dialog.showModal();
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
    ctx.fillStyle = '#9aa6b4';
    for (const floor of state.tower.floors) {
      const bounds = floorBounds(state, floor.index);
      ctx.fillRect(bounds.lo * CONFIG.CELL_WIDTH_PX * scaleX, (floorTopY(floor.index, state.tower.lobbyHeight) - this.top) * scaleY, (bounds.hi - bounds.lo) * CONFIG.CELL_WIDTH_PX * scaleX, 1);
    }
    for (const tenant of state.tenants.values()) {
      ctx.fillStyle = tenant.state === 'damaged' ? '#9c493f' : '#' + TENANT_COLORS[tenant.type].toString(16).padStart(6, '0');
      const height = facilityHeight(tenant.type);
      ctx.fillRect(tenant.x * CONFIG.CELL_WIDTH_PX * scaleX,
        (floorTopY(tenant.floor + height - 1, state.tower.lobbyHeight) - this.top) * scaleY,
        tenant.sizeCells * CONFIG.CELL_WIDTH_PX * scaleX, Math.max(2, (tenant.type === 'lobby' ? state.tower.lobbyHeight : height) * CONFIG.FLOOR_HEIGHT_PX * scaleY));
    }
    ctx.fillStyle = '#425e5d';
    for (const group of state.elevatorGroups.values()) ctx.fillRect(group.x * CONFIG.CELL_WIDTH_PX * scaleX,
      (floorTopY(group.serviceHi, state.tower.lobbyHeight) - this.top) * scaleY, shaftWidth(group) * CONFIG.CELL_WIDTH_PX * scaleX, (floorTopY(group.serviceLo, state.tower.lobbyHeight) + CONFIG.FLOOR_HEIGHT_PX * (group.serviceLo === 1 ? state.tower.lobbyHeight : 1) - floorTopY(group.serviceHi, state.tower.lobbyHeight)) * scaleY);
    const lobbyBounds = floorBounds(state, 1);
    ctx.fillStyle = '#c5a04f'; ctx.fillRect(lobbyBounds.lo * CONFIG.CELL_WIDTH_PX * scaleX, (floorTopY(1, state.tower.lobbyHeight) - this.top) * scaleY, (lobbyBounds.hi - lobbyBounds.lo) * CONFIG.CELL_WIDTH_PX * scaleX, 2);
  }
}
