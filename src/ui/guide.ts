import type { Tool } from '../game/controller';
import type { GameState, Tenant } from '../sim';
import { closeButton, readUiPref, writeUiPref } from './windowing';
import { TOOL_INFO } from './toolPalette';
import { blackoutActive, carOutOfService, loanBalanceCents } from './simCompat';

/**
 * The tower guide: a first-tower tutorial that points at the right tool and
 * ticks off as the player builds, then one-time tips at moments that matter
 * later. Everything is skippable and can be switched off (Help menu restores
 * it). Preferences are per browser, not per tower.
 *
 * The card is deliberately not a dialog: modal windows pause the simulation,
 * and the guide should never stop the game.
 */

interface GuidePrefs {
  tutorial: 'active' | 'done' | 'skipped';
  tips: boolean;
  seen: string[];
}

interface Step {
  title: string;
  body: string;
  tool?: Tool;
  /** Completed by the tower itself; manual steps advance with "Next". */
  done?: (state: GameState) => boolean;
}

interface Tip {
  id: string;
  title: string;
  body: string;
  tool?: Tool;
  /** `seen` holds moments the UI reported through Guide.trigger (e.g. a person card opened). */
  when: (state: GameState, moments: ReadonlySet<string>) => boolean;
}

const open = (state: GameState, type: Tenant['type']): Tenant[] =>
  [...state.tenants.values()].filter(t => t.type === type && t.state === 'open');

const STEPS: Step[] = [
  {
    title: 'Build your lobby',
    body: 'Select <b>Lobby</b> (highlighted) and drag along the ground, at least <b>16 cells</b> wide (the tip beside the cursor counts them) so an elevator and an office fit side by side above it. Each cell costs $5,000; drag from an edge to widen it later.',
    tool: 'lobby',
    // An elevator (4 cells) plus an office (9) must fit on the floor above.
    done: s => [...s.tenants.values()].some(t => t.type === 'lobby' && t.sizeCells >= 16),
  },
  {
    title: 'Add a floor',
    body: 'Select <b>Floor</b> and click the sky just above your lobby. New floors match the width of the floor below.',
    tool: 'buildFloor',
    done: s => s.tower.floors.some(f => f.index >= 2),
  },
  {
    title: 'Connect it with an elevator',
    body: 'Select <b>Elevator</b> and drag from the lobby up to your new floor, near one end so an office fits beside it. People cannot reach rooms that no elevator, stair or escalator serves.',
    tool: 'elevator',
    done: s => s.elevatorGroups.size > 0,
  },
  {
    title: 'Rent out an office',
    body: 'Select <b>Office</b> and click on the new floor beside the elevator. The room extends to the right of the cell you click. Offices pay rent and bring six workers every weekday.',
    tool: 'office',
    done: s => [...s.tenants.values()].some(t => t.type === 'office'),
  },
  {
    title: 'Speed up time',
    body: 'Construction takes a while. Use the <b>▶▶</b> buttons at the top right (or keys <b>1</b>–<b>3</b>) to run faster, and <b>Space</b> to pause.',
    done: s => [...s.tenants.values()].some(t => t.type === 'office' && t.state === 'open'),
  },
  {
    title: 'Keep tenants happy',
    body: 'Click any room with <b>Inspect</b> to see its occupancy, stress and grade. Long elevator waits, noise and high rent make tenants leave; red rooms are unhappy.',
    tool: 'select',
  },
  {
    title: 'Grow your tower',
    body: 'Condos sell once for a lump sum; offices pay rent each quarter. Reach <b>300 people</b> for your second star. Open <b>Help → How to play</b> (F1) any time.',
  },
];

const anyOpen = (state: GameState, type: Tenant['type']): boolean =>
  [...state.tenants.values()].some(t => t.type === type && t.state === 'open');

