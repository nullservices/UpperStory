import { shaftWidth } from '../sim/elevators';
import { Container, Graphics, Sprite } from 'pixi.js';
import { CONFIG } from '../data/config';
import {
  carWorldY,
  floorHeightPx,
  floorTopY,
  getFloor,
  type ElevatorGroup,
  type GameState,
} from '../sim';
import { advanceAnimClock } from './animClock';
import { carOutOfService, towerUnpowered } from './simCompat';
import { roomLighting } from './roomLighting';
import { hash32 } from './sprites/pixmap';
import type { Motion } from './motion';
import { RowBuckets, visibleWorldBand } from './rowBuckets';
import { ELEVATOR_COLORS } from './palette';
import { DOOR_STEPS, brokenCarTexture, carTexture, machineRoom, shaftSegment, type LandingKind } from './sprites/elevator';

/** Car inset from its floor band: top gap and bottom gap (slab). */
const CAR_TOP_INSET = 3;
const CAR_BOTTOM_INSET = 3;
const CAR_H = CONFIG.FLOOR_HEIGHT_PX - CAR_TOP_INSET - CAR_BOTTOM_INSET;

/**
 * Vertical transport view, in pixel art (sprites/elevator.ts). The shafts
 * (housing, dark well, rails, slabs and a landing door frame with indicator
 * at every served stop) are cached textures placed once per structure edit;
 * the cars are pooled sprites whose door frames step open and closed while a
 * car is in its 'doors' state. Cables, direction and call lamps are a small
 * per-frame Graphics. Riders are drawn by the people view on top.
 */
export class ElevatorView {
  readonly container = new Container();
  private readonly shafts = new RowBuckets();
  private readonly carLayer = new Container();
  private readonly cables = new Graphics();
  private readonly lamps = new Graphics();
  private readonly carPool: Sprite[] = [];
  private signature = '';
  private anim = 0;
  private tower: GameState['tower'] | null = null;
  /** Blackout without backup power this frame (car lamps go dark). */
  private unpowered = false;
  /** World rows on screen this frame (null = draw everything). */
  private band: { top: number; bottom: number } | null = null;

  constructor() {
    this.container.eventMode = 'none';
    this.container.addChild(this.shafts.root, this.cables, this.carLayer, this.lamps);
  }

  draw(state: GameState, alpha = 1, motion?: Motion): void {
    this.anim = advanceAnimClock(state, alpha);
    // Blackout without a generator: cars sit dark (the sim holds them).
    this.unpowered = towerUnpowered(state);
    this.carLayer.tint = this.unpowered ? 0x50566e : 0xffffff;
    // Stop toggles do not always bump the structure revision; fold them in.
    let signature = String(state.tower.structureRevision);
    for (const group of state.elevatorGroups.values()) signature += `|${group.id}:${group.stops.length}:${group.disabledStops?.length ?? 0}`;
    if (this.tower !== state.tower || this.signature !== signature) {
      this.tower = state.tower;
      this.signature = signature;
      this.shafts.clear();
      for (const group of state.elevatorGroups.values()) this.drawShaft(state, group);
    }
    // Shafts darken with the unlit structure at night (cars keep their lit cabins).
    this.shafts.root.tint = roomLighting.structure;
    this.cables.tint = roomLighting.structure;
    const band = visibleWorldBand(this.container, CONFIG.FLOOR_HEIGHT_PX);
    if (band) this.shafts.cull(band.top, band.bottom);
    else this.shafts.showAll();
    this.band = band;
    this.cables.clear();
    this.lamps.clear();
    let used = 0;
    for (const group of state.elevatorGroups.values()) used = this.drawCars(state, group, alpha, used, motion);
    for (let i = used; i < this.carPool.length; i++) this.carPool[i]!.visible = false;
  }

