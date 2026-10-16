import { CONFIG, TENANT_DATA } from '../data/config';
import { floorCostDollars, topFloorIndex, type GameState } from '../sim';
import { isRowBuildTool } from '../game/buildStroke';
import type { Tool } from '../game/controller';
import { attachTooltip, chromeInsets, clampWindow, escapeHtml, makeDraggable, readUiPref, writeUiPref } from './windowing';

export const TOOL_INFO: Record<Tool, { label: string; hint: string; icon: string }> = {
  select: { label: 'Inspect', hint: 'Click a room or elevator to inspect it. Shortcut: I.', icon: 'inspect' },
  buildFloor: { label: 'Floor', hint: 'Click above the tower to add a floor matching the one below. Click beside an existing floor to extend it ($500 per cell); extend its support first. Shortcut: F.', icon: 'floor' },
  lobby: { label: 'Lobby', hint: 'Snaps to ground level. Choose any horizontal starting position, then drag. Extend an existing lobby from either edge.', icon: 'lobby' },
  demolish: { label: 'Bulldoze', hint: 'Click a room or transport to remove it. Trim empty floor edges from the top down; backfill basement edges from the bottom up. An interior click removes a completely empty top floor or deepest basement (B2–B9). No refunds.', icon: 'bulldoze' },
  office: { label: 'Office', hint: '9 cells · 6 workers. Connect to the lobby before the morning commute. Shortcut: O.', icon: 'office' },
  condo: { label: 'Condo', hint: '16 cells · 3 residents. Keep homes away from noisy food businesses. Shortcut: C.', icon: 'condo' },
  hotel: { label: 'Single hotel', hint: '4 cells · 1 guest. Needs housekeeping and service elevator access.', icon: 'hotel' },
  fastfood: { label: 'Fast food', hint: '16 cells · 35 seats. Feed the lunchtime crowd.', icon: 'food' },
  restaurant: { label: 'Restaurant', hint: '24 cells · 35 seats. A destination for diners.', icon: 'restaurant' },
  shop: { label: 'Shop', hint: '12 cells · 25 shoppers. Place away from offices.', icon: 'shop' },
  elevator: { label: 'Elevator', hint: 'Click the lobby to connect the floor above, or drag vertically. Drag an existing shaft into new floors to extend it. Shortcut: E.', icon: 'elevator' },
  serviceElevator: { label: 'Service lift', hint: 'Click or drag between floors. Drag an existing service shaft to extend it. Dedicated transport for staff.', icon: 'service' },
  expressElevator: { label: 'Express lift', hint: 'Click or drag between floors; drag an existing express shaft to extend it. Connects lobby and sky lobbies.', icon: 'express' },
  stairs: { label: 'Stairs', hint: '8 cells. Links two floors: click an upper floor to connect the floor below, or a basement to connect the floor above.', icon: 'stairs' },
  escalatorUp: { label: 'Escalator ↑', hint: '8 cells. Place on a floor to carry people to the next floor up. Operating cost: $5,000 per quarter.', icon: 'up' },
  escalatorDown: { label: 'Escalator ↓', hint: '8 cells. Place on a floor to carry people down from the next floor. Operating cost: $5,000 per quarter.', icon: 'down' },
  skyLobby: { label: 'Sky lobby', hint: '6 cells. A transfer point for express elevators.', icon: 'lobby' },
  security: { label: 'Security', hint: '16 cells. Security staff patrol your building. Operating cost: $20,000 per quarter.', icon: 'security' },
  housekeeping: { label: 'Housekeeping', hint: '15 cells. Six staff clean hotel rooms using service elevators. Operating cost: $10,000 per quarter.', icon: 'housekeeping' },
  buildBasement: { label: 'Basement', hint: 'Excavate the next basement matching the width above, down to B9. Click beside an existing basement to extend it ($500 per cell); expand the level above first.', icon: 'floor' },
  hotelTwin: { label: 'Twin hotel', hint: 'Two guests. Needs housekeeping and service elevator access.', icon: 'hotel' },
  hotelSuite: { label: 'Hotel suite', hint: 'Luxury accommodation for two. Suites attract VIP inspections.', icon: 'hotel' },
  partyHall: { label: 'Party hall', hint: 'Two floors tall. Evening events draw crowds; provide enough elevator capacity.', icon: 'party' },
  cinema: { label: 'Cinema', hint: 'Two floors tall. Change the film in the inspection window to keep audiences coming.', icon: 'cinema' },
  medical: { label: 'Medical', hint: 'A medical center supports tenant welfare and the four-star rating.', icon: 'medical' },
  parkingRamp: { label: 'Parking ramp', hint: 'Build in B1, then align ramps on deeper basements. Required for parking on each level. Operating cost: $10,000 per quarter.', icon: 'ramp' },
  parkingSpace: { label: 'Parking', hint: 'Basement parking. Requires a ramp on the same level and earns daily fees.', icon: 'parking' },
  recycling: { label: 'Recycling', hint: 'Two basement floors tall. Handles tower waste and is required for four stars. Operating cost: $50,000 per quarter.', icon: 'recycling' },
  metro: { label: 'Metro', hint: 'Three floors tall, starting in B9. Connect a passenger elevator to the entrance for five stars. Operating cost: $100,000 per quarter.', icon: 'metro' },
  cathedral: { label: 'Cathedral', hint: 'Four floors tall: build floors 97–100 and place on floor 97. Connect its entrance for the final wedding.', icon: 'cathedral' },
  fireStation: { label: 'Fire station', hint: '20 cells. Firefighters reach fires faster and stop them spreading. Operating cost: $30,000 per quarter.', icon: 'fire' },
  bank: { label: 'Bank', hint: '20 cells. Weekday customers pay fees, and a bank lets you take out loans.', icon: 'bank' },
  helipad: { label: 'Helipad', hint: '24 cells, on the roof. VIPs fly straight in, and medevac flights extend medical cover. Operating cost: $40,000 per quarter.', icon: 'helipad' },
  rooftopPool: { label: 'Rooftop pool', hint: '30 cells, on the roof. Residents and hotel guests swim here; nearby homes and rooms rate higher. Operating cost: $25,000 per quarter.', icon: 'pool' },
  maintenance: { label: 'Maintenance', hint: '12 cells. Mechanics service elevator cars so they break down less. Operating cost: $15,000 per quarter.', icon: 'wrench' },
  generator: { label: 'Generator', hint: '16 cells, basement. Keeps elevators and lights running in a blackout. Operating cost: $20,000 per quarter.', icon: 'generator' },
};