const TIPS: Tip[] = [
  {
    id: 'personCard', title: 'Getting to know people',
    body: 'Click the name to rename them (Enter saves). <b>Follow</b> keeps the camera on them; pan or press Esc to stop. Press <b>☆</b> to star a favourite and find them again in <b>Tower → People</b> (P).',
    when: (_s, moments) => moments.has('personCard'),
  },
  {
    id: 'favourite', title: 'A new favourite',
    body: 'Starred people wear a small gold star in the tower, and their home or office speaks in their name. <b>Tower → People</b> (P) lists your favourites, searches everyone by name and remembers who moved out.',
    when: (_s, moments) => moments.has('favourite'),
  },
  {
    id: 'star2', title: 'Two stars!',
    body: 'Hotels, housekeeping, security and service elevators are unlocked. Hotel rooms need housekeepers, and staff only ride <b>service</b> elevators.',
    // Only while the tower holds that rating: a loaded 5-star tower should not hear about two stars.
    tool: 'hotel', when: s => s.starLevel === 2,
  },
  {
    id: 'star3', title: 'Three stars!',
    body: 'Restaurants, shops, cinemas, party halls and more are unlocked. For tall towers, put <b>sky lobbies</b> on floors 15, 30, 45… and link them with <b>express</b> elevators.',
    tool: 'skyLobby', when: s => s.starLevel === 3,
  },
  {
    id: 'queues', title: 'Elevators are backing up',
    body: 'Dozens of people are waiting at one landing. Inspect the elevator to add cars or upgrade speed, or build another shaft. People give up when their patience runs out.',
    tool: 'select', when: s => Object.values(s.queues).some(q => q.length >= 30),
  },
  {
    id: 'unhappy', title: 'An unhappy tenant',
    body: 'Rooms shown in <b>red</b> are dissatisfied and may move out. Inspect them: long lift waits, nearby noise and high rent are the usual causes.',
    tool: 'select',
    when: s => [...s.tenants.values()].some(t => (t.type === 'office' || t.type === 'condo') && t.state === 'open' && t.grade <= 1),
  },
  {
    id: 'vacant', title: 'A room has gone vacant',
    body: 'Dark rooms have no tenant. New ones arrive once the room is reachable and conditions improve; a condo needs an elevator route to and from the lobby.',
    when: s => [...s.tenants.values()].some(t => (t.type === 'office' || t.type === 'condo') && t.state === 'vacant'),
  },
  {
    id: 'housekeeping', title: 'Hotel rooms are getting dirty',
    body: 'Guests leave dirty hotels. Build <b>Housekeeping</b> and connect it to the hotel floors with a <b>service elevator</b>.',
    tool: 'housekeeping',
    when: s => [...s.tenants.values()].some(t => (t.type === 'hotel' || t.type === 'hotelTwin' || t.type === 'hotelSuite') && t.state === 'open' && t.cleanliness < 50)
      && open(s, 'housekeeping').length === 0,
  },
  {
    id: 'fire', title: 'Fire!',
    body: 'Open <b>Events &amp; ratings</b> (key <b>V</b>) and choose: <b>send security</b> (free, but only guards who can reach the floor help, and they may fail) or <b>call the fire department</b> (paid, always succeeds). Unanswered fires spread to neighbouring rooms; a <b>Fire station</b> nearby makes rescue cheaper and stops the spread.',
    tool: 'fireStation', when: s => s.campaign.incidents.some(i => i.kind === 'fire'),
  },
  {
    id: 'breakdown', title: 'An elevator car broke down',
    body: 'A broken car stops where it is and takes no passengers. <b>Inspect</b> the elevator and press <b>Repair</b>, or build a <b>Maintenance</b> office that mechanics can reach by elevator: they repair cars and prevent most breakdowns.',
    tool: 'maintenance', when: s => [...s.elevatorGroups.values()].some(g => g.cars.some(carOutOfService)),
  },
  {
    id: 'blackout', title: 'Blackout!',
    body: 'The power is out: elevators stop between floors and the lights go dark until it returns. Storms make blackouts more likely. A <b>Generator</b> in the basement (three stars) keeps the tower running.',
    tool: 'generator', when: s => blackoutActive(s),
  },
  {
    id: 'bank', title: 'Your bank is open',
    body: 'With a bank in the tower you can borrow money: open <b>Tower → Finances &amp; loans</b>. Repay when income allows.',
    tool: 'bank', when: s => anyOpen(s, 'bank') || loanBalanceCents(s) > 0,
  },
  {
    id: 'roof', title: 'Building on the roof',
    body: 'A <b>Rooftop pool</b> goes on the roof. Residents and hotel guests swim there, and nearby condos and hotel rooms rate higher.',
    tool: 'rooftopPool', when: s => s.starLevel >= 3 && s.tenants.size > 25,
  },
  {
    id: 'helipad', title: 'A helipad is available',
    body: 'Build a <b>Helipad</b> on the roof: VIPs fly straight in, and medevac flights extend medical cover to the whole tower.',
    tool: 'helipad', when: s => s.starLevel >= 4,
  },
  {
    id: 'incident', title: 'Emergency!',
    body: 'Something needs your attention. Open <b>Events &amp; ratings</b> (key <b>V</b>) to respond before the deadline, or the room may be damaged.',
    when: s => s.campaign.incidents.some(i => i.kind !== 'vip'),
  },
  {
    id: 'vip', title: 'A VIP is visiting',
    body: 'A VIP is staying in a hotel suite. Keep it clean and the elevators moving: a favourable visit is required for four stars.',
    when: s => s.campaign.incidents.some(i => i.kind === 'vip'),
  },
  {
    id: 'funds', title: 'Funds are running low',
    body: 'Income arrives at the end of each day and rent quarterly. Slow construction for a while, or add offices and condos to raise income. With a <b>Bank</b> (three stars) you can also borrow from <b>Tower → Finances &amp; loans</b>.',
    when: s => s.money.balanceCents < 100_000_00 && s.tenants.size > 3,
  },
  {
    id: 'tall', title: 'Planning for height',
    body: 'Standard elevators span up to 30 floors. Sky lobbies (three stars) go on floors 15, 30, 45… so keep space there for express shafts.',
    when: s => (s.tower.floors.at(-1)?.index ?? 0) >= 12,
  },
];

