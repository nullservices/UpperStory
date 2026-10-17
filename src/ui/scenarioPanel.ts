import type { GameState } from '../sim';
import {
  SCENARIOS,
  getScenario,
  scenarioProgress,
  startScenario,
  type ObjectiveProgress,
  type ScenarioDef,
  type ScenarioOutcome,
} from '../sim/scenarios';
import { formatTowerDate } from '../sim/time';
import { chromeInsets, clampWindow, closeButton, makeDraggable, readUiPref, writeUiPref } from './windowing';

/** Per-browser record of each scenario's results. */
interface ScenarioRecord {
  attempts: number;
  wins: number;
  /** Fewest game days taken to win. */
  bestDays?: number;
}

interface ScenarioPrefs {
  records: Record<string, ScenarioRecord>;
  collapsed: boolean;
  x: number | null;
  y: number | null;
}

const DIFFICULTY_CLASS: Record<ScenarioDef['difficulty'], string> = { Easy: 'easy', Medium: 'medium', Hard: 'hard', Expert: 'expert' };

/** "$1.25M", "$350K", "-$40K". */
export function compactMoney(cents: number): string {
  const dollars = Math.round(cents / 100);
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs}`;
}

function starsText(n: number): string {
  return n >= 6 ? 'TOWER' : `${n}★`;
}

/** "120 / 150", "$0.8M / $1M", "2★ / 3★", "All repaired". */
export function objectiveText(o: ObjectiveProgress): string {
  switch (o.format) {
    case 'money': return `${compactMoney(o.value)} / ${compactMoney(o.target)}`;
    case 'stars': return `${starsText(o.value)} / ${starsText(o.target)}`;
    case 'floor': return `Floor ${o.value} / ${o.target}`;
    case 'done': return o.met ? 'Done' : 'Not yet';
    case 'count':
      if (o.kind === 'damaged') return o.value <= o.target ? 'All repaired' : `${o.value.toLocaleString('en-US')} still damaged`;
      return `${o.value.toLocaleString('en-US')} / ${o.target.toLocaleString('en-US')}`;
  }
}

function daysLabel(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, action: () => void, className?: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.onclick = action;
  return b;
}

/**
 * Scenarios: the chooser window (Game › Scenarios…), a small non-modal
 * objectives tracker while a scenario runs, and the win/lose results card.
 * Starting a scenario hands a fresh state to `onStart` (main.ts swaps it in
 * the same way as a new tower).
 */
export class ScenarioPanel {
  /** Swap in a freshly started scenario (set by main.ts). */
  onStart: ((state: GameState) => void) | null = null;

  private prefs = readUiPref<ScenarioPrefs>('scenarios', { records: {}, collapsed: false, x: null, y: null });
  private state: GameState | null = null;
  /** The state object last seen, and whether it already had an outcome then. */
  private watched: GameState | null = null;
  private sawOutcome = false;
  private lastRender = 0;
  private lastKey = '';

  private readonly chooser = el('dialog', 'ui-dialog scenario-window');
  private readonly list = el('div', 'scenario-list');
  private readonly detail = el('div', 'scenario-detail');
  private selected = SCENARIOS[0]!.id;
  private armed = false;
  private newBest = false;

  private readonly tracker = el('section', 'ui-window scenario-tracker');
  private readonly trackerTitle = el('span', 'title-text');
  private readonly trackerDays = el('small', 'scenario-days');
  private readonly trackerBody = el('div', 'scenario-tracker-body');
  private readonly collapseButton = el('button', 'window-btn scenario-collapse');

  private readonly result = el('dialog', 'ui-dialog scenario-result');

  constructor() {
    this.buildChooser();
    this.buildTracker();
    this.result.setAttribute('aria-label', 'Scenario result');
    document.body.append(this.chooser, this.tracker, this.result);
    window.addEventListener('resize', () => { if (!this.tracker.hidden) this.place(); });
  }

  /** Open the scenario chooser, showing the active scenario if there is one. */
  open(): void {
    const active = this.state?.scenario?.id;
    if (active && getScenario(active)) this.selected = active;
    this.armed = false;
    this.renderChooser();
    if (!this.chooser.open) this.chooser.showModal();
    this.list.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  }

  /** Called every frame. */
  update(state: GameState): void {
    this.state = state;
    if (state !== this.watched) {
      // A new tower (scenario start, load, new game): an outcome already in
      // the save was celebrated when it happened.
      this.watched = state;
      this.sawOutcome = state.scenario?.outcome !== undefined;
      this.lastKey = '';
      this.lastRender = 0;
      if (this.result.open) this.result.close();
    } else if (!this.sawOutcome && state.scenario?.outcome) {
      this.sawOutcome = true;
      this.record(state.scenario.id, state.scenario.outcome);
      this.showResult(state);
    }
    const now = performance.now();
    if (now - this.lastRender < 250) return;
    this.lastRender = now;
    this.renderTracker(state);
  }

  // --- Chooser ----------------------------------------------------------

  private buildChooser(): void {
    this.chooser.setAttribute('aria-label', 'Scenarios');
    const title = el('div', 'window-title');
    title.innerHTML = '<span class="title-text">Scenarios</span>';
    title.append(closeButton('Close scenarios', () => this.chooser.close()));
    const body = el('div', 'window-body scenario-chooser');
    const note = el('p', 'window-note', 'Challenges with goals, limits and a deadline. Your tower is paused while this window is open.');
    this.list.setAttribute('role', 'list');
    this.list.setAttribute('aria-label', 'Scenario list');
    const columns = el('div', 'scenario-columns');
    columns.append(this.list, this.detail);
    body.append(note, columns);
    this.chooser.append(title, body);
    makeDraggable(this.chooser, title, 'offset');
  }

  private renderChooser(): void {
    this.list.replaceChildren();
    for (const def of SCENARIOS) {
      const record = this.prefs.records[def.id];
      const item = button('', () => { this.selected = def.id; this.armed = false; this.renderChooser(); this.list.querySelector<HTMLButtonElement>(`button[data-id="${def.id}"]`)?.focus(); }, 'scenario-item');
      item.dataset.id = def.id;
      item.setAttribute('aria-pressed', String(def.id === this.selected));
      const head = el('span', 'scenario-item-head');
      head.append(el('b', undefined, def.title), el('span', `scenario-difficulty ${DIFFICULTY_CLASS[def.difficulty]}`, def.difficulty));
      const status = el('small', 'scenario-item-status', this.recordText(record));
      if (record?.wins) status.classList.add('won');
      if (this.state?.scenario?.id === def.id && !this.state.scenario.outcome) status.textContent = 'In progress';
      item.append(head, el('span', 'scenario-item-pitch', def.pitch), status);
      const wrap = el('div');
      wrap.setAttribute('role', 'listitem');
      wrap.append(item);
      this.list.append(wrap);
    }
    this.renderDetail();
  }

  private recordText(record: ScenarioRecord | undefined): string {
    if (!record || (!record.attempts && !record.wins)) return 'Not attempted';
    if (record.wins && record.bestDays !== undefined) return `✓ Best: won in ${daysLabel(record.bestDays)}`;
    return `${record.attempts} attempt${record.attempts === 1 ? '' : 's'}, not yet won`;
  }

  private renderDetail(): void {
    const def = getScenario(this.selected) ?? SCENARIOS[0]!;
    this.detail.replaceChildren();
    const heading = el('h2', undefined, def.title);
    const difficulty = el('span', `scenario-difficulty ${DIFFICULTY_CLASS[def.difficulty]}`, def.difficulty);
    heading.append(' ', difficulty);
    const briefing = el('p', 'scenario-briefing', def.briefing);
    const goals = el('h3', undefined, 'Goals');
    const goalList = el('ul', 'scenario-goal-list');
    for (const o of def.objectives) goalList.append(el('li', undefined, o.hold ? `${o.label} (when the others are met)` : o.label));
    const limits = el('h3', undefined, 'Limits');
    const limitList = el('ul', 'scenario-goal-list');
    for (const c of def.constraints) limitList.append(el('li', undefined, c));
    const record = this.prefs.records[def.id];
    const best = el('p', 'window-hint', `Your record on this browser: ${this.recordText(record).replace(/^✓ /, '')}.`);

    const active = this.state?.scenario;
    const running = active?.id === def.id && !active.outcome;
    const actions = el('div', 'scenario-actions');
    const start = button(this.armed ? 'Confirm start' : running ? 'Restart scenario' : 'Start scenario', () => this.start(def.id), 'default');
    if (this.armed) start.classList.add('armed');
    actions.append(start);
    if (running) actions.append(button('Return to tower', () => this.chooser.close()));
    const warning = el('p', 'settings-message');
    warning.setAttribute('role', 'status');
    if (this.armed) warning.textContent = 'Starting replaces the current tower. Save first from Game › Save tower if you want to keep it. Click again to start.';
    this.detail.append(heading, briefing, goals, goalList, limits, limitList, best, actions, warning);
  }

  private start(id: string): void {
    if (!this.armed) {
      this.armed = true;
      this.renderDetail();
      this.detail.querySelector<HTMLButtonElement>('.scenario-actions button.default')?.focus();
      return;
    }
    this.armed = false;
    this.begin(id);
    this.chooser.close();
  }

  private begin(id: string): void {
    const next = startScenario(id);
    const record = this.prefs.records[id] ?? { attempts: 0, wins: 0 };
    record.attempts++;
    this.prefs.records[id] = record;
    this.save();
    if (this.prefs.collapsed) { this.prefs.collapsed = false; this.save(); }
    this.onStart?.(next);
  }

  // --- Tracker ----------------------------------------------------------

  private buildTracker(): void {
    this.tracker.hidden = true;
    this.tracker.setAttribute('aria-label', 'Scenario goals');
    const bar = el('div', 'window-title');
    this.collapseButton.type = 'button';
    this.collapseButton.onclick = () => { this.prefs.collapsed = !this.prefs.collapsed; this.save(); this.lastKey = ''; if (this.state) this.renderTracker(this.state); };
    const briefing = el('button', 'window-btn scenario-open', 'i');
    briefing.type = 'button';
    briefing.title = 'Scenario briefing and other scenarios';
    briefing.setAttribute('aria-label', 'Scenario briefing and other scenarios');
    briefing.onclick = () => this.open();
    bar.append(this.trackerTitle, this.trackerDays, briefing, this.collapseButton);
    this.tracker.append(bar, this.trackerBody);
    makeDraggable(this.tracker, bar, 'fixed', (x, y) => { this.prefs.x = x; this.prefs.y = y; this.save(); });
  }

  private place(): void {
    const { top } = chromeInsets();
    const spot = clampWindow(this.tracker, this.prefs.x ?? 210, this.prefs.y ?? top + 10);
    this.tracker.style.left = `${spot.x}px`;
    this.tracker.style.top = `${spot.y}px`;
  }

  private renderTracker(state: GameState): void {
    const progress = scenarioProgress(state);
    if (!progress) {
      this.tracker.hidden = true;
      return;
    }
    const { def, objectives, daysLeft, outcome } = progress;
    const collapsed = this.prefs.collapsed;
    const key = JSON.stringify([def.id, collapsed, daysLeft, outcome?.result, objectives.map(o => [o.value, o.met, o.detail])]);
    const wasHidden = this.tracker.hidden;
    this.tracker.hidden = false;
    if (wasHidden) this.place();
    if (key === this.lastKey) return;
    this.lastKey = key;

    const done = objectives.filter(o => o.met).length;
    this.trackerTitle.textContent = def.title;
    this.trackerDays.textContent = outcome ? (outcome.result === 'won' ? 'Won' : 'Failed')
      : collapsed ? `${done}/${objectives.length} · ${daysLabel(daysLeft)} left` : `${daysLabel(daysLeft)} left`;
    this.trackerDays.classList.toggle('urgent', !outcome && daysLeft <= 2);
    this.collapseButton.textContent = collapsed ? '+' : '–';
    this.collapseButton.title = collapsed ? 'Show goals' : 'Hide goals';
    this.collapseButton.setAttribute('aria-label', collapsed ? 'Show scenario goals' : 'Hide scenario goals');
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
    this.tracker.classList.toggle('collapsed', collapsed);
    this.tracker.classList.toggle('won', outcome?.result === 'won');
    this.tracker.classList.toggle('lost', outcome?.result === 'lost');
    this.trackerBody.hidden = collapsed;
    if (collapsed) return;

    this.trackerBody.replaceChildren();
    if (outcome) {
      const banner = el('p', `scenario-banner ${outcome.result}`, outcome.result === 'won'
        ? `Complete in ${daysLabel(outcome.daysTaken)}. Keep building freely.`
        : `${outcome.reason} Keep building freely, or try again.`);
      this.trackerBody.append(banner);
    }
    const list = el('ul', 'scenario-objectives');
    for (const o of objectives) list.append(this.objectiveRow(o));
    this.trackerBody.append(list);
    if (!outcome) {
      const deadline = el('p', 'scenario-deadline', `Last day: ${formatTowerDate(state.scenario!.deadlineDay - 1)}`);
      this.trackerBody.append(deadline);
    } else {
      const actions = el('div', 'scenario-tracker-actions');
      actions.append(button('Try again', () => this.begin(def.id)), button('Scenarios…', () => this.open()));
      this.trackerBody.append(actions);
    }
  }

  private objectiveRow(o: ObjectiveProgress): HTMLLIElement {
    const item = el('li', o.met ? 'met' : undefined);
    const head = el('div', 'scenario-objective-head');
    head.append(el('span', 'scenario-check', o.met ? '✓' : '○'), el('span', 'scenario-objective-label', o.label), el('b', undefined, objectiveText(o)));
    const bar = el('div', 'scenario-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', o.label);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(o.fraction * 100)));
    const fill = el('span');
    fill.style.width = `${Math.round(o.fraction * 100)}%`;
    bar.append(fill);
    item.append(head, bar);
    if (o.detail && !o.met) item.append(el('small', 'scenario-objective-detail', o.detail));
    return item;
  }

  // --- Results ----------------------------------------------------------

  private record(id: string, outcome: ScenarioOutcome): void {
    const record = this.prefs.records[id] ?? { attempts: 1, wins: 0 };
    this.newBest = outcome.result === 'won' && record.bestDays !== undefined && outcome.daysTaken < record.bestDays;
    if (outcome.result === 'won') {
      record.wins++;
      record.bestDays = record.bestDays === undefined ? outcome.daysTaken : Math.min(record.bestDays, outcome.daysTaken);
    }
    this.prefs.records[id] = record;
    this.save();
  }

  private showResult(state: GameState): void {
    const progress = scenarioProgress(state);
    const outcome = state.scenario?.outcome;
    if (!progress || !outcome) return;
    const { def } = progress;
    const won = outcome.result === 'won';
    const record = this.prefs.records[def.id];
    this.result.replaceChildren();
    this.result.classList.toggle('won', won);
    this.result.classList.toggle('lost', !won);
    const title = el('div', 'window-title');
    title.innerHTML = `<span class="title-text">${won ? 'Scenario complete' : 'Scenario failed'}</span>`;
    title.append(closeButton('Keep playing', () => this.result.close()));
    const body = el('div', 'window-body');
    const headline = el('h2', 'scenario-result-headline', won ? `${def.title}: complete!` : `${def.title}: not this time`);
    const reason = el('p', 'scenario-result-reason', outcome.reason);
    const stats = el('dl', 'scenario-result-stats');
    const add = (label: string, value: string): void => { stats.append(el('dt', undefined, label), el('dd', undefined, value)); };
    add('Time taken', `${daysLabel(outcome.daysTaken)} of ${def.timeLimitDays}`);
    add('Population', outcome.population.toLocaleString('en-US'));
    add('Funds', compactMoney(outcome.fundsCents));
    add('Rating', starsText(outcome.stars));
    add('Top floor', String(outcome.topFloor));
    if (won && record?.bestDays !== undefined) add('Best on this browser', this.newBest ? `${daysLabel(record.bestDays)} (new best!)` : daysLabel(record.bestDays));
    const goals = el('ul', 'scenario-goal-list result');
    for (const o of progress.objectives) {
      const item = el('li', o.met ? 'met' : 'unmet', `${o.met ? '✓' : '✗'} ${o.label} — ${objectiveText(o)}`);
      goals.append(item);
    }
    body.append(headline, reason, stats, goals);
    const footer = el('div', 'window-footer');
    const keep = button('Keep playing', () => this.result.close(), won ? 'default' : undefined);
    const again = button('Try again', () => { this.result.close(); this.begin(def.id); }, won ? undefined : 'default');
    const others = button('Scenarios…', () => { this.result.close(); this.open(); });
    footer.append(others, again, keep);
    this.result.append(title, body, footer);
    this.result.showModal();
    (won ? keep : again).focus();
  }

  private save(): void {
    writeUiPref('scenarios', this.prefs);
  }
}