/** Single-key tool shortcuts (handled by the controller). */
export const TOOL_SHORTCUTS: Partial<Record<Tool, string>> = { select: 'I', buildFloor: 'F', elevator: 'E', office: 'O', condo: 'C' };

export function toolIcon(kind: string): string {
  const room = '<path fill="#ded8c1" d="M3 8h34v16H3z"/><path fill="#687a79" d="M3 23h34v3H3z"/>';
  const shapes: Record<string, string> = {
    medical: '<path fill="#d6e2d5" d="M4 5h32v22H4z"/><path fill="#a54b46" d="M17 8h6v5h5v6h-5v5h-6v-5h-5v-6h5z"/>',
    cinema: '<path fill="#4b5c61" d="M3 4h34v24H3z"/><path fill="#d9d5bc" d="M7 7h26v13H7z"/><path fill="#a66560" d="M6 23h28v4H6z"/>',
    party: '<path fill="#b0926a" d="M3 18h34v5H3z"/><path fill="#baaecb" d="m20 2 5 12H15z"/><circle cx="10" cy="8" r="4" fill="#c98466"/>',
    parking: '<path fill="#697f89" d="M3 13h34v11H3zM9 6h22l4 8H5z"/><path fill="#cde0dd" d="M11 8h18l2 5H9z"/><circle cx="9" cy="25" r="3"/><circle cx="31" cy="25" r="3"/>',
    ramp: '<path d="M3 25 37 5v5L3 30z" fill="#829080"/>',
    recycling: '<path d="m20 4 12 20H8z" fill="none" stroke="#718f6d" stroke-width="5"/>',
    metro: '<rect x="5" y="3" width="30" height="24" rx="7" fill="#627a7c"/><path d="M10 8h20v10H10z" fill="#bad5cf"/><circle cx="12" cy="23" r="2" fill="#ead49b"/><circle cx="28" cy="23" r="2" fill="#ead49b"/>',
    cathedral: '<path d="M5 28V15l8-5 7-8 7 8 8 5v13z" fill="#baaa87"/><path d="M17 28V17h6v11z" fill="#6b817d"/>',
    inspect: '<circle cx="17" cy="12" r="8" fill="#d9eff0" stroke="#43666a" stroke-width="3"/><path d="m23 18 9 9" stroke="#46544d" stroke-width="5"/>',
    floor: '<path d="M3 19h34v5H3z" fill="#7b9293"/><path d="M5 5v13m10-13v13m10-13v13m10-13v13" stroke="#9caeaa" stroke-width="2"/><path d="M2 17h36" stroke="#eef4e7" stroke-width="3"/>',
    lobby: room + '<path fill="#86b9bf" d="M6 10h8v12H6zm11 0h7v12h-7zm10 0h7v12h-7z"/><path fill="#b9a46a" d="M2 5h36v4H2z"/>',
    bulldoze: '<path fill="#bd8e3f" d="M6 15h23v9H6zM11 6h12v10H11z"/><path fill="#bce0dc" d="M14 8h6v6h-6z"/><path fill="#535e55" d="M4 23h27v4H4zm28-12h4v16h-4z"/>',
    office: room + '<path fill="#8dc2c9" d="M6 10h10v6H6zm17 0h10v6H23z"/><path fill="#97724e" d="M5 19h13v3H5zm17 0h13v3H22z"/><path fill="#354e56" d="M9 15h5v4H9zm17 0h5v4H26z"/>',
    condo: room + '<path fill="#ad7a66" d="M5 17h16v6H5z"/><path fill="#c4d8d1" d="M24 10h9v9h-9z"/><path fill="#8c7955" d="M24 20h10v2H24z"/>',
    hotel: room + '<path fill="#9b88ac" d="M5 16h30v7H5z"/><path fill="#f8f4e6" d="M6 14h9v6H6z"/><path fill="#b89658" d="M31 9h3v7h-3z"/>',
    food: '<path fill="#c3854b" d="M7 11q13-14 26 0zM7 21h26v5H7z"/><path stroke="#56845a" stroke-width="4" d="M6 14h28"/><path stroke="#8f5946" stroke-width="4" d="M7 19h26"/>',
    restaurant: '<path stroke="#718b85" stroke-width="2" d="M8 4v21M4 4v8h8V4m17 0v21"/><circle cx="21" cy="15" r="8" fill="#e8e6d8" stroke="#b8a270" stroke-width="3"/>',
    shop: room + '<path fill="#a55e53" d="M2 6h36v6H2z"/><path stroke="#e3c999" stroke-width="4" d="M6 6v6m8-6v6m8-6v6m8-6v6"/><path fill="#90bbb7" d="M7 15h14v6H7zm18-1h8v9h-8z"/>',
    elevator: '<path fill="#637777" d="M9 2h23v26H9z"/><path fill="#b9ccca" d="M12 9h17v16H12z"/><path stroke="#647b7c" d="M20 9v16"/><path fill="#ead69a" d="m16 6 4-3 4 3z"/>',
    stairs: '<path d="M5 25h7v-6h7v-6h7V7h9" fill="none" stroke="#667d7a" stroke-width="5"/>',
    up: '<path d="M4 24h8L29 7h7" fill="none" stroke="#859b8c" stroke-width="6"/><path d="m5 15 16-12m-7 0h7v7" fill="none" stroke="#405e55" stroke-width="2"/>',
    down: '<path d="M4 24h8L29 7h7" fill="none" stroke="#859b8c" stroke-width="6"/><path d="m22 14-16 12m0-7v7h7" fill="none" stroke="#405e55" stroke-width="2"/>',
    security: '<path fill="#66878b" d="m20 2 13 5-2 13-11 8L9 20 7 7z"/><path fill="#e6d59d" d="m20 8 2 5 6 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1z"/>',
    fire: '<path fill="#c8553d" d="M20 2c2 6 11 9 11 17a11 10 0 0 1-22 0c0-5 4-8 5-12 2 3 3 5 3 7 2-4 1-8 3-12z"/><path fill="#ecc06a" d="M20 13c2 3 6 5 6 9a6 5 0 0 1-12 0c0-3 4-5 6-9z"/>',
    wrench: '<path fill="#6f8285" d="M29 2a8 8 0 0 0-8 10L6 23a3.5 3.5 0 0 0 5 5l11-15a8 8 0 0 0 11-8l-5 3-4-1-1-4z"/><circle cx="8.6" cy="25.4" r="1.4" fill="#d8e0dc"/>',
    generator: '<rect x="4" y="8" width="32" height="19" rx="2" fill="#6c7f7a"/><path fill="#e7c55a" d="M23 9 13 20h6l-3 7 10-12h-6z"/><circle cx="9" cy="13" r="2" fill="#c9d4cf"/><path stroke="#4c5c58" stroke-width="2" d="M7 4v4m26-4v4"/>',
    bank: '<path fill="#c7bd9c" d="M3 11 20 3l17 8z"/><path fill="#a99c76" d="M4 11h32v3H4zM3 24h34v4H3z"/><path fill="#e2dbc3" d="M6 14h4v10H6zm8 0h4v10h-4zm8 0h4v10h-4zm8 0h4v10h-4z"/>',
    pool: '<path fill="#79bccb" d="M3 14h34v13H3z"/><path d="M5 19q4-3 8 0t8 0 8 0 8 0" stroke="#e8f6f6" stroke-width="2" fill="none"/><path d="M26 3v13m7-13v13M26 7h7m-7 4h7" stroke="#8a9a98" stroke-width="2"/>',
    helipad: '<circle cx="20" cy="15" r="13" fill="#5c6b6d"/><circle cx="20" cy="15" r="10" fill="none" stroke="#e7d38f" stroke-width="1.5"/><path d="M15 9v12m10-12v12M15 15h10" stroke="#fff" stroke-width="3"/>',
    housekeeping: '<path stroke="#867250" stroke-width="3" d="m26 3-12 18"/><path fill="#bea464" d="m9 15 11 6-5 8-13-5z"/>',
  };
  return `<svg viewBox="0 0 40 30" aria-hidden="true">${shapes[kind] ?? shapes.elevator}${kind === 'express' ? '<path d="m33 18 3-5-3 1 3-5" stroke="#a58145" fill="none" stroke-width="2"/>' : kind === 'service' ? '<path d="M3 11h4v9H3z" fill="#a18a64"/>' : ''}</svg>`;
}