/** Palette name for a "Select …" button ("Select Office"). */
function toolName(tool: Tool): string {
  return TOOL_INFO[tool].label;
}

export class Guide {
  /** Lets the guide select or highlight tools. */
  onSelectTool: ((tool: Tool) => void) | null = null;
  onHighlightTool: ((tool: Tool | null) => void) | null = null;
  /** The first-tower walkthrough makes no sense on the prebuilt demo towers. */
  tutorialAllowed = true;

  private prefs = readUiPref<GuidePrefs>('guide', { tutorial: 'active', tips: true, seen: [] });
  private readonly card = document.createElement('div');
  private readonly title = document.createElement('span');
  private readonly counter = document.createElement('small');
  private readonly body = document.createElement('p');
  private readonly actions = document.createElement('div');
  private step = 0;
  private tip: Tip | null = null;
  private lastCheck = 0;
  private shownKey = '';

  constructor() {
    this.card.className = 'ui-window guide-card';
    this.card.setAttribute('role', 'note');
    this.card.setAttribute('aria-live', 'polite');
    this.card.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'window-title';
    this.title.className = 'title-text';
    this.counter.className = 'guide-counter';
    bar.append(this.title, this.counter, closeButton('Close tip', () => this.dismiss()));
    this.body.className = 'guide-body';
    this.actions.className = 'guide-actions';
    this.card.append(bar, this.body, this.actions);
    document.body.append(this.card);
  }

  get tipsEnabled(): boolean {
    return this.prefs.tips;
  }

  setTips(enabled: boolean): void {
    this.prefs.tips = enabled;
    if (!enabled && this.prefs.tutorial === 'active') this.prefs.tutorial = 'skipped';
    this.save();
    this.hide();
  }

