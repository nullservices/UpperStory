import { departedFavorites, favoriteIds, isFavorite, personName } from '../sim/personNotes';
import { formatTowerDate } from '../sim/time';
import type { GameState } from '../sim/state';
import type { PersonActions } from './personCard';
import { personActivity, personRole } from './personInfo';
import { chromeInsets, clampWindow, closeButton, makeDraggable, raiseWindow, readUiPref, writeUiPref } from './windowing';

/** Search results shown at most (the search itself runs only on typing). */
export const SEARCH_LIMIT = 30;
const REFRESH_MS = 500;

/**
 * Ids of people in the tower whose name contains `query` (case-insensitive),
 * favourites first then by id, capped at `limit`. Runs on demand only.
 */
export function searchPeople(state: GameState, query: string, limit = SEARCH_LIMIT): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: number[] = [];
  for (const id of state.people.keys()) if (personName(state, id).toLowerCase().includes(q)) hits.push(id);
  hits.sort((a, b) => Number(isFavorite(state, b)) - Number(isFavorite(state, a)) || a - b);
  return hits.slice(0, limit);
}

/**
 * Tower › People…: starred favourites with live status (Follow / Jump /
 * Unstar), a name search across everyone in the tower, and the recent
 * "left the tower" records. A floating window, so the tower keeps running.
 */
export class PeopleWindow {
  private readonly root = document.createElement('section');
  private readonly favList = document.createElement('ul');
  private readonly favEmpty = document.createElement('p');
  private readonly search = document.createElement('input');
  private readonly results = document.createElement('ul');
  private readonly resultNote = document.createElement('p');
  private readonly departedHead = document.createElement('h3');
  private readonly departedList = document.createElement('ul');
  private state: GameState | null = null;
  private lastRefresh = 0;
  private favKey = '';
  private departedKey = '';
  private resultIds: number[] = [];
  private searchTimer = 0;
  /** Live status lines by person id (only the rows on show). */
  private readonly statusEls = new Map<number, HTMLElement[]>();
  private prefs = readUiPref<{ x: number | null; y: number | null }>('people', { x: null, y: null });

