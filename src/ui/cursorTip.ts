import type { ElevatorDrag, Tool } from '../game/controller';
import { placementCostDollars } from '../game/placementCost';
import type { ElevatorGroup, GameState, Tenant } from '../sim';
import type { Voice } from '../sim/complaints';
import { queueLength } from '../sim/queues';
import { tenantVoices } from '../sim/complaints';
import { carOutOfService } from './simCompat';
import { TOOL_INFO } from './toolPalette';
import { escapeHtml } from './windowing';

/** The live input the tip reads each frame (the Controller satisfies it). */
export interface CursorSource {
  tool: Tool | null;
  hover: { floor: number; cell: number } | null;
  hoverError: string | null;
  pointer: { x: number; y: number } | null;
  pointerDown: boolean;
  readonly drag: ElevatorDrag | null;
  readonly stroke: { placed: number; spentCents: number; error: string | null } | null;
  entityAt(floor: number, cell: number): HoverEntity | null;
  /** What Bulldoze would remove at a cell ("Office on floor 2"), if anything. */
  demolishTarget?(floor: number, cell: number): string | null;
  /** Name of the person under the pointer (Inspect picks people first), if any. */
  personAt?(): string | null;
}

export type HoverEntity = { kind: 'elevator'; group: ElevatorGroup } | { kind: 'tenant'; tenant: Tenant };

const HOVER_DELAY_MS = 450;
const dollars = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
export const floorName = (floor: number): string => (floor <= 0 ? `B${1 - floor}` : `Floor ${floor}`);

const GRADED = new Set<Tenant['type']>(['office', 'condo', 'apartment', 'hotel', 'hotelTwin', 'hotelSuite', 'fastfood', 'restaurant', 'shop',
  'gym', 'supermarket', 'bar', 'conference', 'observationDeck']);
const HOTELS = new Set<Tenant['type']>(['hotel', 'hotelTwin', 'hotelSuite']);

/** Compact tooltip markup for a room or elevator under the Inspect cursor. */
export function describeEntity(state: GameState, entity: HoverEntity): string {
  if (entity.kind === 'elevator') {
    const g = entity.group;
    let waiting = 0;
    for (const floor of g.stops) waiting += queueLength(state, floor, 'up', g.id) + queueLength(state, floor, 'down', g.id);
    const broken = g.cars.filter(carOutOfService).length;
    const kind = g.kind === 'service' ? 'Service elevator' : g.kind === 'express' ? 'Express elevator' : 'Elevator';
    const span = `${floorName(g.serviceLo)} – ${floorName(g.serviceHi)}`.replace(/Floor (\d+) – Floor/, 'Floors $1 –');
    return `<b>${kind}</b><span>${escapeHtml(span)}</span>`
      + `<span>${g.cars.length} car${g.cars.length === 1 ? '' : 's'}${broken ? ` · <em class="tip-warn">${broken} out of service</em>` : ''}</span>`
      + `<span class="${waiting >= 30 ? 'tip-warn' : ''}">${waiting} waiting</span>`;
  }
  const t = entity.tenant;
  const label = TOOL_INFO[t.type]?.label ?? t.type;
  const status = t.state === 'constructing'
    ? `Under construction · ${Math.ceil(t.constructionTicksLeft / 10)}s at 1×`
    : t.state === 'vacant' ? (t.type === 'condo' ? 'For sale' : 'Vacant')
      : t.state === 'damaged' ? 'Damaged' : t.type === 'condo' && t.sold ? 'Sold · occupied' : 'Open';
  const lines = [`<b>${escapeHtml(label)}</b>`, `<span>${floorName(t.floor)}</span>`,
    `<span class="${t.state === 'damaged' || t.state === 'vacant' ? 'tip-warn' : ''}">${escapeHtml(status)}</span>`];
  if (t.state === 'open') {
    if (GRADED.has(t.type)) lines.push(`<span class="tip-grade" aria-label="Grade ${t.grade} of 5">${'★'.repeat(Math.round(t.grade))}<i>${'★'.repeat(Math.max(0, 5 - Math.round(t.grade)))}</i></span>`);
    if (t.capacity > 0 && t.type !== 'lobby') lines.push(`<span>${t.occupancy} / ${t.capacity} inside</span>`);
    if (HOTELS.has(t.type)) lines.push(`<span class="${t.cleanliness < 50 ? 'tip-warn' : ''}">Clean ${Math.round(t.cleanliness)}%</span>`);
  }
  const voice = topVoice(state, t);
  if (voice) lines.push(`<span class="tip-voice voice-${voice.tone}">“${escapeHtml(voice.text)}”</span>`);
  return lines.join('');
}

/** The room's most important voice, cached briefly: the tip repaints every frame. */
let voiceCache: { state: GameState | null; key: string; voice: Voice | null } = { state: null, key: '', voice: null };
function topVoice(state: GameState, tenant: Tenant): Voice | null {
  const key = `${tenant.id}:${tenant.state}:${tenant.pricing}:${Math.floor(state.tickCount / 50)}`;
  if (voiceCache.state !== state || voiceCache.key !== key) voiceCache = { state, key, voice: tenantVoices(state, tenant)[0] ?? null };
  return voiceCache.voice;
}

