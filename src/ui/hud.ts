import type { StatusMode } from '../render/statusOverlay';
import type { Tool } from '../game/controller';
import { progressionRequirements } from '../sim/progression';
import { PROGRESSION } from '../data/config';
import { formatTimeOfDay, formatTowerDate, population, topFloorIndex, type GameState } from '../sim';
import { TOOL_INFO } from './toolPalette';
import { blackoutActive, blackoutTicksLeft, hasLocation, historyEntries } from './simCompat';
import { chromeInsets, clampWindow, closeButton, escapeHtml, makeDraggable, readUiPref, writeUiPref } from './windowing';

const cash = (cents: number): string => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Menu commands main.ts provides (windows owned outside the HUD). */
export type HudCommand = 'new' | 'save' | 'load' | 'sound' | 'map' | 'events' | 'tips' | 'tutorial' | 'finances' | 'stats' | 'scenarios' | 'undo' | 'people';

type MenuItem =
  | { label: string; shortcut?: string; action: () => void; checked?: () => boolean; disabled?: () => boolean }
  | 'separator';

const SPEEDS: Array<[number, string, string, string]> = [
  [0, 'Ⅱ', 'Pause', 'Space'],
  [1, '▶', 'Normal speed', '1'],
  [2, '▶▶', 'Fast', '2'],
  [4, '▶▶▶', 'Fastest', '3'],
  [10, '▶▶▶▶', 'Ultra', '4'],
];
const VIEWS: Array<[StatusMode, string]> = [['none', 'Normal view'], ['stress', 'Stress view'], ['grade', 'Tenant grades'], ['population', 'Population view']];

/**
 * Legend swatches per overlay, matching src/render/statusOverlay.ts: stress is
 * a red wash up to 70% at mean day-stress 50; grades run red (1★) → amber (3★)
 * → green (5★) at 35%; population brightens from 15% to 55% white when full.
 */
const LEGENDS: Record<Exclude<StatusMode, 'none'>, { title: string; gradient: string; ground: string; labels: [string, string, string]; note: string }> = {
  stress: { title: 'Stress view', gradient: 'linear-gradient(90deg,#e0555500,#e05555b3)', ground: '#d9d4c4', labels: ['Calm', 'Tense', 'Stressed'], note: 'Average daily stress of the people in each room. Unshaded rooms are calm or empty.' },
  grade: { title: 'Tenant grades', gradient: 'linear-gradient(90deg,#e05555,#e0b000 50%,#22cc44)', ground: '#d9d4c4', labels: ['1★ unhappy', '3★', '5★ delighted'], note: 'The evaluation grade of each open room.' },
  population: { title: 'Population view', gradient: 'linear-gradient(90deg,#ffffff26,#ffffff8c)', ground: '#56656b', labels: ['Empty', 'Half', 'Full'], note: 'People inside compared with the capacity of each room.' },
};

function blocked(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    || document.querySelector('[role="dialog"][data-open="true"], dialog[open]') !== null;
}