  constructor(private readonly actions: PersonActions) {
    const root = this.root;
    root.className = 'people-window ui-window';
    root.setAttribute('aria-label', 'People');
    root.tabIndex = -1;
    root.hidden = true;
    const title = document.createElement('div');
    title.className = 'window-title';
    title.innerHTML = '<span class="title-text">People</span>';
    title.append(closeButton('Close people', () => this.close()));
    const body = document.createElement('div');
    body.className = 'window-body';
    const favHead = document.createElement('h3');
    favHead.textContent = 'Favourites';
    this.favList.className = 'people-list';
    this.favEmpty.className = 'window-hint';
    this.favEmpty.textContent = 'No favourites yet. With Inspect (I), click someone walking or waiting, then press ☆ on their card.';
    const searchHead = document.createElement('h3');
    searchHead.textContent = 'Find someone';
    this.search.type = 'search';
    this.search.placeholder = 'Search by name…';
    this.search.setAttribute('aria-label', 'Search people by name');
    this.search.className = 'people-search';
    this.search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.runSearch(), 150);
    });
    this.search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.search.value) { e.preventDefault(); e.stopPropagation(); this.search.value = ''; this.runSearch(); }
    });
    this.results.className = 'people-list';
    this.resultNote.className = 'window-hint';
    this.departedHead.textContent = 'Left the tower';
    this.departedList.className = 'people-list departed';
    body.append(favHead, this.favList, this.favEmpty, searchHead, this.search, this.results, this.resultNote, this.departedHead, this.departedList);
    root.append(title, body);
    document.body.append(root);
    makeDraggable(root, title, 'fixed', (x, y) => { this.prefs = { x, y }; writeUiPref('people', this.prefs); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(): void {
    if (this.root.hidden) this.open(); else this.close();
  }

  open(): void {
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    raiseWindow(this.root);
    if (wasHidden) {
      this.favKey = this.departedKey = '';
      this.place();
      this.refresh(true);
    }
    this.root.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
  }

  update(state: GameState): void {
    if (state !== this.state) {
      this.state = state;
      this.favKey = this.departedKey = '';
      this.resultIds = [];
      this.results.replaceChildren();
      this.search.value = '';
      this.resultNote.textContent = '';
    }
    if (!this.root.hidden) this.refresh(false);
  }

  /** Rebuild lists when membership changed; otherwise only the status lines. */
  private refresh(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const state = this.state;
    if (!state) return;
    const favs = favoriteIds(state);
    const followed = this.actions.following();
    const favKey = `${favs.join(',')}|${followed}|${favs.map(id => personName(state, id)).join('|')}`;
    if (favKey !== this.favKey) {
      this.favKey = favKey;
      this.statusEls.clear();
      this.favList.replaceChildren(...favs.map(id => this.row(state, id, true)));
      this.results.replaceChildren(...this.resultIds.filter(id => state.people.has(id)).map(id => this.row(state, id, false)));
    }
    this.favEmpty.hidden = favs.length > 0;
    for (const [id, els] of this.statusEls) {
      const person = state.people.get(id);
      const text = person ? personActivity(state, person) : 'Left the tower';
      for (const el of els) if (el.textContent !== text) el.textContent = text;
    }
    const departed = departedFavorites(state);
    const departedKey = departed.map(d => `${d.id}:${d.name}:${d.day}`).join(',');
    if (departedKey !== this.departedKey) {
      this.departedKey = departedKey;
      this.departedHead.hidden = this.departedList.hidden = departed.length === 0;
      this.departedList.replaceChildren(...departed.map(d => {
        const li = document.createElement('li');
        const name = document.createElement('b');
        name.textContent = d.name;
        const when = document.createElement('small');
        when.textContent = `Left the tower on ${formatTowerDate(d.day)}`;
        const forget = smallButton('Forget', `Forget ${d.name}`, () => { this.actions.setFavorite(d.id, false); this.refresh(true); });
        const text = document.createElement('div');
        text.className = 'people-text';
        text.append(name, when);
        li.append(text, forget);
        return li;
      }));
    }
  }

  private runSearch(): void {
    const state = this.state;
    if (!state) return;
    const query = this.search.value;
    this.resultIds = searchPeople(state, query, SEARCH_LIMIT + 1);
    const more = this.resultIds.length > SEARCH_LIMIT;
    if (more) this.resultIds.length = SEARCH_LIMIT;
    this.favKey = ''; // rebuild both lists with fresh status lines
    this.refresh(true);
    this.resultNote.textContent = !query.trim() ? '' : this.resultIds.length === 0
      ? `Nobody in the tower is called “${query.trim()}”.`
      : more ? `Showing the first ${SEARCH_LIMIT} matches. Type more of the name to narrow it down.` : '';
  }

  private row(state: GameState, id: number, favourite: boolean): HTMLLIElement {
    const li = document.createElement('li');
    const person = state.people.get(id);
    const text = document.createElement('div');
    text.className = 'people-text';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'people-name';
    name.textContent = `${isFavorite(state, id) ? '★ ' : ''}${personName(state, id)}`;
    name.title = 'Open their card';
    name.onclick = () => this.actions.inspect(id);
    const role = document.createElement('small');
    role.textContent = person ? personRole(state, person) : '';
    const status = document.createElement('small');
    status.className = 'people-status';
    const shown = this.statusEls.get(id);
    if (shown) shown.push(status); else this.statusEls.set(id, [status]);
    text.append(name, role, status);
    const following = this.actions.following() === id;
    const follow = smallButton(following ? 'Stop' : 'Follow', following ? 'Stop following' : 'Follow with the camera', () => {
      this.actions.follow(following ? null : id);
      this.favKey = '';
      this.refresh(true);
    });
    const jump = smallButton('Jump', 'Centre the view on them', () => this.actions.jumpToPerson(id));
    const star = favourite
      ? smallButton('Unstar', 'Remove from favourites', () => { this.actions.setFavorite(id, false); this.refresh(true); })
      : smallButton(isFavorite(state, id) ? '★' : '☆', isFavorite(state, id) ? 'Unstar' : 'Star as a favourite', () => {
        this.actions.setFavorite(id, !isFavorite(state, id));
        this.favKey = '';
        this.refresh(true);
      });
    const buttons = document.createElement('div');
    buttons.className = 'people-buttons';
    buttons.append(follow, jump, star);
    li.append(text, buttons);
    return li;
  }

  private place(): void {
    const { top } = chromeInsets();
    const width = this.root.offsetWidth || 340;
    const spot = clampWindow(this.root, this.prefs.x ?? window.innerWidth - width - 16, this.prefs.y ?? top + 12);
    this.root.style.left = `${spot.x}px`;
    this.root.style.top = `${spot.y}px`;
  }
}

function smallButton(text: string, title: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.onclick = action;
  return b;
}