const GROUPS: Array<[string, Tool[]]> = [
  ['Tools', ['select', 'buildFloor', 'buildBasement', 'lobby', 'demolish']],
  ['Transport', ['elevator', 'stairs', 'escalatorUp', 'escalatorDown', 'serviceElevator', 'expressElevator', 'helipad']],
  ['Rooms', ['office', 'condo', 'fastfood', 'hotel', 'hotelTwin', 'hotelSuite', 'restaurant', 'shop', 'bank', 'partyHall', 'cinema', 'rooftopPool']],
  ['Services', ['security', 'fireStation', 'housekeeping', 'maintenance', 'medical', 'skyLobby', 'parkingRamp', 'parkingSpace', 'recycling', 'generator', 'metro', 'cathedral']],
];

const dollars = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** Star rating a tool needs before it can be used. */
export function toolUnlockStar(tool: Tool): number {
  const data = tool in TENANT_DATA ? TENANT_DATA[tool as keyof typeof TENANT_DATA] : null;
  return data?.unlockedAtStar ?? (tool === 'serviceElevator' ? 2 : tool === 'expressElevator' ? 3 : 1);
}

/** Up-front price in dollars for the next placement, or null when free / variable. */
export function toolCostDollars(state: GameState, tool: Tool): number | null {
  const data = tool in TENANT_DATA ? TENANT_DATA[tool as keyof typeof TENANT_DATA] : null;
  if (data) return data.costDollars;
  switch (tool) {
    case 'buildBasement': return floorCostDollars(state.tower.floors[0]!.index - 1);
    case 'buildFloor': return floorCostDollars(topFloorIndex(state.tower) + 1);
    case 'stairs': return CONFIG.STAIR_COST_DOLLARS;
    case 'escalatorUp': case 'escalatorDown': return CONFIG.ESCALATOR_COST_DOLLARS;
    case 'elevator': return CONFIG.ELEVATOR_PRICES.standard.shaft;
    case 'serviceElevator': return CONFIG.ELEVATOR_PRICES.service.shaft;
    case 'expressElevator': return CONFIG.ELEVATOR_PRICES.express.shaft;
    default: return null;
  }
}

