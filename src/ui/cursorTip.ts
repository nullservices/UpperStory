import type { ElevatorDrag, Tool } from '../game/controller';
import { placementCostDollars } from '../game/placementCost';
import type { ElevatorGroup, GameState, Tenant } from '../sim';
import { queueLength } from '../sim/queues';
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
}

export type HoverEntity = { kind: 'elevator'; group: ElevatorGroup } | { kind: 'tenant'; tenant: Tenant };

const HOVER_DELAY_MS = 450;
const dollars = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
export const floorName = (floor: number): string => (floor <= 0 ? `B${1 - floor}` : `Floor ${floor}`);

const GRADED = new Set<Tenant['type']>(['office', 'condo', 'hotel', 'hotelTwin', 'hotelSuite', 'fastfood', 'restaurant', 'shop']);
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
  return lines.join('');
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

  constructor() {
    this.el.className = 'cursor-tip';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    document.body.append(this.el);
  }

  update(state: GameState, src: CursorSource): void {
    const html = this.content(state, src);
    if (!html || !src.pointer) return this.hide();
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.el.innerHTML = html;
    }
    this.el.hidden = false;
    const box = this.el.getBoundingClientRect();
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
    if (tool === 'demolish') return src.hoverError ? `<span class="tip-error">${escapeHtml(src.hoverError)}</span>` : '';
    const stroke = src.stroke;
    if (stroke && src.pointerDown) {
      const total = `<span class="tip-total">${stroke.placed} built · ${dollars(stroke.spentCents / 100)}</span>`;
      return stroke.error ? `${total}<span class="tip-error">${escapeHtml(stroke.error)}</span>` : total;
    }
    if (src.hoverError) return `<span class="tip-error">${escapeHtml(src.hoverError)}</span>`;
    const cost = placementCostDollars(state, tool, hover, src.drag);
    if (cost === null) return '';
    const per = tool === 'lobby' ? ' <small>per cell � drag for more</small>' : '';
    const drag = src.drag ? `<small>${floorName(Math.min(src.drag.fromFloor, hover.floor))} – ${floorName(Math.max(src.drag.fromFloor, hover.floor))}</small>` : '';
    return `<span class="tip-price">${cost > 0 ? dollars(cost) : 'Free'}${per}</span>${drag}`;
  }

  private inspectContent(state: GameState, src: CursorSource): string {
    if (src.pointerDown) { this.hoverKey = ''; return ''; }
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