  private drawShaft(state: GameState, group: ElevatorGroup): void {
    const cell = CONFIG.CELL_WIDTH_PX;
    const lh = state.tower.lobbyHeight;
    const x = group.x * cell;
    const w = shaftWidth(group) * cell;
    const stops = new Set(group.stops);
    const disabled = new Set(group.disabledStops ?? []);
    for (let f = group.serviceLo; f <= group.serviceHi; f++) {
      const floor = getFloor(state.tower, f);
      const h = floor ? floorHeightPx(floor, lh) : f === CONFIG.LOBBY_FLOOR_INDEX ? CONFIG.FLOOR_HEIGHT_PX * lh : CONFIG.FLOOR_HEIGHT_PX;
      const landing: LandingKind = !floor || !stops.has(f) ? 'pass' : disabled.has(f) ? 'off' : 'stop';
      const segment = new Sprite(shaftSegment(group.kind, w, h, landing, CAR_H));
      segment.position.set(x, floorTopY(f, lh));
      segment.roundPixels = true;
      this.shafts.add(segment, segment.y, h);
    }
    const cap = new Sprite(machineRoom(group.kind, w));
    cap.position.set(x - 1, floorTopY(group.serviceHi, lh) - 5);
    cap.roundPixels = true;
    this.shafts.add(cap, cap.y, 5);
  }

  private drawCars(state: GameState, group: ElevatorGroup, alpha: number, used: number, motion?: Motion): number {
    const cell = CONFIG.CELL_WIDTH_PX;
    const lh = state.tower.lobbyHeight;
    const x = group.x * cell;
    const w = shaftWidth(group) * cell;
    const shaftTop = floorTopY(group.serviceHi, lh);
    const g = this.cables;
    for (const car of group.cars) {
      const y = Math.round(motion?.carY(state, car.id, car.y, alpha) ?? carWorldY(car.y, lh));
      const top = y + CAR_TOP_INSET;
      const left = x + 2, cw = w - 4;
      // Hoist cables from the machine room.
      const cableX = x + Math.floor(w / 2);
      if (top > shaftTop) {
        g.rect(cableX - 2, shaftTop, 1, top - shaftTop).fill(0x6a6e78);
        g.rect(cableX + 1, shaftTop, 1, top - shaftTop).fill(0x8a8e98);
      }
      const open = car.state === 'doors'
        ? Math.max(0, Math.min(1, car.doorsTicksLeft >= CONFIG.ELEVATOR_DOOR_TICKS ? alpha : 1 - alpha))
        : 0;
      const step = Math.round(open * (DOOR_STEPS - 1));
      const sprite = this.carAt(used++);
      const broken = carOutOfService(car);
      sprite.texture = broken ? brokenCarTexture(group.kind, cw, CAR_H) : carTexture(group.kind, cw, CAR_H, step);
      sprite.position.set(left, top);
      sprite.visible = true;
      if (broken) {
        // Sparks spitting from the car roof on the pause-aware clock.
        const tick = Math.floor(this.anim / 90);
        for (let k = 0; k < 3; k++) {
          const h = hash32(tick * 7 + k * 131 + car.id * 977);
          if (h % 3 === 0) continue;
          const sx = left + 2 + (h % Math.max(1, cw - 4));
          const sy = top - 1 - ((h >> 8) % 4);
          this.lamps.rect(sx, sy, 1, 1).fill((h >> 4) % 2 ? 0xfff4bc : 0xffb030);
          if ((h >> 12) % 2) this.lamps.rect(sx + ((h >> 13) % 2 ? 1 : -1), sy - 1, 1, 1).fill(0xffdc58);
        }
        continue;
      }
      // Direction lamp on the car header: a stepped pixel arrow (5x3).
      if (!this.unpowered && (car.dir === 1 || car.dir === -1)) {
        const ax = left + cw - 6, ay = top - 3;
        const color = car.dir === 1 ? ELEVATOR_COLORS.arrowUp : ELEVATOR_COLORS.arrowDown;
        for (let row = 0; row < 3; row++) {
          const half = car.dir === 1 ? row : 2 - row;
          this.lamps.rect(ax + 2 - half, ay + row, half * 2 + 1, 1).fill(color);
        }
      }
    }
    // Hall calls show on the landing queue badges (worldUx.ts), beside the
    // shaft whose landing the callers actually wait at.
    return used;
  }

  private carAt(index: number): Sprite {
    let sprite = this.carPool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.roundPixels = true;
      this.carPool.push(sprite);
      this.carLayer.addChild(sprite);
    }
    return sprite;
  }
}
