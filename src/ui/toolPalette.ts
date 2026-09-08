import { CONFIG, TENANT_DATA } from '../data/config';
import { floorCostDollars, topFloorIndex, type GameState } from '../sim';
import type { Tool } from '../game/controller';

export const TOOL_INFO: Record<Tool, { label: string; hint: string; icon: string }> = {
  select: { label: 'Inspect', hint: 'Click a room or elevator to inspect it. Shortcut: I.', icon: 'inspect' },
  buildFloor: { label: 'Floor', hint: 'Click above the tower to add its next floor. Shortcut: F.', icon: 'floor' },
  lobby: { label: 'Lobby', hint: 'The entrance connects your tower to the street.', icon: 'lobby' },
  demolish: { label: 'Bulldoze', hint: 'Click a room to remove it. Construction costs are not refunded.', icon: 'bulldoze' },
  office: { label: 'Office', hint: '12 cells · 6 workers. Connect to the lobby before the morning commute. Shortcut: O.', icon: 'office' },
  condo: { label: 'Condo', hint: '6 cells · 3 residents. Keep homes away from noisy food businesses. Shortcut: C.', icon: 'condo' },
  hotel: { label: 'Hotel', hint: '12 cells · 10 guests. Needs housekeeping and service elevator access.', icon: 'hotel' },
  fastfood: { label: 'Fast food', hint: '4 cells · 10 seats. Feed the lunchtime crowd.', icon: 'food' },
  restaurant: { label: 'Restaurant', hint: '12 cells · 24 seats. A destination for diners.', icon: 'restaurant' },
  shop: { label: 'Shop', hint: '8 cells · 6 shoppers. Place away from offices.', icon: 'shop' },
  elevator: { label: 'Elevator', hint: 'Drag vertically from the lobby to an upper floor. Reserve 2 empty cells. Shortcut: E.', icon: 'elevator' },
  serviceElevator: { label: 'Service lift', hint: 'Drag between floors. Dedicated transport for tower staff.', icon: 'service' },
  expressElevator: { label: 'Express lift', hint: 'Drag between floors. Express cars connect lobby and sky lobbies.', icon: 'express' },
  stairs: { label: 'Stairs', hint: 'Click an upper floor to connect it to the floor below.', icon: 'stairs' },
  escalatorUp: { label: 'Escalator ↑', hint: 'Place on a floor to carry people to the next floor up.', icon: 'up' },
  escalatorDown: { label: 'Escalator ↓', hint: 'Place on a floor to carry people down from the next floor.', icon: 'down' },
  skyLobby: { label: 'Sky lobby', hint: '3 cells. A transfer point for express elevators.', icon: 'lobby' },
  security: { label: 'Security', hint: '8 cells. Security staff patrol your building.', icon: 'security' },
  housekeeping: { label: 'Housekeeping', hint: '8 cells. Staff clean hotel rooms using service elevators.', icon: 'housekeeping' },
};

export function toolIcon(kind: string): string {
  const room = '<path fill="#ded8c1" d="M3 8h34v16H3z"/><path fill="#687a79" d="M3 23h34v3H3z"/>';
  const shapes: Record<string, string> = {
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
    housekeeping: '<path stroke="#867250" stroke-width="3" d="m26 3-12 18"/><path fill="#bea464" d="m9 15 11 6-5 8-13-5z"/>',
  };
  return `<svg viewBox="0 0 40 30" aria-hidden="true">${shapes[kind] ?? shapes.elevator}${kind === 'express' ? '<path d="m33 18 3-5-3 1 3-5" stroke="#a58145" fill="none" stroke-width="2"/>' : kind === 'service' ? '<path d="M3 11h4v9H3z" fill="#a18a64"/>' : ''}</svg>`;
}

export class ToolPalette {
  private buttons = new Map<Tool, HTMLButtonElement>();
  private active: Tool | null = 'select';
  private description = document.createElement('div');
  private lastStateKey = '';
  constructor(private readonly onSelect: (tool: Tool | null) => void) {
    const root = document.createElement('aside');
    root.className = 'tool-palette';
    root.setAttribute('aria-label', 'Construction tools');
    root.innerHTML = '<div class="panel-title">Construction</div>';
    const groups: Array<[string, Tool[]]> = [
      ['TOOLS', ['select', 'buildFloor', 'lobby', 'demolish']],
      ['TRANSPORT', ['elevator', 'stairs', 'escalatorUp', 'escalatorDown', 'serviceElevator', 'expressElevator']],
      ['ROOMS', ['office', 'condo', 'fastfood', 'hotel', 'restaurant', 'shop']],
      ['SERVICES', ['security', 'housekeeping', 'skyLobby']],
    ];
    const scroller = document.createElement('div');
    scroller.className = 'tool-scroll';
    for (const [label, tools] of groups) {
      const section = document.createElement('section');
      section.innerHTML = `<h2>${label}</h2>`;
      const grid = document.createElement('div');
      grid.className = 'tool-grid';
      for (const tool of tools) {
        const info = TOOL_INFO[tool];
        const button = document.createElement('button');
        button.innerHTML = `${toolIcon(info.icon)}<span>${tool === 'housekeeping' ? 'Cleaning' : info.label}</span><small></small>`;
        button.setAttribute('aria-label', info.label);
        button.title = info.hint;
        button.onclick = () => { this.setActive(tool); this.onSelect(tool); };
        button.onmouseenter = () => this.describe(tool);
        button.onmouseleave = () => this.describe(this.active);
        button.onfocus = () => this.describe(tool);
        button.onblur = () => this.describe(this.active);
        this.buttons.set(tool, button);
        grid.append(button);
      }
      section.append(grid);
      scroller.append(section);
    }
    this.description.className = 'tool-description';
    root.append(scroller, this.description);
    document.body.append(root);
    this.setActive('select');
  }
  setActive(tool: Tool | null): void {
    this.active = tool;
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === tool));
    this.describe(tool);
  }
  update(state: GameState): void {
    const key = `${state.starLevel}:${topFloorIndex(state.tower)}:${state.money.balanceCents}`;
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    for (const [tool, button] of this.buttons) {
      const data = tool in TENANT_DATA ? TENANT_DATA[tool as keyof typeof TENANT_DATA] : null;
      const required = data?.unlockedAtStar ?? 1;
      const locked = required > state.starLevel;
      const cost = data?.costDollars ?? (tool === 'buildFloor' ? floorCostDollars(topFloorIndex(state.tower) + 1) : tool === 'stairs' ? CONFIG.STAIR_COST_DOLLARS : tool.startsWith('escalator') ? CONFIG.ESCALATOR_COST_DOLLARS : null);
      button.disabled = locked;
      button.title = locked ? `${TOOL_INFO[tool].label} — unlocks at ${required} stars` : TOOL_INFO[tool].hint;
      button.querySelector('small')!.textContent = locked ? `${required}★` : cost !== null && cost > 0 ? `$${(cost / 1000).toLocaleString()}k` : tool.toLowerCase().includes('elevator') ? '$500/floor' : '';
      button.classList.toggle('unaffordable', cost !== null && cost * 100 > state.money.balanceCents);
      if (locked && this.active === tool) { this.setActive('select'); this.onSelect('select'); }
    }
  }
  private describe(tool: Tool | null): void {
    const info = TOOL_INFO[tool ?? 'select'];
    this.description.innerHTML = `<b>${info.label}</b><p>${info.hint}</p>`;
  }
}
