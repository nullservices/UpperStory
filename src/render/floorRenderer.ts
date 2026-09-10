import { Container, Graphics, Text } from 'pixi.js';
import { facilityHeight, isHotel, CONFIG } from '../data/config';
import { floorHeightPx, floorTopY, type GameState, type Tenant } from '../sim';

/** Original procedural cutaway art. Structure is cached between building edits. */
export class TowerView {
  readonly container = new Container();
  private backdrop = new Graphics();
  private structure = new Graphics();
  private labels: Text[] = [];
  private revision = -1;
  private tower: GameState['tower'] | null = null;
  constructor() { this.container.addChild(this.backdrop, this.structure); }
  draw(state: GameState): void {
    if (this.tower === state.tower && this.revision === state.tower.structureRevision) return;
    this.tower = state.tower; this.revision = state.tower.structureRevision;
    const floors = state.tower.floors;
    if (!floors.length) return;
    const width = CONFIG.FLOOR_WIDTH_CELLS * CONFIG.CELL_WIDTH_PX;
    const b = this.backdrop; b.clear();
    // Ground level is the lobby's foot, not the basement floor.
    const ground = 0;
    b.rect(-6000, ground, 12000, 5000).fill(0xbcb99d);
    b.rect(-6000, ground, 12000, 5).fill(0x809b66);
    b.rect(-6000, ground + 5, 12000, 5).fill(0xc7c6b5);
    b.rect(-6000, ground + 10, 12000, 17).fill(0xa9aaa0);
    for (let x = -1200; x < 2400; x += 34) b.rect(x, ground + 18, 16, 1).fill(0xe3dfc6);
    // Faint skyline and trees, kept behind the playable structure.
    for (let i = 0; i < 25; i++) {
      const x = -1000 + i * 115;
      const h = 35 + ((i * 37) % 83);
      b.rect(x, ground - h, 64, h).fill(0xb1c6bd);
      b.rect(x + 5, ground - h - 4, 54, 4).fill(0xa6bdb6);
      for (let y = ground - h + 8; y < ground - 8; y += 12) {
        for (let col = 0; col < 5; col++) b.rect(x + 7 + col * 11, y, 5, 6).fill(0xc3d4c8);
      }
    }
    for (const x of [-175, -100, -42, width + 35, width + 115, width + 220]) {
      b.rect(x + 8, ground - 18, 3, 18).fill(0x8c8760);
      b.circle(x + 9, ground - 24, 13).fill(0x79986b);
      b.circle(x + 4, ground - 29, 10).fill(0x90a97a);
    }
    const g = this.structure; g.clear();
    for (const floor of floors) {
      const y = floorTopY(floor.index, state.tower.lobbyHeight); const h = floorHeightPx(floor, state.tower.lobbyHeight);
      g.rect(0, y, width, h).fill(floor.index <= 0 ? 0x979d8c : 0xdce0d3);
      for (let x = 0; x < width; x += 12) {
        if (floor.cells[x / 12]?.content === 'empty') {
          g.rect(x, y + 2, 1, h - 4).fill({ color: 0xb5c1b4, alpha: 0.5 });
          g.rect(x + 4, y + h - 6, 2, 1).fill(0xc1cbbd);
        }
      }
    }
    // Draw a whole room at once; cells are placement units, not dividing walls.
    for (const tenant of state.tenants.values()) this.room(g, tenant, state);
    for (const floor of floors) {
      const y = floorTopY(floor.index, state.tower.lobbyHeight); const h = floorHeightPx(floor, state.tower.lobbyHeight);
      floor.cells.forEach((cell, index) => {
        const x = index * CONFIG.CELL_WIDTH_PX;
        const lobbyStair = floor.index === CONFIG.LOBBY_FLOOR_INDEX &&
          floors.find(f => f.index === CONFIG.LOBBY_FLOOR_INDEX + 1)?.cells[index]?.content === 'stair';
        const lobbyEscalator = floor.index === 1 && state.escalators.has(`1:${index}`);
        if (cell.content === 'stair' || cell.content === 'escalator' || lobbyStair || lobbyEscalator) {
          const transport = lobbyStair || lobbyEscalator ? floors.find(f => f.index === 2)!.cells[index]! : cell;
          if ((transport.transportX ?? index) !== index) return;
          const width = (transport.transportWidth ?? 1) * CONFIG.CELL_WIDTH_PX;
          g.rect(x, y + 1, width, h - 2).fill(0xc1c9bc);
          for (let i = 0; i < 8; i++) g.rect(x + i * width / 8, y + h - 4 - i * (h - 6) / 8, width / 8 + 1, 2).fill(0x6c8276);
        }
      });
      let segmentStart = 0;
      for (let column = 0; column <= floor.cells.length; column++) {
        const tenant = state.tenants.get(floor.cells[column]?.tenantId ?? -1);
        const interior = tenant && floor.index < tenant.floor + facilityHeight(tenant.type) - 1;
        if (interior || column === floor.cells.length) {
          if (column > segmentStart) {
            g.rect(segmentStart * CONFIG.CELL_WIDTH_PX, y, (column - segmentStart) * CONFIG.CELL_WIDTH_PX, 2).fill(0x83958b);
            g.rect(segmentStart * CONFIG.CELL_WIDTH_PX, y + 2, (column - segmentStart) * CONFIG.CELL_WIDTH_PX, 1).fill(0xf1f0df);
          }
          segmentStart = column + 1;
        }
      }
      g.rect(-2, y, 2, h).fill(0x7e9183);
      g.rect(width, y, 2, h).fill(0x7e9183);
    }
    const roof = floorTopY(floors[floors.length - 1]!.index, state.tower.lobbyHeight);
    g.rect(-5, roof - 4, width + 10, 4).fill(0x6e847d);
    g.rect(-5, roof - 5, width + 10, 1).fill(0xe6e9da);
    for (const label of this.labels) label.destroy();
    this.labels = [];
    for (const floor of floors) {
      const text = new Text({ text: floor.index <= 0 ? `B${1 - floor.index}` : floor.index === 1 ? 'L' : String(floor.index), style: { fontSize: 9, fill: 0x496253, fontFamily: 'Tahoma', fontWeight: 'bold' } });
      text.position.set(-22, floorTopY(floor.index, state.tower.lobbyHeight) + 5); this.labels.push(text); this.container.addChild(text);
    }
  }
  private room(g: Graphics, tenant: Tenant, state: GameState): void {
    const x = tenant.x * CONFIG.CELL_WIDTH_PX, y = floorTopY(tenant.floor + facilityHeight(tenant.type) - 1, state.tower.lobbyHeight);
    const w = tenant.sizeCells * CONFIG.CELL_WIDTH_PX;
    const h = tenant.floor === 1 ? 20 * state.tower.lobbyHeight : 20 * facilityHeight(tenant.type);
    if (tenant.state === 'constructing') {
      g.rect(x + 1, y + 2, w - 2, h - 3).fill(0xd4d0b8);
      for (let sx = x + 3; sx < x + w - 3; sx += 12) {
        g.rect(sx, y + 3, 2, h - 5).fill(0xb29d6c);
        g.moveTo(sx, y + h - 3).lineTo(Math.min(sx + 12, x + w - 2), y + 4).stroke({ width: 1, color: 0xaaa17e });
      }
      g.rect(x + 1, y + h - 4, w - 2, 3).fill(0xba9a54);
      return;
    }
    const colors: Record<string, number> = { office: 0xe3e4d7, condo: 0xe7d4ba, hotel: 0xddd1db, fastfood: 0xe9d8b9, restaurant: 0xd6dfc5, shop: 0xe7d8c0, lobby: 0xece6cd, skyLobby: 0xd9e5dc, security: 0xd0dddb, housekeeping: 0xdde0d0 };
    g.rect(x + 1, y + 2, w - 2, h - 3).fill(colors[tenant.type] ?? 0xdce0d3);
    g.rect(x + 1, y + h - 4, w - 2, 3).fill(tenant.type === 'office' ? 0x92aeb0 : 0xb6a789);
    g.rect(x, y + 2, 2, h - 2).fill(0x9b9d88);
    if (tenant.type === 'lobby' || tenant.type === 'skyLobby') {
      for (let sx = x + 8; sx < x + w - 10; sx += 38) {
        g.rect(sx, y + 5, 26, h - 11).fill(0xb1d3d0);
        g.rect(sx + 1, y + 6, 10, h - 13).fill(0xcbe4de);
        g.rect(sx + 12, y + 5, 2, h - 11).fill(0x879e92);
        g.rect(sx - 4, y + 3, 3, h - 6).fill(0xd0c7a6);
      }
      for (let sx = x + 25; sx < x + w - 25; sx += 96) {
        this.plant(g, sx, y + h - 5);
        g.rect(sx + 10, y + h - 10, 23, 5).fill(0x8f9c76);
        g.rect(sx + 12, y + h - 5, 2, 2).fill(0x6c735b);
        g.rect(sx + 29, y + h - 5, 2, 2).fill(0x6c735b);
      }
    } else if (tenant.type === 'office' || tenant.type === 'security') {
      for (let sx = x + 6; sx < x + w - 18; sx += 28) {
        this.window(g, sx, y + 4, 18, 7);
        g.rect(sx + 2, y + 13, 19, 2).fill(0x9f8866);
        g.rect(sx + 6, y + 9, 7, 5).fill(0x526e72);
        g.rect(sx + 7, y + 10, 5, 3).fill(0xb1d5cd);
        g.rect(sx + 16, y + 14, 4, 3).fill(0x738b8f);
      }
      this.plant(g, x + w - 8, y + h - 4);
    } else if (tenant.type === 'condo' || isHotel(tenant.type)) {
      for (let sx = x + 5; sx < x + w - 24; sx += 34) {
        this.window(g, sx + 2, y + 4, 13, 7);
        g.rect(sx, y + 12, 22, 5).fill(isHotel(tenant.type) ? 0x9c85a4 : 0xb98267);
        g.rect(sx + 1, y + 12, 6, 3).fill(0xf5eedf);
        g.rect(sx + 24, y + 11, 5, 6).fill(0x9d8965);
        g.rect(sx + 25, y + 7, 3, 4).fill(0xe2c88d);
      }
    } else if (tenant.type === 'fastfood' || tenant.type === 'restaurant') {
      g.rect(x + 3, y + 3, w - 6, 3).fill(tenant.type === 'fastfood' ? 0xb96947 : 0x789269);
      g.rect(x + 4, y + 11, 14, 6).fill(0xbc9c6b);
      for (let sx = x + 23; sx < x + w - 8; sx += 18) {
        g.rect(sx, y + 11, 11, 2).fill(0xf1e4c5);
        g.rect(sx + 5, y + 13, 1, 4).fill(0x8b795e);
        g.rect(sx - 2, y + 13, 3, 4).fill(0x9b7560);
        g.rect(sx + 11, y + 13, 3, 4).fill(0x9b7560);
      }
    } else if (tenant.type === 'cinema') {
      g.rect(x + 5, y + 4, w - 10, h - 10).fill(0x414e56);
      g.rect(x + w / 4, y + 6, w / 2, h / 3).fill(0xc9d4c6);
      for (let row = 0; row < 3; row++) for (let sx = x + 8; sx < x + w - 8; sx += 12) g.rect(sx, y + h / 2 + row * 5, 8, 4).fill(0xa46f68);
    } else if (tenant.type === 'cathedral') {
      g.rect(x + 4, y + 3, w - 8, h - 6).fill(0xd6c8a4);
      for (let sx = x + 12; sx < x + w - 15; sx += 28) {
        g.roundRect(sx, y + 10, 16, h / 2, 8).fill(0x809aab);
        g.rect(sx + 7, y + 10, 2, h / 2).fill(0xd6b87b);
        g.rect(sx, y + h / 3, 16, 2).fill(0xd6b87b);
        g.rect(sx - 3, y + h - 14, 24, 6).fill(0x947d5c);
      }
    } else if (tenant.type === 'metro') {
      g.rect(x + 3, y + 4, w - 6, h - 7).fill(0x596868);
      g.roundRect(x + 8, y + h / 2, w - 16, h / 3, 5).fill(0xb5c9bd);
      for (let sx = x + 15; sx < x + w - 20; sx += 22) g.rect(sx, y + h / 2 + 3, 14, 8).fill(0x5c8b93);
      g.rect(x + 4, y + h - 6, w - 8, 2).fill(0xd7c490);
    } else if (tenant.type === 'parkingSpace') {
      g.roundRect(x + 4, y + 9, w - 8, 7, 2).fill([0x8d9da7, 0xb08068, 0x7f9981][tenant.id % 3]!);
      g.rect(x + 12, y + 6, w - 24, 5).fill(0xbed2cb);
      g.circle(x + 10, y + 17, 2).fill(0x52605c); g.circle(x + w - 10, y + 17, 2).fill(0x52605c);
    } else if (tenant.type === 'parkingRamp') {
      g.moveTo(x + 2, y + h - 3).lineTo(x + w - 2, y + 4).stroke({ width: 3, color: 0x7d8d81 });
    } else if (tenant.type === 'partyHall') {
      for (let sx = x + 14; sx < x + w - 12; sx += 25) {
        g.circle(sx, y + h - 12, 7).fill(0xe7dcc7);
        g.rect(sx - 9, y + h - 12, 3, 6).fill(0x9d7a68);
        g.rect(sx + 7, y + h - 12, 3, 6).fill(0x9d7a68);
      }
      g.circle(x + w / 2, y + 8, 4).fill(0xd9bd71);
    } else if (tenant.type === 'medical') {
      for (let sx = x + 8; sx < x + w - 20; sx += 28) {
        g.rect(sx, y + 11, 22, 5).fill(0xe8ecdd); g.rect(sx + 2, y + 10, 5, 3).fill(0xacc6ba);
      }
      g.rect(x + w - 11, y + 4, 3, 9).fill(0xad6056); g.rect(x + w - 14, y + 7, 9, 3).fill(0xad6056);
    } else if (tenant.type === 'recycling') {
      for (let sx = x + 8; sx < x + w - 20; sx += 28) {
        g.rect(sx, y + 8, 20, h - 14).fill(0x7e9780); g.rect(sx - 1, y + 6, 22, 3).fill(0x536e60);
      }
    } else {
      for (let sx = x + 5; sx < x + w - 10; sx += 19) {
        g.rect(sx, y + 5, 14, 12).fill(0xb3a384);
        for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) g.rect(sx + 2 + col * 4, y + 6 + row * 5, 3, 4).fill([0xa8b894, 0xb97f69, 0xe4cf92][col]!);
        g.rect(sx, y + 10, 14, 1).fill(0x897c61);
      }
    }
    if (tenant.state === 'damaged') {
      g.rect(x + 1, y + 2, w - 2, h - 3).fill({ color: 0x433f38, alpha: 0.75 });
      for (let sx = x + 4; sx < x + w - 8; sx += 14) g.moveTo(sx, y + 4).lineTo(sx + 8, y + h - 4).stroke({ width: 2, color: 0xb88e4b });
    }
    if (tenant.state === 'vacant') g.rect(x + 2, y + 3, w - 4, h - 6).fill({ color: 0xb0b0a0, alpha: 0.5 });

  }
  private window(g: Graphics, x: number, y: number, w: number, h: number): void {
    g.rect(x, y, w, h).fill(0xa8ced0); g.rect(x + 1, y + 1, w / 2 - 1, h - 2).fill(0xc8e1de);
    g.rect(x + w / 2, y, 1, h).fill(0x8ca9a3);
  }
  private plant(g: Graphics, x: number, y: number): void {
    g.rect(x, y - 3, 5, 3).fill(0xae8e66); g.rect(x + 2, y - 8, 1, 5).fill(0x758258);
    g.circle(x + 2, y - 8, 4).fill(0x7d9a68);
  }
}