function costLine(tool: Tool, cost: number | null): string {
  const car = tool === 'elevator' ? CONFIG.ELEVATOR_PRICES.standard.car
    : tool === 'serviceElevator' ? CONFIG.ELEVATOR_PRICES.service.car
      : tool === 'expressElevator' ? CONFIG.ELEVATOR_PRICES.express.car : null;
  if (car !== null && cost !== null) return `${dollars(cost)} shaft · ${dollars(car)} per car`;
  if (tool === 'buildFloor' || tool === 'buildBasement') return cost !== null ? `${dollars(cost)} next level · $500 per extra cell` : '';
  if (tool === 'lobby') return `${dollars(cost ?? 5000)} per cell`;
  return cost !== null && cost > 0 ? dollars(cost) : tool === 'demolish' ? 'No refunds' : '';
}

const stars = (n: number): string => '★'.repeat(n);

interface PalettePrefs { x: number | null; y: number | null; collapsed: boolean }

/**
 * Floating construction palette in the original's style: a small window with
 * a title bar (drag to move, button to roll it up) and a grid of icon tools.
 * Name, price, unlock rating and usage live in the hover tooltip.
 */
export class ToolPalette {
  private readonly root = document.createElement('aside');
  private readonly titleTool = document.createElement('span');
  private readonly collapseButton: HTMLButtonElement;
  private readonly caption = document.createElement('div');
  private buttons = new Map<Tool, HTMLButtonElement>();
  private active: Tool | null = 'select';
  private lastStateKey = '';
  private state: GameState | null = null;
  private prefs = readUiPref<PalettePrefs>('palette', { x: null, y: null, collapsed: false });

