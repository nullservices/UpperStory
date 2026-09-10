import { shaftWidth } from '../sim/elevators';
import { Container, Graphics } from 'pixi.js';
import { CONFIG } from '../data/config';
import {
  carWorldY,
  floorHeightPx,
  floorTopY,
  getFloor,
  type ElevatorGroup,
  type GameState,
} from '../sim';
import type { Motion } from './motion';
import { ELEVATOR_COLORS } from './palette';

/** Car body: 14px tall strip inset inside the housing. */
const CAR_H = 14;
/** Seat pips color (drawn when the car carries passengers). */
const PIP_COLOR = 0xd8b84a;
/** Darker shaft visible inside the translucent housing. */
const SHAFT_INNER = 0x526761;
/** Housing tint for service shafts (staff-only, M3). */
const SERVICE_HOUSING = 0x8a9e9b;
/** Housing tint for express shafts (M4) — between the standard and service. */
const EXPRESS_HOUSING = 0x9b9c88;

/**
 * Vertical transport view: one shaft housing per elevator group, its cars
 * (with a small occupancy pips row), and red call lamps beside the serviced
 * floors that have a pending call. Redrawn every frame.
 */
export class ElevatorView {
  readonly container = new Container();
  private readonly graphics = new Graphics();

  constructor() {
    this.container.addChild(this.graphics);
  }

  draw(state: GameState, alpha = 1, motion?: Motion): void {
    const g = this.graphics;
    g.clear();
    for (const group of state.elevatorGroups.values()) {
      this.drawGroup(g, state, group, alpha, motion);
    }
  }

  private drawGroup(g: Graphics, state: GameState, group: ElevatorGroup, alpha: number, motion?: Motion): void {
    // --- Housing: one translucent column from the top serviced band down to
    // the bottom of the lowest serviced band (a shaft serving B1 ends at the
    // ground line; the lobby band is included whenever the group serves it,
    // because the lobby's cells stay lobby cells).
    const cell = CONFIG.CELL_WIDTH_PX;
    const top = floorTopY(group.serviceHi, state.tower.lobbyHeight);
    const loFloor = getFloor(state.tower, group.serviceLo);
    const bottom = floorTopY(group.serviceLo, state.tower.lobbyHeight) + (loFloor ? floorHeightPx(loFloor, state.tower.lobbyHeight) : bandFallbackPx(group.serviceLo, state.tower.lobbyHeight));
    const housingX = group.x * cell - 1;
    const housingW = cell * shaftWidth(group) + 2;
    g.rect(housingX, top, housingW, bottom - top).fill({
      color:
        group.kind === 'service'
          ? SERVICE_HOUSING
          : group.kind === 'express'
            ? EXPRESS_HOUSING
            : ELEVATOR_COLORS.shaftHousing,
      alpha: 0.8,
    });
    // Thin darker shaft between the two door columns.
    g.rect((group.x + shaftWidth(group) / 2) * cell - 3, top, 6, bottom - top).fill({
      color: SHAFT_INNER,
      alpha: 1,
    });

    // Guide rails make the moving cabin legible against the shaft.
    g.rect(housingX + 2, top, 1, bottom - top).fill(0xd2d8c5);
    g.rect(housingX + housingW - 3, top, 1, bottom - top).fill(0xd2d8c5);
    for (const car of group.cars) {
      const carTop = (motion?.carY(state, car.id, car.y, alpha) ?? carWorldY(car.y, state.tower.lobbyHeight)) + 3;
      const left = group.x * cell + 1, width = cell * shaftWidth(group) - 2;
      g.rect(left, carTop - 1, width, CAR_H + 2).fill(0x405e59);
      g.rect(left + 1, carTop, width - 2, CAR_H).fill(0xf2d49a);
      if (car.passengers.length > 0) this.drawPips(g, group, carTop, car.passengers.length);
      const open = car.state === 'doors'
        ? Math.max(0, Math.min(1, car.doorsTicksLeft >= CONFIG.ELEVATOR_DOOR_TICKS ? alpha : 1 - alpha))
        : 0;
      const doorWidth = (width - 2) / 2 * (1 - open);
      if (doorWidth > 0) {
        g.rect(left + 1, carTop + 1, doorWidth, CAR_H - 2).fill({ color: 0x87a9a5, alpha: 0.65 });
        g.rect(left + width - 1 - doorWidth, carTop + 1, doorWidth, CAR_H - 2).fill({ color: 0x87a9a5, alpha: 0.65 });
        g.rect(left + 1 + doorWidth, carTop + 1, 1, CAR_H - 2).fill(0x587a74);
        g.rect(left + width - 1 - doorWidth, carTop + 1, 1, CAR_H - 2).fill(0x587a74);
      }
      g.rect(left + 2, carTop, width - 4, 1).fill(0xfff4d6);
      const arrowY = carTop - 5;
      if (car.dir === 1) g.moveTo(left + 8, arrowY + 3).lineTo(left + 11, arrowY).lineTo(left + 14, arrowY + 3).stroke({ color: 0x4a8c67, width: 1.5 });
      else if (car.dir === -1) g.moveTo(left + 8, arrowY).lineTo(left + 11, arrowY + 3).lineTo(left + 14, arrowY).stroke({ color: 0xb77c41, width: 1.5 });
    }

    // --- Call lamps: a 3x3 light beside the shaft for each pending direction
    // on a serviced floor that exists (up lamp near the band top, down lamp
    // near the bottom, the door strip the stopped car occupies).
    for (let f = group.serviceLo; f <= group.serviceHi; f++) {
      const call = state.floorCalls.get(f);
      if (!call || (!call.up && !call.down)) continue;
      if (!getFloor(state.tower, f)) continue;
      const bandTop = carWorldY(f, state.tower.lobbyHeight);
      if (call.up) g.rect(group.x * cell - 5, bandTop + 2, 3, 3).fill({ color: ELEVATOR_COLORS.callLight, alpha: 1 });
      if (call.down) g.rect(group.x * cell - 5, bandTop + 15, 3, 3).fill({ color: ELEVATOR_COLORS.callLight, alpha: 1 });
    }
  }

  /** 2x2 seat pips (3px pitch, 3 rows of 5) along the top of the car body. */
  private drawPips(g: Graphics, group: ElevatorGroup, carTop: number, count: number): void {
    const cell = CONFIG.CELL_WIDTH_PX;
    const startX = group.x * cell + 4;
    const perRow = 5;
    const total = Math.min(count, perRow * 3);
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      g.rect(startX + col * 3, carTop + 3 + row * 3, 2, 2).fill({
        color: PIP_COLOR,
        alpha: 1,
      });
    }
  }
}

/** Band height for an index whose Floor object may not be at hand. */
function bandFallbackPx(index: number, lobbyHeight: number): number {
  return index === CONFIG.LOBBY_FLOOR_INDEX
    ? CONFIG.FLOOR_HEIGHT_PX * lobbyHeight
    : CONFIG.FLOOR_HEIGHT_PX;
}
