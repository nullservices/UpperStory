import { Container, Graphics, Sprite } from 'pixi.js';
import { CONFIG, TENANT_DATA } from '../data/config';
import { floorTopY, type GameState } from '../sim';
import { animTime } from './animClock';
import { shaftWidth } from '../sim/elevators';
import { badgeSide, landingQueues } from './landingQueues';
import { GLYPH_ADVANCE, glyphAtlas } from './sprites/pixelFont';

/**
 * World-space readouts in the pixel font:
 *  - money pops: "+$" rising from a room when its day's takings grow (a
 *    customer paid, a guest checked out), "-$" at a newly placed room or
 *    shaft; they rise and fade on the pause-aware clock, capped in number
 *    and throttled per room so a busy food court does not flood the view.
 *  - landing queue badges: the number of people waiting at each elevator
 *    landing, neutral → yellow (≥ 15) → red (≥ 30). They sit beside the
 *    shaft over the longer queue, clear of the landing door and header.
 * Glyph sprites are pooled; nothing allocates per frame in steady state.
 */

const POP_MS = 1500;
const POP_RISE = 16;
const MAX_POPS = 28;
/** Minimum anim ms between two "+$" pops from the same room. */
const POP_THROTTLE_MS = 2600;
const QUEUE_WARN = 15;
const QUEUE_ALERT = 30;

interface Pop {
  x: number;
  y: number;
  text: string;
  color: number;
  born: number;
}

interface Rect { left: number; right: number; top: number; bottom: number }