  constructor(private readonly onSelect: (tool: Tool | null) => void) {
    const root = this.root;
    root.className = 'tool-palette ui-window';
    root.setAttribute('aria-label', 'Construction tools');
    const title = document.createElement('div');
    title.className = 'window-title';
    const titleText = document.createElement('span');
    titleText.className = 'title-text';
    titleText.textContent = 'Construction';
    this.titleTool.className = 'title-tool';
    this.collapseButton = document.createElement('button');
    this.collapseButton.type = 'button';
    this.collapseButton.className = 'window-btn';
    this.collapseButton.onclick = () => this.setCollapsed(!this.prefs.collapsed);
    title.append(titleText, this.titleTool, this.collapseButton);
    title.addEventListener('dblclick', e => { if (!(e.target instanceof HTMLButtonElement)) this.setCollapsed(!this.prefs.collapsed); });

    const body = document.createElement('div');
    body.className = 'palette-body';
    body.id = 'tool-palette-body';
    this.collapseButton.setAttribute('aria-controls', body.id);
    for (const [label, tools] of GROUPS) {
      const section = document.createElement('section');
      section.setAttribute('aria-label', label);
      const heading = document.createElement('h2');
      heading.textContent = label;
      const grid = document.createElement('div');
      grid.className = 'tool-grid';
      for (const tool of tools) {
        const info = TOOL_INFO[tool];
        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = `${toolIcon(info.icon)}<small class="tool-badge"></small>`;
        button.setAttribute('aria-label', info.label);
        button.onclick = () => { this.setActive(tool); this.onSelect(tool); };
        attachTooltip(button, () => this.tooltip(tool));
        this.buttons.set(tool, button);
        grid.append(button);
      }
      section.append(heading, grid);
      body.append(section);
    }
    this.caption.className = 'tool-caption';
    this.caption.setAttribute('aria-live', 'polite');
    body.append(this.caption);
    root.append(title, body);
    document.body.append(root);

    makeDraggable(root, title, 'fixed', (x, y) => { this.prefs = { ...this.prefs, x, y }; writeUiPref('palette', this.prefs); });
    this.setCollapsed(this.prefs.collapsed, false);
    this.place();
    window.addEventListener('resize', () => this.place());
    this.setActive('select');
  }

