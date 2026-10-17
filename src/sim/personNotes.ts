import type { GameState } from './state';

/**
 * People you can get to know: every person has a stable generated name
 * (from their id and the tower seed — never the sim RNG stream), and the
 * player's renames and favourites live in `state.personNotes` as overrides.
 * Notes for people who have left are pruned, except favourites, which keep a
 * short "left the tower" record. Pure and deterministic.
 */

export interface PersonNote {
  /** Player rename; absent = the generated name. */
  name?: string;
  favorite?: boolean;
  /** Day a favourite left the tower (set when they are gone). */
  departedDay?: number;
}

export const PERSON_NAME_MAX = 24;
/** "Left the tower" records kept for departed favourites. */
export const DEPARTED_MAX = 12;
/** Ticks between note clean-ups (cheap: only the noted ids are checked). */
const PRUNE_EVERY = 30;

const FIRST_NAMES: readonly string[] = [
  'Maria', 'James', 'Aiko', 'Kwame', 'Sofia', 'Liam', 'Priya', 'Mateo', 'Fatima', 'Noah',
  'Mei', 'Oluwaseun', 'Elena', 'Hiroshi', 'Amara', 'Lucas', 'Ingrid', 'Rahul', 'Chloe', 'Diego',
  'Yasmin', 'Tomasz', 'Leilani', 'Omar', 'Hannah', 'Jin', 'Zanele', 'Pablo', 'Anya', 'Kofi',
  'Grace', 'Arjun', 'Isabella', 'Mohammed', 'Freya', 'Thanh', 'Nadia', 'Emeka', 'Lucia', 'Sven',
  'Ayesha', 'Daniel', 'Keiko', 'Tariq', 'Olivia', 'Ravi', 'Camila', 'Erik', 'Wanjiru', 'Marco',
  'Soo-ah', 'Chidi', 'Ana', 'Felix', 'Laila', 'Kenji', 'Rosa', 'Samir', 'Tove', 'Malik',
  'Ines', 'Dmitri', 'Abena', 'Hugo', 'Mira', 'Javier', 'Esi', 'Callum', 'Linh', 'Rania',
];

const LAST_NAMES: readonly string[] = [
  'Lopez', 'Smith', 'Tanaka', 'Mensah', 'Rossi', 'Murphy', 'Patel', 'Garcia', 'Haddad', 'Nguyen',
  'Chen', 'Adeyemi', 'Petrova', 'Sato', 'Okafor', 'Silva', 'Larsen', 'Sharma', 'Martin', 'Fernandez',
  'Kowalski', 'Kahale', 'Rahman', 'Schmidt', 'Kim', 'Dlamini', 'Ruiz', 'Ivanova', 'Owusu', 'Brown',
  'Gupta', 'Moreau', 'Hassan', 'Johansson', 'Tran', 'Novak', 'Eze', 'Romano', 'Lindqvist', 'Khan',
  'Cohen', 'Yamamoto', 'Aziz', 'Wilson', 'Iyer', 'Costa', 'Berg', 'Kamau', 'Bianchi', 'Park',
  'Obi', 'Santos', 'Weber', 'Nasser', 'Mori', 'Torres', 'Farouk', 'Holm', 'Diallo', 'Reyes',
  'Volkov', 'Asante', 'Dubois', 'Wong', 'Herrera', 'Boateng', 'Campbell', 'Pham', 'Saleh', 'Kaur',
];

/** 32-bit integer hash (independent of the sim's RNG state). */
function mix(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The name a person is born with: stable for (tower seed, person id). */
export function generatedName(seed: number, id: number): string {
  const base = mix(Math.imul(id + 1, 0x9e3779b1) ^ mix(seed));
  const first = FIRST_NAMES[base % FIRST_NAMES.length]!;
  const last = LAST_NAMES[mix(base ^ 0x5bd1e995) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}

/** Display name: the player's rename, else the generated one. */
export function personName(state: GameState, id: number): string {
  return state.personNotes?.[id]?.name ?? generatedName(state.seed, id);
}

export function personNote(state: GameState, id: number): PersonNote | undefined {
  return state.personNotes?.[id];
}

export function isFavorite(state: GameState, id: number): boolean {
  return state.personNotes?.[id]?.favorite === true;
}

/** Trim, collapse spaces and cap a typed name; '' means "no override". */
export function cleanPersonName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PERSON_NAME_MAX).trim();
}