/**
 * SimTower-style chrome: a menu bar, an info bar (rating, date and clock,
 * funds, population, messages, speed and view controls), a status bar, and
 * the floating Tower report window.
 */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  onSpeedChange: ((mult: number) => void) | null = null;
  /** Game window (New / Save / Load). */
  onOpenMenu: ((section?: 'new' | 'save' | 'load') => void) | null = null;
  onCamera: ((action: 'in' | 'out' | 'home') => void) | null = null;
  onCommand: ((command: HudCommand) => void) | null = null;
  /** Reports the guide's tips setting for the Help menu check mark. */
  tipsEnabled: (() => boolean) | null = null;
  /** Whether Game › Undo last build has anything to reverse. */
  canUndo: (() => boolean) | null = null;
  /** Move the camera to a located message (floor, cell). */
  onJump: ((floor: number, x: number) => void) | null = null;
  private mode: StatusMode = 'none';
  private speed = 1;
  private readonly nav = document.createElement('nav');
  private readonly rating = document.createElement('div');
  private readonly date = document.createElement('b');
  private readonly time = document.createElement('span');
  private readonly hourHand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  private readonly minuteHand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  private readonly funds = document.createElement('b');
  private readonly people = document.createElement('b');
  private readonly brief = document.createElement('div');
  private readonly overlaySelect = document.createElement('select');
  private readonly inspector = document.createElement('aside');
  private readonly reportBody = document.createElement('div');
  private readonly message = document.createElement('span');
  private readonly location = document.createElement('span');
  private readonly zoomLabel = document.createElement('span');
  private readonly toasts = document.createElement('div');
  private readonly blackout = document.createElement('div');
  private readonly legend = document.createElement('aside');
  private readonly logButton = document.createElement('button');
  private readonly log = document.createElement('div');
  private readonly logList = document.createElement('ol');
  private logKey = '';
  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private openMenuEl: { top: HTMLButtonElement; list: HTMLDivElement; items: MenuItem[] } | null = null;
  private lastUpdate = 0;
  private lastState: GameState | null = null;
  private lastBrief = '';
  private lastReport = '';
  private lastClock = -1;
  private readonly toastTimers = new Map<HTMLElement, number>();
  /** Latest event message, echoed in the info bar like the original. */
  private news: { text: string; at: number } | null = null;
  private reportPrefs = readUiPref<{ x: number | null; y: number | null }>('report', { x: null, y: null });

  constructor() {
    const header = document.createElement('header');
    header.className = 'game-header';
    header.innerHTML = '<div class="wordmark" aria-label="Upper Story"><span class="brand-mark" aria-hidden="true">▥</span>Upper Story</div>';
    this.nav.setAttribute('aria-label', 'Game menu');
    this.nav.setAttribute('role', 'menubar');
    this.nav.append(
      this.menu('Game', [
        { label: 'New tower…', action: () => this.onOpenMenu?.('new') },
        { label: 'Scenarios…', action: () => this.onCommand?.('scenarios') },
        { label: 'Save tower…', shortcut: 'Ctrl+S', action: () => this.onOpenMenu?.('save') },
        { label: 'Load tower…', shortcut: 'Ctrl+O', action: () => this.onOpenMenu?.('load') },
        'separator',
        { label: 'Undo last build', shortcut: 'Ctrl+Z', action: () => this.onCommand?.('undo'), disabled: () => !(this.canUndo?.() ?? false) },
        'separator',
        { label: 'Sound…', action: () => this.onCommand?.('sound') },
        'separator',
        { label: 'Explore a populated tower ↗', action: () => { window.open('?demo=1', '_blank', 'noopener'); } },
      ]),
      this.menu('View', [
        ...VIEWS.map(([mode, label]): MenuItem => ({ label, action: () => this.setMode(mode), checked: () => this.mode === mode })),
        'separator',
        { label: 'Zoom in', shortcut: '+', action: () => this.onCamera?.('in') },
        { label: 'Zoom out', shortcut: '−', action: () => this.onCamera?.('out') },
        { label: 'Center tower', shortcut: 'Home', action: () => this.onCamera?.('home') },
        'separator',
        { label: 'Tower map…', shortcut: 'M', action: () => this.onCommand?.('map') },
      ]),
      this.menu('Tower', [
        { label: 'Tower report', shortcut: 'R', action: () => this.toggleReport(), checked: () => !this.inspector.hidden },
        { label: 'Events & ratings…', shortcut: 'V', action: () => this.onCommand?.('events') },
        { label: 'Message log', shortcut: 'L', action: () => this.toggleLog(), checked: () => !this.log.hidden },
        { label: 'Finances & loans…', action: () => this.onCommand?.('finances') },
        { label: 'Statistics…', shortcut: 'G', action: () => this.onCommand?.('stats') },
        { label: 'People…', shortcut: 'P', action: () => this.onCommand?.('people') },
      ]),
      this.menu('Speed', SPEEDS.map(([mult, , label, key]): MenuItem => ({ label, shortcut: key, action: () => this.selectSpeed(mult), checked: () => this.speed === mult }))),
      this.menu('Help', [
        { label: 'How to play…', shortcut: 'F1', action: () => this.showHelp() },
        'separator',
        { label: 'Show guide (tutorial & tips)', action: () => this.onCommand?.('tips'), checked: () => this.tipsEnabled?.() ?? false },
        { label: 'Restart tutorial', action: () => this.onCommand?.('tutorial') },
      ]),
    );
    header.append(this.nav);

    // --- Info bar ---
    const strip = document.createElement('div');
    strip.className = 'status-strip';
    strip.setAttribute('role', 'region');
    strip.setAttribute('aria-label', 'Tower status');
    this.rating.className = 'info-rating';
    this.rating.title = 'Tower rating';
    const dateBox = document.createElement('div');
    dateBox.className = 'info-field info-date';
    const clock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    clock.setAttribute('viewBox', '0 0 24 24');
    clock.setAttribute('aria-hidden', 'true');
    clock.classList.add('info-clock');
    clock.innerHTML = '<circle cx="12" cy="12" r="10.5"/><path d="M12 2.5v2M21.5 12h-2M12 21.5v-2M2.5 12h2"/>';
    this.hourHand.setAttribute('class', 'hand-h');
    this.hourHand.setAttribute('d', 'M12 12 12 6.5');
    this.minuteHand.setAttribute('class', 'hand-m');
    this.minuteHand.setAttribute('d', 'M12 12 12 4');
    clock.append(this.hourHand, this.minuteHand);
    const dateText = document.createElement('div');
    this.date.className = 'date-label';
    this.time.className = 'time-label';
    dateText.append(this.date, this.time);
    dateBox.append(clock, dateText);
    const fundsBox = this.field('Funds', this.funds, 'info-funds');
    const peopleBox = this.field('Population', this.people, 'info-pop');
    this.brief.className = 'info-message';
    this.brief.setAttribute('aria-live', 'polite');
    this.brief.title = 'Click for the message log (L)';
    this.brief.addEventListener('click', () => this.toggleLog());
    const messages = document.createElement('div');
    messages.className = 'info-messages';
    this.logButton.type = 'button';
    this.logButton.className = 'log-toggle';
    this.logButton.textContent = 'Log ▾';
    this.logButton.title = 'Message log (L)';
    this.logButton.setAttribute('aria-label', 'Message log (L)');
    this.logButton.setAttribute('aria-expanded', 'false');
    this.logButton.setAttribute('aria-controls', 'message-log');
    this.logButton.onclick = () => this.toggleLog();
    messages.append(this.brief, this.logButton);
    this.blackout.className = 'info-alert';
    this.blackout.hidden = true;
    this.blackout.setAttribute('role', 'status');
    const control = document.createElement('div');
    control.className = 'simulation-controls';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Game speed');
    for (const [mult, glyph, label, key] of SPEEDS) {
      const button = this.button(glyph, () => this.selectSpeed(mult), `${label} (${key})`);
      button.setAttribute('aria-pressed', String(mult === 1));
      this.speedButtons.set(mult, button);
      control.append(button);
    }
    const view = document.createElement('div');
    view.className = 'view-controls';
    this.overlaySelect.setAttribute('aria-label', 'Tower overlay');
    this.overlaySelect.title = 'Status overlay';
    for (const [value, label] of VIEWS) this.overlaySelect.add(new Option(label, value));
    this.overlaySelect.onchange = () => this.setMode(this.overlaySelect.value as StatusMode);
    view.append(this.overlaySelect, this.button('−', () => this.onCamera?.('out'), 'Zoom out (−)'), this.button('+', () => this.onCamera?.('in'), 'Zoom in (+)'), this.button('⌂', () => this.onCamera?.('home'), 'Center tower (Home)'));
    strip.append(this.rating, dateBox, fundsBox, peopleBox, this.blackout, messages, control, view);

    // --- Message log (drops down from the message box; not modal) ---
    this.log.className = 'message-log ui-window';
    this.log.id = 'message-log';
    this.log.setAttribute('role', 'region');
    this.log.setAttribute('aria-label', 'Message log');
    this.log.hidden = true;
    const logTitle = document.createElement('div');
    logTitle.className = 'window-title';
    logTitle.innerHTML = '<span class="title-text">Messages</span>';
    logTitle.append(closeButton('Close message log', () => this.toggleLog(false)));
    this.logList.className = 'log-list';
    this.log.append(logTitle, this.logList);

    // --- Overlay legend ---
    this.legend.className = 'overlay-legend';
    this.legend.setAttribute('aria-label', 'Overlay legend');
    this.legend.hidden = true;

    // --- Tower report window ---
    this.inspector.className = 'tower-report ui-window';
    this.inspector.setAttribute('aria-label', 'Tower report');
    this.inspector.hidden = true;
    const reportTitle = document.createElement('div');
    reportTitle.className = 'window-title';
    reportTitle.innerHTML = '<span class="title-text">Tower report</span>';
    reportTitle.append(closeButton('Close tower report', () => this.toggleReport(false)));
    this.reportBody.className = 'window-body';
    this.inspector.append(reportTitle, this.reportBody);
    makeDraggable(this.inspector, reportTitle, 'fixed', (x, y) => { this.reportPrefs = { x, y }; writeUiPref('report', this.reportPrefs); });

    // --- Status bar ---
    const footer = document.createElement('footer');
    footer.className = 'game-footer';
    this.message.className = 'footer-message';
    this.message.textContent = 'Inspect a room to see how your tenants are doing.';
    this.location.className = 'pointer-location';
    this.zoomLabel.className = 'zoom-label';
    footer.append(this.message, this.location, this.zoomLabel);
    this.toasts.className = 'toast-stack';
    this.toasts.setAttribute('role', 'status');
    document.body.append(header, strip, this.inspector, this.log, this.legend, footer, this.toasts);

    window.addEventListener('pointerdown', e => {
      if (this.openMenuEl && !(e.target instanceof Node && this.nav.contains(e.target))) this.closeMenu();
      if (!this.log.hidden && e.target instanceof Node && !this.log.contains(e.target) && !messages.contains(e.target)) this.toggleLog(false);
    });
    window.addEventListener('resize', () => { this.closeMenu(); if (!this.inspector.hidden) this.placeReport(); });
    window.addEventListener('keydown', e => this.onKey(e));
  }

  get statusMode(): StatusMode { return this.mode; }
  get speedMultiplier(): number { return this.speed; }
  openMenu(): void { this.onOpenMenu?.(); }

  setContext(tool: Tool | null, hover: { floor: number; cell: number } | null, error: string | null, zoom: number): void {
    const text = error ?? TOOL_INFO[tool ?? 'select'].hint;
    if (this.message.textContent !== text) this.message.textContent = text;
    this.message.classList.toggle('error', error !== null);
    const where = hover ? `${hover.floor <= 0 ? 'B' + (1 - hover.floor) : 'Floor ' + hover.floor} · Cell ${hover.cell + 1}` : '';
    if (this.location.textContent !== where) this.location.textContent = where;
    const z = `${Math.round(zoom * 100)}%`;
    if (this.zoomLabel.textContent !== z) this.zoomLabel.textContent = z;
  }

  update(state: GameState): void {
    const now = performance.now();
    if (now - this.lastUpdate < 150 && this.lastState === state) return;
    this.lastUpdate = now; this.lastState = state;
    const pop = population(state);
    const gate = PROGRESSION.find(g => g.star > state.starLevel);
    const minute = state.calendar.minuteOfDay;
    setText(this.date, formatTowerDate(state.calendar.day));
    setText(this.time, formatTimeOfDay(minute));
    const clockMinute = Math.floor(minute);
    if (clockMinute !== this.lastClock) {
      this.lastClock = clockMinute;
      this.hourHand.setAttribute('transform', `rotate(${(clockMinute % 720) / 2} 12 12)`);
      this.minuteHand.setAttribute('transform', `rotate(${(clockMinute % 60) * 6} 12 12)`);
    }
    setText(this.funds, cash(state.money.balanceCents));
    this.funds.classList.toggle('negative', state.money.balanceCents < 0);
    setText(this.people, pop.toLocaleString('en-US'));
    const ratingHtml = state.starLevel >= 6
      ? '<span class="tower-badge">TOWER</span>'
      : `<span class="stars-on">${'★'.repeat(state.starLevel)}</span><span class="stars-off">${'★'.repeat(Math.max(0, 5 - state.starLevel))}</span>`;
    if (this.rating.innerHTML !== ratingHtml) {
      this.rating.innerHTML = ratingHtml;
      this.rating.setAttribute('aria-label', state.starLevel >= 6 ? 'Tower rating: TOWER' : `Tower rating: ${state.starLevel} of 5 stars`);
    }
    const dark = blackoutActive(state);
    this.blackout.hidden = !dark;
    if (dark) {
      const seconds = Math.ceil(blackoutTicksLeft(state) / 10);
      const text = `⚡ Blackout · ${seconds}s`;
      if (this.blackout.textContent !== text) this.blackout.textContent = text;
      this.blackout.title = 'Power is out: elevators stop and the lights go dark unless a backup generator runs. Time shown at 1× speed.';
    }
    if (!this.log.hidden) this.renderLog(state);
    const brief = this.briefFor(state, pop);
    if (brief !== this.lastBrief) { this.lastBrief = brief; this.brief.innerHTML = brief ? `<span class="clamp">${brief}</span>` : ''; }
    if (!this.inspector.hidden) {
      const tenants = [...state.tenants.values()];
      const waiting = Object.values(state.queues).reduce((n, q) => n + q.length, 0);
      const basements = Math.max(0, 1 - (state.tower.floors[0]?.index ?? 1));
      const net = state.money.quarterIncomeCents - state.money.quarterUpkeepCents;
      const html = `<div class="report-section"><small>Next milestone</small><h3>${gate ? (gate.star === 6 ? 'TOWER rating' : `${gate.star}-star rating`) : 'Top of the world'}</h3><progress max="${gate?.population ?? 1}" value="${gate ? Math.min(pop, gate.population) : 1}" aria-label="Population toward the next rating"></progress><p>${gate ? `${pop.toLocaleString('en-US')} / ${gate.population.toLocaleString('en-US')} people` : 'Maximum tower rating'}</p>${gate ? '<ul>' + progressionRequirements(state, gate.star).map(r => `<li class="${r.met ? 'met' : ''}">${r.met ? '✓' : '○'} ${escapeHtml(r.label)}</li>`).join('') + '</ul>' : ''}</div><dl><dt>Floors</dt><dd>${topFloorIndex(state.tower)}${basements ? ` + ${basements} basement${basements === 1 ? '' : 's'}` : ''}</dd><dt>Open facilities</dt><dd>${tenants.filter(t => t.state === 'open').length}</dd><dt>Under construction</dt><dd>${state.constructionQueue.length}</dd><dt>Vacant facilities</dt><dd>${tenants.filter(t => t.state === 'vacant').length}</dd><dt>Waiting for transport</dt><dd>${waiting}</dd></dl><div class="report-section"><small>This quarter</small><dl><dt>Income</dt><dd>${cash(state.money.quarterIncomeCents)}</dd><dt>Upkeep</dt><dd>${cash(state.money.quarterUpkeepCents)}</dd><dt>Net</dt><dd class="${net < 0 ? 'error' : ''}">${cash(net)}</dd></dl></div>`;
      // Rebuild only on change so text stays selectable and hover stays stable.
      if (html !== this.lastReport) { this.lastReport = html; this.reportBody.innerHTML = html; }
    }
  }

  /**
   * Short message above the status bar. 'error' marks a refused action and
   * 'hint' an explanation of the interface; neither is echoed in the info
   * bar, which keeps tower news. A repeat of a visible message bumps its
   * counter instead of stacking a copy.
   */
  toast(message: string, kind: 'info' | 'warn' | 'error' | 'hint' = 'info'): void {
    if (kind === 'info' || kind === 'warn') this.news = { text: message, at: performance.now() };
    let item = [...this.toasts.children].find((el): el is HTMLDivElement => el instanceof HTMLDivElement && el.dataset.text === message);
    if (item) {
      const count = Number(item.dataset.count ?? '1') + 1;
      item.dataset.count = String(count);
      item.textContent = `${message} (×${count})`;
      this.toasts.append(item);
    } else {
      item = document.createElement('div');
      item.dataset.text = message;
      item.className = kind === 'warn' || kind === 'error' ? `toast-${kind}` : '';
      item.textContent = message;
      this.toasts.append(item);
    }
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    const el = item;
    window.clearTimeout(this.toastTimers.get(el));
    this.toastTimers.set(el, window.setTimeout(() => { el.remove(); this.toastTimers.delete(el); }, kind === 'error' ? 3500 : 4500));
  }

  private briefFor(state: GameState, pop: number): string {
    const tenants = [...state.tenants.values()];
    const firstConstruction = tenants.find(t => t.state === 'constructing');
    // First-tower steps live in the guide (src/ui/guide.ts), which players can switch off.
    if (firstConstruction && pop === 0) return `<b>Under construction.</b> ${escapeHtml(TOOL_INFO[firstConstruction.type as Tool]?.label ?? 'Your first room')} opens in about ${Math.ceil(firstConstruction.constructionTicksLeft / 10)}s at normal speed.`;
    if (state.campaign.bankrupt) return '<b class="error">Tower in debt.</b> Cut upkeep or raise income before the bank steps in.';
    if (this.news && performance.now() - this.news.at < 30_000) return `<span class="news">${escapeHtml(this.news.text)}</span>`;
    return '';
  }

  private setMode(mode: StatusMode): void {
    this.mode = mode;
    this.overlaySelect.value = mode;
    this.legend.hidden = mode === 'none';
    if (mode === 'none') return;
    const l = LEGENDS[mode];
    this.legend.innerHTML = `<b>${escapeHtml(l.title)}</b><div class="legend-bar" style="background:${l.gradient},${l.ground}"></div>`
      + `<div class="legend-labels">${l.labels.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div><p>${escapeHtml(l.note)}</p>`;
  }

  /** Show or hide the message log under the info bar's message box. */
  toggleLog(show = this.log.hidden): void {
    this.log.hidden = !show;
    this.logButton.setAttribute('aria-expanded', String(show));
    this.logButton.textContent = show ? 'Log ▴' : 'Log ▾';
    if (!show) return;
    const box = this.brief.getBoundingClientRect();
    this.log.style.left = `${Math.round(Math.max(6, Math.min(box.left, window.innerWidth - 380)))}px`;
    this.log.style.top = `${Math.round(chromeInsets().top + 2)}px`;
    this.logKey = '';
    if (this.lastState) this.renderLog(this.lastState);
    this.logList.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  private renderLog(state: GameState): void {
    const entries = historyEntries(state);
    const key = `${entries.length}:${entries[0]?.day}:${entries[0]?.message}`;
    if (key === this.logKey) return;
    this.logKey = key;
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = 'No messages yet. Fires, VIP visits, ratings and other events appear here.';
      this.logList.replaceChildren(empty);
      return;
    }
    this.logList.replaceChildren(...entries.map(entry => {
      const item = document.createElement('li');
      const when = document.createElement('small');
      when.textContent = formatTowerDate(entry.day);
      const text = document.createElement('span');
      text.textContent = entry.message;
      if (hasLocation(entry)) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'log-jump';
        jump.title = `Show ${entry.floor <= 0 ? `B${1 - entry.floor}` : `floor ${entry.floor}`}`;
        const go = document.createElement('i');
        go.className = 'log-go';
        go.setAttribute('aria-hidden', 'true');
        go.textContent = '→';
        jump.append(when, text, go);
        jump.onclick = () => this.onJump?.(entry.floor, entry.x);
        item.append(jump);
      } else {
        item.append(when, text);
      }
      return item;
    }));
  }

  private selectSpeed(mult: number): void {
    this.speed = mult;
    for (const [id, button] of this.speedButtons) button.setAttribute('aria-pressed', String(id === mult));
    document.body.classList.toggle('paused', mult === 0);
    this.onSpeedChange?.(mult);
  }

  private toggleReport(show = this.inspector.hidden): void {
    this.inspector.hidden = !show;
    if (show) {
      this.placeReport();
      const state = this.lastState;
      this.lastUpdate = 0;
      if (state) this.update(state);
    }
  }

  private placeReport(): void {
    const { top } = chromeInsets();
    const width = this.inspector.offsetWidth || 280;
    const spot = clampWindow(this.inspector, this.reportPrefs.x ?? window.innerWidth - width - 12, this.reportPrefs.y ?? top + 10);
    this.inspector.style.left = `${spot.x}px`;
    this.inspector.style.top = `${spot.y}px`;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.openMenuEl) {
      this.menuKey(e);
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); if (!document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) this.showHelp(); return; }
    if (e.key === 'Escape' && !this.log.hidden && !document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) {
      e.preventDefault(); e.stopImmediatePropagation();
      this.toggleLog(false); this.logButton.focus();
      return;
    }
    if (blocked(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.onOpenMenu?.('save'); return; }
    if (ctrl && !e.altKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); this.onOpenMenu?.('load'); return; }
    if (ctrl || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); this.selectSpeed(this.speed === 0 ? 1 : 0); return; }
    const speed = { '1': 1, '2': 2, '3': 4, '4': 10 }[e.key];
    if (speed !== undefined) { this.selectSpeed(speed); return; }
    if (e.key === '+' || e.key === '=') { this.onCamera?.('in'); return; }
    if (e.key === '-' || e.key === '_') { this.onCamera?.('out'); return; }
    if (e.key === 'm' || e.key === 'M') { this.onCommand?.('map'); return; }
    if (e.key === 'v' || e.key === 'V') { this.onCommand?.('events'); return; }
    if (e.key === 'p' || e.key === 'P') { this.onCommand?.('people'); return; }
    if (e.key === 'l' || e.key === 'L') { this.toggleLog(); return; }
    if (e.key === 'r' || e.key === 'R') this.toggleReport();
  }

  // --- Menu bar ---

  private menu(label: string, items: MenuItem[]): HTMLButtonElement {
    const top = document.createElement('button');
    top.type = 'button';
    top.className = 'menu-top';
    top.textContent = label;
    top.setAttribute('role', 'menuitem');
    top.setAttribute('aria-haspopup', 'menu');
    top.setAttribute('aria-expanded', 'false');
    top.onclick = () => (this.openMenuEl?.top === top ? this.closeMenu() : this.showMenu(top, items));
    top.onpointerenter = () => { if (this.openMenuEl && this.openMenuEl.top !== top) this.showMenu(top, items); };
    top.onkeydown = e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showMenu(top, items, true); }
    };
    return top;
  }

  private showMenu(top: HTMLButtonElement, items: MenuItem[], focusFirst = false): void {
    this.closeMenu();
    const list = document.createElement('div');
    list.className = 'menu-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', top.textContent ?? '');
    for (const item of items) {
      if (item === 'separator') { const hr = document.createElement('div'); hr.className = 'menu-sep'; hr.setAttribute('role', 'separator'); list.append(hr); continue; }
      const entry = document.createElement('button');
      entry.type = 'button';
      const checked = item.checked?.();
      entry.setAttribute('role', item.checked ? 'menuitemcheckbox' : 'menuitem');
      if (item.checked) entry.setAttribute('aria-checked', String(Boolean(checked)));
      entry.disabled = item.disabled?.() ?? false;
      entry.innerHTML = `<span class="menu-check" aria-hidden="true">${checked ? '✓' : ''}</span><span class="menu-label"></span><span class="menu-key"></span>`;
      entry.querySelector('.menu-label')!.textContent = item.label;
      entry.querySelector('.menu-key')!.textContent = item.shortcut ?? '';
      entry.onclick = () => { this.closeMenu(); item.action(); };
      entry.onpointerenter = () => entry.focus({ preventScroll: true });
      list.append(entry);
    }
    const rect = top.getBoundingClientRect();
    list.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
    list.style.top = `${rect.bottom}px`;
    document.body.append(list);
    top.setAttribute('aria-expanded', 'true');
    top.classList.add('open');
    this.openMenuEl = { top, list, items };
    if (focusFirst) list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  private closeMenu(): void {
    if (!this.openMenuEl) return;
    this.openMenuEl.list.remove();
    this.openMenuEl.top.setAttribute('aria-expanded', 'false');
    this.openMenuEl.top.classList.remove('open');
    this.openMenuEl = null;
  }

  private menuKey(e: KeyboardEvent): void {
    const open = this.openMenuEl!;
    const entries = [...open.list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const tops = [...this.nav.querySelectorAll<HTMLButtonElement>(':scope > .menu-top')];
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      const top = open.top; this.closeMenu(); top.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopImmediatePropagation();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopImmediatePropagation();
      const next = tops[(tops.indexOf(open.top) + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length]!;
      next.click();
      this.openMenuEl?.list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    } else if (e.key === 'Tab') {
      this.closeMenu();
    } else {
      // Keep tool shortcuts from firing while a menu is open.
      e.stopImmediatePropagation();
    }
  }

  // --- Helpers ---

  private field(label: string, value: HTMLElement, cls: string): HTMLDivElement {
    const box = document.createElement('div');
    box.className = `info-field ${cls}`;
    const small = document.createElement('small'); small.textContent = label;
    box.append(small, value);
    return box;
  }

  private button(text: string, action: () => void, title?: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = action;
    if (title) { button.title = title; button.setAttribute('aria-label', title); }
    return button;
  }

  private showHelp(): void {
    const dialog = document.createElement('dialog'); dialog.className = 'help-window ui-dialog';
    dialog.setAttribute('aria-label', 'How to play');
    const title = document.createElement('div');
    title.className = 'window-title';
    title.innerHTML = '<span class="title-text">How to play</span>';
    title.append(closeButton('Close help', () => dialog.close()));
    const body = document.createElement('div');
    body.className = 'window-body';
    body.innerHTML = '<h2>Build a world above the street.</h2><p>Start by selecting Lobby and dragging along the ground. Extend from either edge for $5,000 per cell. Then add floors, elevators, and rooms.</p><ol><li><b>Build upward.</b> Select Floor and click above your tower.</li><li><b>Connect every floor.</b> Drag elevators vertically; standard and service shafts need four clear cells; express shafts need six.</li><li><b>Move tenants in.</b> Click to place one room, or hold and drag to build a row. Wait for construction to finish.</li><li><b>Keep them happy.</b> Inspect rooms, watch lift queues, and add services as your rating grows.</li></ol><h3>Keyboard</h3><dl class="key-list"><dt>I / F / E / O / C</dt><dd>Inspect / floor / elevator / office / condo</dd><dt>Space · 1 / 2 / 3 / 4</dt><dd>Pause · normal / fast / fastest / ultra</dd><dt>+ / − · Home</dt><dd>Zoom · center the tower</dd><dt>Right-drag / arrows · scroll</dt><dd>Pan (Shift+arrows: faster) · zoom</dd><dt>M · R · V · L · G · P</dt><dd>Tower map · tower report · events &amp; ratings · message log · statistics · people</dd><dt>Ctrl+Z</dt><dd>Undo the last build (refunded; within about a game hour, or while still under construction)</dd><dt>Ctrl+S / Ctrl+O</dt><dd>Save / load towers</dd><dt>F1</dt><dd>This help</dd><dt>Escape</dt><dd>Close window, stop following, then return to Inspect</dd></dl><p class="hint">With Inspect, click a person to see their card: rename them, follow them with the camera, or star them as a favourite.</p><p class="hint">Tip: drag the Construction palette by its title bar, or roll it up with ▾.</p>';
    const footer = document.createElement('div');
    footer.className = 'window-footer';
    footer.append(this.button('Back to my tower', () => dialog.close()));
    dialog.append(title, body, footer);
    makeDraggable(dialog, title, 'offset');
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog); dialog.showModal();
  }
}