/**
 * The tip that follows the pointer over the tower: price (or the reason a
 * placement fails) for build tools, a running total while dragging a row,
 * and a delayed room/elevator summary under Inspect. Purely visual (the
 * status bar carries the same text for assistive tech), never a dialog.
 */
export class CursorTip {
  private readonly el = document.createElement('div');
  private hoverKey = '';
  private hoverSince = 0;
  private lastHtml = '';
  /** Size of the tip for lastHtml, measured once per content change. */
  private size = { width: 0, height: 0 };

  constructor() {
    this.el.className = 'cursor-tip';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    document.body.append(this.el);
  }

  update(state: GameState, src: CursorSource): void {
    const html = this.content(state, src);
    if (!html || !src.pointer) return this.hide();
    const wasHidden = this.el.hidden;
    this.el.hidden = false;
    if (html !== this.lastHtml || wasHidden) {
      if (html !== this.lastHtml) this.el.innerHTML = html;
      this.lastHtml = html;
      // Measure only when the content changes, not every frame.
      const rect = this.el.getBoundingClientRect();
      this.size = { width: rect.width, height: rect.height };
    }
    const box = this.size;
    let x = src.pointer.x + 18;
    let y = src.pointer.y + 20;
    if (x + box.width > window.innerWidth - 6) x = src.pointer.x - box.width - 12;
    if (y + box.height > window.innerHeight - 30) y = src.pointer.y - box.height - 12;
    this.el.style.transform = `translate(${Math.round(Math.max(4, x))}px, ${Math.round(Math.max(4, y))}px)`;
  }

  private content(state: GameState, src: CursorSource): string {
    const { tool, hover, pointer } = src;
    if (!tool || !hover || !pointer || document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) {
      this.hoverKey = '';
      return '';
    }
    if (tool === 'select') return this.inspectContent(state, src);
    this.hoverKey = '';
    if (tool === 'demolish') {
      if (src.hoverError) return `<span class="tip-error">${escapeHtml(src.hoverError)}</span>`;
      const target = src.demolishTarget?.(hover.floor, hover.cell);
      return target ? `<span class="tip-error">Remove ${escapeHtml(target)}</span><small>No refund</small>` : '';
    }
    const stroke = src.stroke;
    if (stroke && src.pointerDown) {
      const count = tool === 'lobby' ? `${stroke.placed} cell${stroke.placed === 1 ? '' : 's'}` : `${stroke.placed} built`;
      const total = `<span class="tip-total">${count} · ${dollars(stroke.spentCents / 100)}</span>`;
      return stroke.error ? `${total}<span class="tip-error">${escapeHtml(stroke.error)}</span>` : total;
    }
    if (src.hoverError) return `<span class="tip-error">${escapeHtml(src.hoverError)}</span>`;
    const cost = placementCostDollars(state, tool, hover, src.drag);
    if (cost === null) return '';
    // Pointing at an existing shaft (nothing dragged yet) costs nothing: say how to extend it.
    const shaftTool = tool === 'elevator' || tool === 'serviceElevator' || tool === 'expressElevator';
    if (shaftTool && cost === 0) return src.drag ? '<span class="tip-total">No new floors</span>' : '<small>Drag up or down to extend this shaft</small>';
    const per = tool === 'lobby' ? ' <small>per cell · drag for more</small>' : '';
    const drag = src.drag ? `<small>${floorName(Math.min(src.drag.fromFloor, hover.floor))} – ${floorName(Math.max(src.drag.fromFloor, hover.floor))}</small>` : '';
    return `<span class="tip-price">${cost > 0 ? dollars(cost) : 'Free'}${per}</span>${drag}`;
  }

  private inspectContent(state: GameState, src: CursorSource): string {
    if (src.pointerDown) { this.hoverKey = ''; return ''; }
    const person = src.personAt?.();
    if (person) {
      const key = `p${person}`;
      const now = performance.now();
      if (key !== this.hoverKey) { this.hoverKey = key; this.hoverSince = now; }
      if (now - this.hoverSince < HOVER_DELAY_MS / 2) return '';
      return `<div class="tip-card"><b>${escapeHtml(person)}</b><small>Click to see what they're up to</small></div>`;
    }
    const entity = src.entityAt(src.hover!.floor, src.hover!.cell);
    const key = entity ? (entity.kind === 'elevator' ? `g${entity.group.id}` : `t${entity.tenant.id}`) : '';
    const now = performance.now();
    if (key !== this.hoverKey) { this.hoverKey = key; this.hoverSince = now; }
    if (!entity || now - this.hoverSince < HOVER_DELAY_MS) return '';
    return `<div class="tip-card">${describeEntity(state, entity)}</div>`;
  }

  private hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.lastHtml = '';
    this.el.innerHTML = '';
  }
}