/** Compact money label: $850, $12.5K, $1.2M. */
export function formatMoney(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  if (dollars < 1000) return `$${Math.max(1, Math.round(dollars))}`;
  if (dollars < 1_000_000) {
    const k = dollars / 1000;
    return `$${k < 100 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K`;
  }
  const m = dollars / 1_000_000;
  return `$${m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

export class WorldUxView {
  readonly container = new Container();
  private readonly backs = new Graphics();
  private readonly glyphLayer = new Container();
  private readonly pool: Sprite[] = [];
  private used = 0;
  private pops: Pop[] = [];
  private owner: GameState | null = null;
  private revenue = new Map<number, number>();
  private pending = new Map<number, number>();
  private lastPop = new Map<number, number>();
  private groupIds = new Set<number>();
  private balance = 0;

  constructor() {
    this.container.eventMode = 'none';
    this.container.addChild(this.backs, this.glyphLayer);
  }

  draw(state: GameState): void {
    const now = animTime();
    const zoom = Math.abs(this.container.worldTransform.a) || 1;
    const scale = zoom < 1 ? 2 : 1;
    const rect = this.visibleRect();
    this.track(state, now, rect);
    this.backs.clear();
    this.used = 0;
    this.drawBadges(state, scale, rect);
    this.drawPops(now, scale);
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  /** Detect revenue increases and new rooms/shafts since the last frame. */
  private track(state: GameState, now: number, rect: Rect | null): void {
    const cell = CONFIG.CELL_WIDTH_PX;
    const lh = state.tower.lobbyHeight;
    if (this.owner !== state) {
      // New game or loaded save: take a silent snapshot.
      this.owner = state;
      this.revenue.clear(); this.pending.clear(); this.lastPop.clear(); this.pops = [];
      for (const t of state.tenants.values()) this.revenue.set(t.id, t.dailyRevenue);
      this.groupIds = new Set(state.elevatorGroups.keys());
      this.balance = state.money.balanceCents;
      return;
    }
    const drop = this.balance - state.money.balanceCents;
    this.balance = state.money.balanceCents;
    const fresh: number[] = [];
    for (const t of state.tenants.values()) {
      const last = this.revenue.get(t.id);
      if (last === undefined) fresh.push(t.id);
      else if (t.dailyRevenue > last) this.pending.set(t.id, (this.pending.get(t.id) ?? 0) + t.dailyRevenue - last);
      this.revenue.set(t.id, t.dailyRevenue);
    }
    if (this.revenue.size > state.tenants.size) {
      for (const id of this.revenue.keys()) if (!state.tenants.has(id)) { this.revenue.delete(id); this.pending.delete(id); this.lastPop.delete(id); }
    }
    for (const id of fresh) {
      const t = state.tenants.get(id)!;
      const cost = fresh.length === 1 && drop > 0 ? drop : TENANT_DATA[t.type].costDollars * 100;
      this.spawn(t.x * cell + (t.sizeCells * cell) / 2, floorTopY(t.floor, lh) + 4, `-${formatMoney(cost)}`, 0xff6a5a, now, true);
    }
    for (const group of state.elevatorGroups.values()) {
      if (this.groupIds.has(group.id)) continue;
      this.groupIds.add(group.id);
      if (drop > 0 && fresh.length === 0) {
        this.spawn((group.x + 2) * cell, floorTopY(group.serviceHi, lh) + 2, `-${formatMoney(drop)}`, 0xff6a5a, now, true);
      }
    }
    if (this.groupIds.size > state.elevatorGroups.size) {
      for (const id of this.groupIds) if (!state.elevatorGroups.has(id)) this.groupIds.delete(id);
    }
    for (const [id, cents] of this.pending) {
      if (this.pops.length >= MAX_POPS) break;
      const last = this.lastPop.get(id);
      if (last !== undefined && now - last < POP_THROTTLE_MS) continue;
      const t = state.tenants.get(id);
      this.pending.delete(id);
      if (!t) continue;
      const x = t.x * cell + (t.sizeCells * cell) / 2;
      const y = floorTopY(t.floor, lh) + 6;
      if (rect && (x < rect.left - 40 || x > rect.right + 40 || y < rect.top - 30 || y > rect.bottom + 30)) continue;
      this.lastPop.set(id, now);
      this.spawn(x, y, `+${formatMoney(cents)}`, 0x7cf07c, now, false);
    }
  }

  private spawn(x: number, y: number, text: string, color: number, now: number, force: boolean): void {
    if (this.pops.length >= MAX_POPS) {
      if (!force) return;
      this.pops.shift();
    }
    this.pops.push({ x, y, text, color, born: now });
  }

  private drawPops(now: number, scale: number): void {
    const atlas = glyphAtlas();
    this.pops = this.pops.filter(p => now - p.born < POP_MS && now >= p.born);
    for (const pop of this.pops) {
      const t = (now - pop.born) / POP_MS;
      const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      const w = pop.text.length * GLYPH_ADVANCE * scale;
      const x0 = Math.round(pop.x - w / 2);
      const y0 = Math.round(pop.y - t * POP_RISE * scale);
      for (let i = 0; i < pop.text.length; i++) {
        const tex = atlas.frames.get(pop.text[i]!);
        if (!tex) continue;
        this.glyph(tex, x0 + i * GLYPH_ADVANCE * scale, y0, scale, pop.color, alpha);
      }
    }
  }

  private drawBadges(state: GameState, scale: number, rect: Rect | null): void {
    if (!landingQueues.size) return;
    const atlas = glyphAtlas();
    const cell = CONFIG.CELL_WIDTH_PX;
    for (const q of landingQueues.values()) {
      if (rect && (q.right < rect.left - 40 || q.left > rect.right + 40 || q.y < rect.top - 20 || q.y > rect.bottom + 20)) continue;
      const text = String(Math.min(999, q.count));
      const [bg, fg, edge] = q.count >= QUEUE_ALERT
        ? [0xd02828, 0xffffff, 0x6a0c0c]
        : q.count >= QUEUE_WARN
          ? [0xf0c020, 0x26262a, 0x7a5a08]
          : [0x2c3448, 0xffffff, 0x10141e];
      // Beside the shaft over the queue (never on the landing door/header),
      // in the band's top strip above the queued people's heads.
      const w = (text.length * GLYPH_ADVANCE + 1) * scale;
      const h = 7 * scale;
      const gap = 2;
      const span = (side: -1 | 1): [number, number] => side === -1
        ? [q.left - gap - w - scale, q.left - gap]
        : [q.right + gap, q.right + gap + w + scale];
      const side = badgeSide(q, s => {
        const [a, b] = span(s);
        for (const g of state.elevatorGroups.values()) {
          if (q.floor < g.serviceLo || q.floor > g.serviceHi) continue;
          const gl = g.x * cell, gr = (g.x + shaftWidth(g)) * cell;
          if (gr > a && gl < b) return true;
        }
        return false;
      });
      const x0 = Math.round(side === -1 ? q.left - gap - w : q.right + gap + scale);
      const y0 = Math.round(q.y + 1 + scale);
      this.backs.rect(x0 - scale, y0 - scale, w + 2 * scale, h + 2 * scale).fill(edge);
      this.backs.rect(x0, y0, w, h).fill(bg);
      this.backs.rect(x0, y0, w, scale).fill({ color: 0xffffff, alpha: 0.25 });
      for (let i = 0; i < text.length; i++) {
        const tex = atlas.frames.get(text[i]!);
        if (tex) this.glyph(tex, x0 + scale + i * GLYPH_ADVANCE * scale, y0 + scale, scale, fg, 1);
      }
    }
  }

  private glyph(tex: Sprite['texture'], x: number, y: number, scale: number, color: number, alpha: number): void {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite();
      s.roundPixels = true;
      this.pool.push(s);
      this.glyphLayer.addChild(s);
    }
    this.used++;
    s.texture = tex;
    s.position.set(x - scale, y - scale);
    s.scale.set(scale);
    s.tint = color;
    s.alpha = alpha;
    s.visible = true;
  }

  /** World rect under the browser viewport (null outside a browser). */
  private visibleRect(): Rect | null {
    if (typeof window === 'undefined' || !this.container.parent) return null;
    const tl = this.container.toLocal({ x: 0, y: 0 });
    const br = this.container.toLocal({ x: window.innerWidth, y: window.innerHeight });
    return { left: tl.x, right: br.x, top: tl.y, bottom: br.y };
  }
}
