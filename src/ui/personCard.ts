import { PERSON_NAME_MAX, isFavorite, personName } from '../sim/personNotes';
import type { GameState } from '../sim/state';
import { homeSpot, personActivity, personRole, stressMood } from './personInfo';
import { chromeInsets, clampWindow, closeButton, makeDraggable, raiseWindow } from './windowing';

/** What the person card and People window can ask main to do. */
export interface PersonActions {
  /** Rename (blank = back to the generated name); returns the name shown, or throws. */
  rename(id: number, name: string): string;
  setFavorite(id: number, favorite: boolean): void;
  /** Follow someone with the camera (null stops). */
  follow(id: number | null): void;
  following(): number | null;
  /** Centre the view on a grid spot. */
  jump(floor: number, x: number): void;
  /** Centre the view on wherever the person is right now. */
  jumpToPerson(id: number): void;
  /** Open (or move) the person card for someone. */
  inspect(id: number): void;
}

/** Refresh interval for live person text (a few times a second). */
const REFRESH_MS = 250;

/**
 * Person card: a small floating window about one person (name editable in
 * place, role, live activity, stress, today's trips). Non-modal (a section,
 * never a dialog) so the tower keeps running while you watch them.
 */
export class PersonCard {
  private readonly root = document.createElement('section');
  private readonly titleText = document.createElement('span');
  private readonly nameInput = document.createElement('input');
  private readonly role = document.createElement('p');
  private readonly activity = document.createElement('p');
  private readonly meterFill = document.createElement('span');
  private readonly moodLabel = document.createElement('span');
  private readonly trips = document.createElement('p');
  private readonly gone = document.createElement('p');
  private readonly error = document.createElement('p');
  private readonly followButton = document.createElement('button');
  private readonly starButton = document.createElement('button');
  private readonly homeButton = document.createElement('button');
  private personId = -1;
  private state: GameState | null = null;
  private lastRefresh = 0;
  /** Fires the first time a card opens (guide tip). */
  onOpen: (() => void) | null = null;