function noteFor(state: GameState, id: number): PersonNote {
  const notes = (state.personNotes ??= {});
  return (notes[id] ??= {});
}

function dropIfEmpty(state: GameState, id: number): void {
  const note = state.personNotes?.[id];
  if (note && note.name === undefined && !note.favorite) delete state.personNotes![id];
}

/**
 * Rename someone in the tower (blank or the generated name clears the
 * override). Throws for people who are not in the tower.
 */
export function renamePerson(state: GameState, id: number, text: string): string {
  if (!state.people.has(id)) throw new Error('That person has left the tower');
  const name = cleanPersonName(text);
  const note = noteFor(state, id);
  if (!name || name === generatedName(state.seed, id)) delete note.name;
  else note.name = name;
  dropIfEmpty(state, id);
  return personName(state, id);
}

/** Star or unstar someone. Unstarring a departed favourite forgets them. */
export function setFavorite(state: GameState, id: number, favorite: boolean): void {
  const present = state.people.has(id);
  if (favorite && !present) throw new Error('That person has left the tower');
  if (!favorite && !state.personNotes?.[id]) return;
  const note = noteFor(state, id);
  if (favorite) note.favorite = true;
  else if (!present) { delete state.personNotes![id]; return; }
  else delete note.favorite;
  dropIfEmpty(state, id);
}

/** Ids of favourites still in the tower, in id order. */
export function favoriteIds(state: GameState): number[] {
  const out: number[] = [];
  const notes = state.personNotes;
  if (!notes) return out;
  for (const key of Object.keys(notes)) {
    const id = Number(key);
    const note = notes[id]!;
    if (note.favorite && note.departedDay === undefined && state.people.has(id)) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

export interface DepartedRecord { id: number; name: string; day: number }

/** Favourites who have left, most recent first. */
export function departedFavorites(state: GameState): DepartedRecord[] {
  const out: DepartedRecord[] = [];
  const notes = state.personNotes;
  if (!notes) return out;
  for (const key of Object.keys(notes)) {
    const id = Number(key);
    const note = notes[id]!;
    if (note.departedDay !== undefined) out.push({ id, name: note.name ?? generatedName(state.seed, id), day: note.departedDay });
  }
  return out.sort((a, b) => b.day - a.day || b.id - a.id);
}

/**
 * Forget notes about people who are gone; favourites become a dated
 * "left the tower" record (keeping the newest DEPARTED_MAX).
 */
export function prunePersonNotes(state: GameState): void {
  const notes = state.personNotes;
  if (!notes) return;
  let departed = 0;
  for (const key of Object.keys(notes)) {
    const id = Number(key);
    const note = notes[id]!;
    if (note.departedDay !== undefined) { departed++; continue; }
    if (state.people.has(id)) continue;
    if (!note.favorite) { delete notes[id]; continue; }
    note.name ??= generatedName(state.seed, id);
    note.departedDay = state.calendar.day;
    departed++;
  }
  if (departed > DEPARTED_MAX) {
    for (const record of departedFavorites(state).slice(DEPARTED_MAX)) delete notes[record.id];
  }
}

/** Engine step: prune every few ticks while there are any notes. */
export function stepPersonNotes(state: GameState): void {
  if (state.personNotes && state.tickCount % PRUNE_EVERY === 0) prunePersonNotes(state);
}

/**
 * The tenant's favourite occupant (lowest id), if any — tenant voices speak
 * in their name. Only notes are scanned, so this is cheap.
 */
export function favoriteOf(state: GameState, tenantId: number): string | null {
  const notes = state.personNotes;
  if (!notes) return null;
  let best = -1;
  for (const key of Object.keys(notes)) {
    const id = Number(key);
    if (!notes[id]!.favorite || notes[id]!.departedDay !== undefined) continue;
    const person = state.people.get(id);
    if (!person || person.tenantId !== tenantId) continue;
    if (person.kind !== 'resident' && person.kind !== 'officeWorker' && person.kind !== 'hotelGuest') continue;
    if (best < 0 || id < best) best = id;
  }
  return best < 0 ? null : personName(state, best);
}