  restartTutorial(): void {
    this.prefs = { ...this.prefs, tutorial: 'active', tips: true };
    this.step = 0;
    this.save();
    this.lastCheck = 0;
  }

  /** UI moments reported this session (first person card, first star). */
  private readonly moments = new Set<string>();

  /** Report a one-off UI moment that may unlock a tip ('personCard', 'favourite'). */
  trigger(moment: string): void {
    if (this.moments.has(moment)) return;
    this.moments.add(moment);
    this.lastCheck = 0;
  }

  /** Called every frame; does real work a few times per second. */
  update(state: GameState): void {
    const now = performance.now();
    if (now - this.lastCheck < 400) return;
    this.lastCheck = now;
    if (!this.prefs.tips) return this.hide();

    if (this.prefs.tutorial === 'active' && this.tutorialAllowed) {
      // Rewind to an earlier step the tower no longer satisfies (a new tower
      // started mid-tutorial, a demolished elevator), then skip steps it
      // already completed (e.g. a loaded save).
      const reopened = STEPS.findIndex((s, i) => i < this.step && s.done !== undefined && !s.done(state));
      if (reopened >= 0) this.step = reopened;
      while (this.step < STEPS.length && STEPS[this.step]!.done?.(state)) this.step++;
      if (this.step >= STEPS.length) {
        this.prefs.tutorial = 'done';
        this.save();
      } else {
        const step = STEPS[this.step]!;
        return this.show(`step:${this.step}`, step, `${this.step + 1} of ${STEPS.length}`, () => [
          ...(step.done ? [] : [this.button(this.step === STEPS.length - 1 ? 'Finish' : 'Next', () => this.next(), true)]),
          ...(step.tool ? [this.button(`Select ${toolName(step.tool)}`, () => this.onSelectTool?.(step.tool!))] : []),
          this.button('Skip tutorial', () => { this.prefs.tutorial = 'skipped'; this.save(); this.hide(); }),
        ]);
      }
    }

    if (this.tip) return; // Keep the current tip until the player dismisses it.
    const next = TIPS.find(t => !this.prefs.seen.includes(t.id) && t.when(state, this.moments));
    if (!next) return this.hide();
    this.tip = next;
    this.show(`tip:${next.id}`, next, 'Tip', () => [
      this.button('Got it', () => this.dismiss(), true),
      ...(next.tool ? [this.button(`Select ${toolName(next.tool)}`, () => this.onSelectTool?.(next.tool!))] : []),
      this.button('Turn off tips', () => this.setTips(false)),
    ]);
  }

  private next(): void {
    this.step++;
    this.lastCheck = 0;
    this.shownKey = '';
  }

  private dismiss(): void {
    if (this.tip) {
      this.prefs.seen = [...this.prefs.seen, this.tip.id];
      this.tip = null;
    } else if (this.prefs.tutorial === 'active') {
      this.prefs.tutorial = 'skipped';
    }
    this.save();
    this.hide();
    this.lastCheck = 0;
  }

  private show(key: string, item: Step | Tip, counter: string, buttons: () => HTMLButtonElement[]): void {
    if (key === this.shownKey && !this.card.hidden) return;
    this.onHighlightTool?.(item.tool ?? null);
    this.shownKey = key;
    this.title.textContent = item.title;
    this.counter.textContent = counter;
    this.body.innerHTML = item.body;
    this.actions.replaceChildren(...buttons());
    this.card.hidden = false;
  }

  private hide(): void {
    if (this.card.hidden && !this.shownKey) return;
    this.card.hidden = true;
    this.shownKey = '';
    this.onHighlightTool?.(null);
  }

  private button(label: string, action: () => void, primary = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (primary) button.className = 'primary';
    button.onclick = action;
    return button;
  }

  private save(): void {
    writeUiPref('guide', this.prefs);
  }
}