  constructor(private readonly actions: PersonActions) {
    const root = this.root;
    root.className = 'person-card ui-window';
    root.setAttribute('aria-label', 'Person');
    root.tabIndex = -1;
    root.hidden = true;
    const title = document.createElement('div');
    title.className = 'window-title';
    this.titleText.className = 'title-text';
    this.titleText.textContent = 'Person';
    title.append(this.titleText, closeButton('Close person card', () => this.close()));

    const body = document.createElement('div');
    body.className = 'window-body';
    const nameRow = document.createElement('div');
    nameRow.className = 'person-name-row';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = PERSON_NAME_MAX;
    this.nameInput.className = 'person-name';
    this.nameInput.setAttribute('aria-label', 'Name (Enter to save)');
    this.nameInput.title = 'Click to rename · Enter to save';
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.commitName(); this.nameInput.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.resetName(); this.nameInput.blur(); }
    });
    this.nameInput.addEventListener('blur', () => this.commitName());
    this.starButton.type = 'button';
    this.starButton.className = 'person-star';
    this.starButton.onclick = () => this.toggleStar();
    nameRow.append(this.nameInput, this.starButton);

    this.role.className = 'person-role';
    this.activity.className = 'person-activity';
    this.activity.setAttribute('aria-live', 'polite');
    const meter = document.createElement('div');
    meter.className = 'person-stress';
    const bar = document.createElement('span');
    bar.className = 'person-meter';
    bar.append(this.meterFill);
    const label = document.createElement('small');
    label.textContent = 'Stress';
    meter.append(label, bar, this.moodLabel);
    this.trips.className = 'person-trips';
    this.gone.className = 'person-gone';
    this.gone.hidden = true;
    this.error.className = 'error person-error';
    this.error.hidden = true;

    const buttons = document.createElement('div');
    buttons.className = 'person-buttons';
    for (const b of [this.followButton, this.homeButton]) b.type = 'button';
    this.followButton.onclick = () => {
      const following = this.actions.following() === this.personId;
      this.actions.follow(following ? null : this.personId);
      this.refresh(true);
    };
    this.homeButton.onclick = () => {
      const person = this.state?.people.get(this.personId);
      const spot = person && this.state ? homeSpot(this.state, person) : null;
      if (spot) this.actions.jump(spot.floor, spot.x);
    };
    buttons.append(this.followButton, this.homeButton);
    body.append(nameRow, this.role, this.activity, meter, this.trips, this.gone, this.error, buttons);
    root.append(title, body);
    document.body.append(root);
    makeDraggable(root, title, 'fixed');
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && e.target !== this.nameInput) { e.stopPropagation(); this.close(); }
    });
  }

  get openId(): number { return this.root.hidden ? -1 : this.personId; }

  /** Show `id`'s card beside a screen point (client px) or where it was. */
  open(state: GameState, id: number, anchor?: { x: number; y: number }): void {
    const wasHidden = this.root.hidden;
    this.state = state;
    if (id !== this.personId) this.nameInput.blur();
    this.personId = id;
    this.error.hidden = true;
    this.root.hidden = false;
    raiseWindow(this.root);
    this.refresh(true);
    if (anchor) this.placeBeside(anchor.x, anchor.y);
    else if (wasHidden) this.placeBeside(window.innerWidth / 2, window.innerHeight / 3);
    this.onOpen?.();
  }

  close(): void {
    if (this.root.hidden) return;
    this.nameInput.blur();
    this.root.hidden = true;
    this.personId = -1;
  }

  /** Per frame; repaints a few times a second while open. */
  update(state: GameState): void {
    if (this.root.hidden) return;
    if (state !== this.state) { this.close(); return; }
    this.refresh(false);
  }

  private refresh(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const state = this.state;
    if (!state) return;
    const person = state.people.get(this.personId);
    const name = personName(state, this.personId);
    setText(this.titleText, name);
    if (document.activeElement !== this.nameInput && this.nameInput.value !== name) this.nameInput.value = name;
    const star = isFavorite(state, this.personId);
    setText(this.starButton, star ? '★' : '☆');
    this.starButton.classList.toggle('on', star);
    const starLabel = star ? 'Unstar (remove from favourites)' : 'Star as a favourite';
    if (this.starButton.title !== starLabel) { this.starButton.title = starLabel; this.starButton.setAttribute('aria-label', starLabel); }
    if (!person) {
      this.gone.hidden = false;
      setText(this.gone, `${name} has left the tower.`);
      setText(this.activity, 'No longer in the tower');
      this.nameInput.disabled = true;
      this.followButton.disabled = this.homeButton.disabled = this.starButton.disabled = true;
      setText(this.followButton, 'Follow');
      return;
    }
    this.gone.hidden = true;
    this.nameInput.disabled = false;
    this.followButton.disabled = this.starButton.disabled = false;
    setText(this.role, personRole(state, person));
    setText(this.activity, personActivity(state, person));
    const mood = stressMood(person);
    this.meterFill.style.width = `${Math.round(Math.max(0.03, mood.level) * 100)}%`;
    this.meterFill.className = `mood-${mood.mood}`;
    setText(this.moodLabel, `${Math.round(person.stress)} · ${mood.label}`);
    const trips = person.tripsToday ?? 0, giveUps = person.giveUpsToday ?? 0;
    setText(this.trips, `Today: ${trips} trip${trips === 1 ? '' : 's'} · ${giveUps} gave up`);
    const following = this.actions.following() === this.personId;
    setText(this.followButton, following ? 'Stop following' : 'Follow');
    this.followButton.classList.toggle('default', !following);
    const spot = homeSpot(state, person);
    this.homeButton.hidden = !spot;
    this.homeButton.disabled = !spot;
    if (spot) setText(this.homeButton, spot.label);
  }

  private commitName(): void {
    const state = this.state;
    if (!state || this.root.hidden || !state.people.has(this.personId)) return;
    const typed = this.nameInput.value;
    if (typed === personName(state, this.personId)) return;
    try {
      this.nameInput.value = this.actions.rename(this.personId, typed);
      this.error.hidden = true;
    } catch (err) {
      this.error.hidden = false;
      this.error.textContent = err instanceof Error ? err.message : String(err);
    }
    this.refresh(true);
  }

  private resetName(): void {
    if (this.state) this.nameInput.value = personName(this.state, this.personId);
  }

  private toggleStar(): void {
    const state = this.state;
    if (!state) return;
    try {
      this.actions.setFavorite(this.personId, !isFavorite(state, this.personId));
    } catch (err) {
      this.error.hidden = false;
      this.error.textContent = err instanceof Error ? err.message : String(err);
    }
    this.refresh(true);
  }

  private placeBeside(x: number, y: number): void {
    const rect = this.root.getBoundingClientRect();
    const { top } = chromeInsets();
    const gap = 28;
    // Prefer the left of the click: the cursor tip sits to its right.
    const left = x - gap - rect.width >= 8 ? x - gap - rect.width : x + gap;
    const spot = clampWindow(this.root, left, Math.max(top + 4, y - 40));
    this.root.style.left = `${spot.x}px`;
    this.root.style.top = `${spot.y}px`;
  }
}

/** "Following <name> · Stop" chip under the info bar while the camera follows someone. */
export class FollowChip {
  private readonly root = document.createElement('div');
  private readonly label = document.createElement('button');
  private readonly stop = document.createElement('button');

  constructor(onStop: () => void, onShow: () => void) {
    this.root.className = 'follow-chip';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.label.type = this.stop.type = 'button';
    this.label.className = 'follow-name';
    this.label.title = 'Show their card';
    this.label.onclick = onShow;
    this.stop.textContent = 'Stop';
    this.stop.title = 'Stop following (Esc)';
    this.stop.onclick = onStop;
    this.root.append(this.label, this.stop);
    document.body.append(this.root);
  }

  show(name: string | null): void {
    this.root.hidden = name === null;
    if (name !== null) setText(this.label, `Following ${name}`);
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