  /** Pulse one tool's button (the guide's pointer); null clears it. */
  highlight(tool: Tool | null): void {
    for (const [id, button] of this.buttons) button.classList.toggle('guide-pulse', id === tool);
    if (tool && this.prefs.collapsed) this.setCollapsed(false, true);
  }

  setActive(tool: Tool | null): void {
    this.active = tool;
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === tool));
    this.describe();
  }

  update(state: GameState): void {
    this.state = state;
    const key = `${state.starLevel}:${topFloorIndex(state.tower)}:${state.tower.floors[0]?.index}:${state.money.balanceCents}`;
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    for (const [tool, button] of this.buttons) {
      const required = toolUnlockStar(tool);
      const locked = required > state.starLevel;
      const cost = toolCostDollars(state, tool);
      button.disabled = locked;
      button.querySelector('small')!.textContent = locked ? `${required}★` : '';
      button.classList.toggle('locked', locked);
      button.classList.toggle('unaffordable', !locked && cost !== null && cost * 100 > state.money.balanceCents);
      if (locked && this.active === tool) { this.setActive('select'); this.onSelect('select'); }
    }
    this.describe();
  }

  private tooltip(tool: Tool): string {
    const info = TOOL_INFO[tool];
    const state = this.state;
    const required = toolUnlockStar(tool);
    const cost = state ? toolCostDollars(state, tool) : null;
    const price = costLine(tool, cost);
    const locked = state ? required > state.starLevel : false;
    const short = cost !== null && state !== null && cost * 100 > state.money.balanceCents;
    return `<b>${escapeHtml(info.label)}</b>`
      + (price ? `<span class="tip-cost${short && !locked ? ' tip-warn' : ''}">${escapeHtml(price)}${short && !locked ? ' · not enough funds' : ''}</span>` : '')
      + `<span class="tip-unlock${locked ? ' tip-warn' : ''}">${locked ? `Locked · unlocks at ${stars(required)}` : required > 1 ? `Unlocked at ${stars(required)}` : 'Available from the start'}</span>`
      + `<p>${escapeHtml(info.hint)}${isRowBuildTool(tool) ? ' Hold and drag to build a row.' : ''}</p>`;
  }

  private describe(): void {
    const tool = this.active ?? 'select';
    const info = TOOL_INFO[tool];
    const cost = this.state ? toolCostDollars(this.state, tool) : null;
    const key = TOOL_SHORTCUTS[tool];
    const price = costLine(tool, cost);
    this.caption.innerHTML = '<small class="caption-label">Selected tool</small>'
      + `<div class="caption-row">${toolIcon(info.icon)}<b>${escapeHtml(info.label)}</b>${key ? `<kbd title="Shortcut key">${key}</kbd>` : ''}</div>`
      + `<span class="caption-cost">${escapeHtml(price || (tool === 'select' ? 'Hover a room for details; click to inspect' : 'No charge'))}</span>`;
    this.caption.setAttribute('aria-label', `Selected tool: ${info.label}${key ? `, shortcut ${key}` : ''}${price ? `, ${price}` : ''}`);
    this.titleTool.textContent = this.prefs.collapsed ? `· ${info.label}` : '';
  }

  private setCollapsed(collapsed: boolean, persist = true): void {
    this.prefs = { ...this.prefs, collapsed };
    this.root.classList.toggle('collapsed', collapsed);
    this.collapseButton.textContent = collapsed ? '▸' : '▾';
    const label = collapsed ? 'Expand construction palette' : 'Collapse construction palette';
    this.collapseButton.title = label;
    this.collapseButton.setAttribute('aria-label', label);
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
    this.describe();
    if (persist) writeUiPref('palette', this.prefs);
    this.place();
  }

  /** Restore the remembered spot (or the default) and keep it on screen. */
  private place(): void {
    const { top } = chromeInsets();
    const spot = clampWindow(this.root, this.prefs.x ?? 10, this.prefs.y ?? top + 10);
    this.root.style.left = `${spot.x}px`;
    this.root.style.top = `${spot.y}px`;
  }
}
