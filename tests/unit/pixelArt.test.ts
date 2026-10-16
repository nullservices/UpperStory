import { describe, expect, it } from 'vitest';
import { TENANT_DATA, facilityHeight } from '../../src/data/config';
import type { TenantState, TenantType } from '../../src/sim';
import * as F from '../../src/render/sprites/furniture';
import { INK, PixMap, sprite, type PixelSprite } from '../../src/render/sprites/pixmap';
import { isOpenAir, lookCount, paintRoom, poolWater, type RoomLook } from '../../src/render/sprites/rooms';
import { paintText, textWidth } from '../../src/render/sprites/pixelFont';
import { formatMoney } from '../../src/render/worldUx';
import { flyoverToday } from '../../src/render/incidents';

const MAGENTA = 0xff00ff; // blit's colour for an unknown ink character

function hasMagenta(pm: PixMap): boolean {
  for (let y = 0; y < pm.h; y++) for (let x = 0; x < pm.w; x++) if (pm.get(x, y) === MAGENTA) return true;
  return false;
}

describe('pixel sprites', () => {
  it('parses character maps with transparent dots', () => {
    const s = sprite(['k.', '.W']);
    const pm = new PixMap(2, 2).blit(s, 0, 0);
    expect(pm.get(0, 0)).toBe(INK.k);
    expect(pm.get(1, 0)).toBe(-1);
    expect(pm.get(1, 1)).toBe(0xffffff);
  });

  it('uses only known inks in every furniture sprite', () => {
    for (const [name, value] of Object.entries(F)) {
      if (typeof value !== 'object' || !('codes' in value)) continue;
      const s = value as PixelSprite;
      const pm = new PixMap(s.w, s.h).blit(s, 0, 0);
      expect(hasMagenta(pm), name).toBe(false);
    }
  });

  it('paints every room type, state, variant and look at its footprint', () => {
    const types = Object.keys(TENANT_DATA) as TenantType[];
    const states: TenantState[] = ['open', 'vacant', 'constructing', 'damaged'];
    const looks: RoomLook[] = ['', 'guest', 'dirty', 'unhappy'];
    for (const type of types) {
      const w = TENANT_DATA[type].sizeCells * 12 * (type === 'lobby' ? 20 : 1);
      const h = facilityHeight(type) * 24;
      for (const state of states) {
        for (let v = 0; v < lookCount(type); v++) {
          for (const look of looks) {
            const pm = paintRoom(type, state, w, h, v, look);
            expect([pm.w, pm.h]).toEqual([w, h - 2]);
            expect(hasMagenta(pm), `${type}/${state}/${v}/${look}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('modern facility art and world readouts', () => {
  it('leaves open-air roof facilities transparent above the deck', () => {
    for (const type of ['rooftopPool', 'helipad'] as const) {
      expect(isOpenAir(type)).toBe(true);
      for (let v = 0; v < lookCount(type); v++) {
        const pm = paintRoom(type, 'open', TENANT_DATA[type].sizeCells * 12, 24, v, '');
        let opaque = 0;
        for (let x = 20; x < pm.w - 20; x++) if (pm.get(x, 0) >= 0) opaque++;
        expect(opaque / (pm.w - 40), `${type}/${v}`).toBeLessThan(0.5);
      }
    }
    expect(isOpenAir('bank')).toBe(false);
  });

  it('keeps the pool water inside the room', () => {
    const w = TENANT_DATA.rooftopPool.sizeCells * 12;
    for (let v = 0; v < lookCount('rooftopPool'); v++) {
      const r = poolWater(w, 24, v);
      expect(r.x).toBeGreaterThan(0);
      expect(r.x + r.w).toBeLessThan(w);
      expect(r.y + r.h).toBeLessThanOrEqual(22);
    }
  });

  it('paints the pixel font with known glyphs only', () => {
    const pm = new PixMap(80, 7);
    paintText(pm, '+$1.2K -$300 BANK FIRE', 0, 1, 0xffffff);
    expect(hasMagenta(pm)).toBe(false);
    expect(textWidth('12')).toBe(7);
  });

  it('formats money pops compactly', () => {
    expect(formatMoney(85_000)).toBe('$850');
    expect(formatMoney(1_250_000)).toBe('$12.5K');
    expect(formatMoney(30_000_000)).toBe('$300K');
    expect(formatMoney(120_000_000)).toBe('$1.2M');
  });

  it('schedules Santa on the last day of Q4 and the witch on 31 October', () => {
    const plain = new Date(2026, 5, 1);
    // Day index within a year: Q4 starts after 9 days; its last day is day 12.
    expect(flyoverToday(12, plain)).toBe('santa');
    expect(flyoverToday(11, plain)).toBe(null);
    expect(flyoverToday(3, plain)).toBe(null);
    expect(flyoverToday(3, new Date(2026, 9, 31))).toBe('witch');
  });
});
