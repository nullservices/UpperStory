import type { StatusMode } from '../render/statusOverlay';
import type { Tool } from '../game/controller';
import { progressionRequirements } from '../sim/progression';
import { PROGRESSION } from '../data/config';
import { formatTimeOfDay, population, topFloorIndex, type GameState } from '../sim';
import { TOOL_INFO } from './toolPalette';

const cash = (cents: number): string => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export class Hud {
  onSpeedChange: ((mult: number) => void) | null = null;
  onOpenMenu: (() => void) | null = null;
  onCamera: ((action: 'in' | 'out' | 'home') => void) | null = null;
  private mode: StatusMode = 'none';
  private speed = 1;
  private status = document.createElement('div');
  private brief = document.createElement('div');
  private inspector = document.createElement('aside');
  private message = document.createElement('span');
  private location = document.createElement('span');
  private toasts = document.createElement('div');
  private speedButtons = new Map<number, HTMLButtonElement>();
  private lastUpdate = 0;
  private lastState: GameState | null = null;
  constructor() {
    const header = document.createElement('header');
    header.className = 'game-header';
    header.innerHTML = '<div class="wordmark"><span class="brand-mark">▥</span> UPPER STORY <small>A VERTICAL WORLD</small></div>';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Game menu');
    nav.append(this.button('Game', () => this.openMenu()), this.button('Tower report', () => {
      this.inspector.hidden = !this.inspector.hidden;
    }), this.button('Help', () => this.showHelp()));
    header.append(nav);
    this.status.className = 'tower-status';
    const control = document.createElement('div');
    control.className = 'simulation-controls';
    control.innerHTML = '<span>TIME</span>';
    for (const [mult, label] of [[0, 'Ⅱ'], [1, '▶'], [2, '▶▶'], [4, '▶▶▶']] as const) {
      const button = this.button(label, () => this.selectSpeed(mult));
      button.title = mult === 0 ? 'Pause (Space)' : `Speed ${mult}×`;
      button.setAttribute('aria-label', mult === 0 ? 'Pause' : `Speed ${mult}×`);
      button.setAttribute('aria-pressed', String(mult === 1));
      this.speedButtons.set(mult, button);
      control.append(button);
    }
    const strip = document.createElement('div');
    strip.className = 'status-strip';
    strip.append(this.status, control);
    const view = document.createElement('div');
    view.className = 'view-controls';
    const overlay = document.createElement('select');
    overlay.setAttribute('aria-label', 'Tower overlay');
    for (const [value, label] of [['none','Normal view'],['stress','Stress view'],['grade','Tenant grades'],['population','Population view']]) {
      const option = document.createElement('option'); option.value = value!; option.textContent = label!; overlay.append(option);
    }
    overlay.onchange = () => { this.mode = overlay.value as StatusMode; };
    view.append(overlay, this.button('−', () => this.onCamera?.('out'), 'Zoom out'), this.button('+', () => this.onCamera?.('in'), 'Zoom in'), this.button('⌂', () => this.onCamera?.('home'), 'Center tower (Home)'));
    this.brief.className = 'build-brief';
    this.inspector.className = 'tower-report';
    this.inspector.hidden = true;
    const reportTitle = document.createElement('div');
    reportTitle.className = 'panel-title'; reportTitle.textContent = 'Tower management';
    reportTitle.append(this.button('×', () => { this.inspector.hidden = true; }, 'Close tower report'));
    this.inspector.append(reportTitle, document.createElement('div'));
    const footer = document.createElement('footer');
    footer.className = 'game-footer';
    this.message.textContent = 'Inspect a room to see how your tenants are doing.';
    this.location.className = 'pointer-location';
    footer.append(this.message, this.location);
    this.toasts.className = 'toast-stack';
    this.toasts.setAttribute('role', 'status');
    document.body.append(header, strip, view, this.brief, this.inspector, footer, this.toasts);
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) return;
      if (e.code === 'Space') { e.preventDefault(); this.selectSpeed(this.speed === 0 ? 1 : 0); }
    });
  }
  get statusMode(): StatusMode { return this.mode; }
  get speedMultiplier(): number { return this.speed; }
  openMenu(): void { this.onOpenMenu?.(); }
  setContext(tool: Tool | null, hover: { floor: number; cell: number } | null, error: string | null, zoom: number): void {
    this.message.textContent = error ?? TOOL_INFO[tool ?? 'select'].hint;
    this.message.classList.toggle('error', error !== null);
    this.location.textContent = `${hover ? `${hover.floor <= 0 ? 'B' + (1 - hover.floor) : 'F' + hover.floor} · Cell ${hover.cell + 1}   |   ` : ''}${Math.round(zoom * 100)}%`;
  }
  update(state: GameState): void {
    const now = performance.now();
    if (now - this.lastUpdate < 150 && this.lastState === state) return;
    this.lastUpdate = now; this.lastState = state;
    const pop = population(state);
    const gate = PROGRESSION.find(g => g.star > state.starLevel);
    this.status.innerHTML = `<div class="funds"><small>FUNDS</small><b>${cash(state.money.balanceCents)}</b></div><div><small>POPULATION</small><b>${pop.toLocaleString()}</b></div><div><small>RATING</small><b class="stars">${state.starLevel === 6 ? 'TOWER' : '★'.repeat(state.starLevel)}<span>${'☆'.repeat(Math.max(0, 5-state.starLevel))}</span></b></div><div class="clock"><small>DAY ${state.calendar.day}</small><b>${formatTimeOfDay(state.calendar.minuteOfDay)}</b></div>`;
    const firstConstruction = [...state.tenants.values()].find(t => t.state === 'constructing');
    const hasOffice = [...state.tenants.values()].some(t => t.type === 'office');
    this.brief.innerHTML = state.tower.floors.length <= 2
      ? '<b>Your first floor</b><span>Select Floor, then click the sky above your lobby.</span>'
      : !state.elevatorGroups.size ? '<b>Going up?</b><span>Drag an elevator from the lobby to the upper floors.</span>'
      : !hasOffice ? '<b>Open for business</b><span>Place offices upstairs. Keep the elevator column clear.</span>'
      : firstConstruction && pop === 0 ? `<b>Your first tenants are on their way.</b><span>Construction: ${Math.ceil(firstConstruction.constructionTicksLeft / 10)}s at 1×. Use the time controls to speed things up.</span>`
      : '<b>A little city, one floor at a time.</b><span>Build, connect, and watch your tower come alive.</span>';
    if (!this.inspector.hidden) {
      const tenants = [...state.tenants.values()];
      const waiting = Object.values(state.queues).reduce((n, q) => n + q.length, 0);
      this.inspector.lastElementChild!.innerHTML = `<div class="report-section"><small>THE NEXT MILESTONE</small><h3>${gate ? `${gate.star}-star tower` : 'Top of the world'}</h3><progress max="${gate?.population ?? 1}" value="${gate ? pop : 1}"></progress><p>${gate ? `${pop.toLocaleString()} / ${gate.population.toLocaleString()} people` : 'Maximum tower rating'}</p>${gate ? '<ul>' + progressionRequirements(state, gate.star).map(r => `<li>${r.met ? '✓' : '○'} ${r.label}</li>`).join('') + '</ul>' : ''}</div><dl><dt>Upper floors</dt><dd>${topFloorIndex(state.tower)}</dd><dt>Open facilities</dt><dd>${tenants.filter(t => t.state === 'open').length}</dd><dt>Under construction</dt><dd>${state.constructionQueue.length}</dd><dt>Vacant facilities</dt><dd>${tenants.filter(t => t.state === 'vacant').length}</dd><dt>Waiting for a lift</dt><dd>${waiting}</dd></dl><div class="report-section"><small>THIS QUARTER</small><dl><dt>Income</dt><dd>${cash(state.money.quarterIncomeCents)}</dd><dt>Upkeep</dt><dd>${cash(state.money.quarterUpkeepCents)}</dd><dt>Net</dt><dd>${cash(state.money.quarterIncomeCents - state.money.quarterUpkeepCents)}</dd></dl></div>`;
    }
  }
  toast(message: string): void {
    const item = document.createElement('div'); item.textContent = message;
    this.toasts.append(item);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => item.remove(), 4500);
  }
  private selectSpeed(mult: number): void {
    this.speed = mult;
    for (const [id, button] of this.speedButtons) button.setAttribute('aria-pressed', String(id === mult));
    this.onSpeedChange?.(mult);
  }
  private button(text: string, action: () => void, title?: string): HTMLButtonElement {
    const button = document.createElement('button'); button.textContent = text; button.onclick = action;
    if (title) { button.title = title; button.setAttribute('aria-label', title); }
    return button;
  }
  private showHelp(): void {
    const dialog = document.createElement('dialog'); dialog.className = 'help-window';
    dialog.setAttribute('aria-label', 'How to play');
    dialog.innerHTML = '<div class="panel-title">Welcome to Upper Story</div><h2>Build a world above the street.</h2><p>Your lobby is ready. Add floors, connect them with elevators, and give people places to work, live, and visit.</p><ol><li><b>Build upward.</b> Select Floor and click above your tower.</li><li><b>Connect every floor.</b> Drag elevators vertically; each needs two clear cells.</li><li><b>Move tenants in.</b> Click to place one room, or hold and drag to build a row. Wait for construction to finish.</li><li><b>Keep them happy.</b> Inspect rooms, watch lift queues, and add services as your rating grows.</li></ol><dl><dt>I / F / E / O / C</dt><dd>Inspect / floor / elevator / office / condo</dd><dt>Space</dt><dd>Pause or resume</dd><dt>Right-drag / scroll</dt><dd>Pan / zoom</dd><dt>Home / Escape</dt><dd>Center / cancel tool</dd></dl>';
    dialog.append(this.button('Back to my tower', () => dialog.close()));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog); dialog.showModal();
  }
}
