import { carWorldY, type GameState, type Person } from '../sim';

interface PersonSample { x: number; floor: number; state: Person['state']; gen: number }

/**
 * The previous simulation tick, used only to interpolate visible motion.
 * Samples are reused records stamped with the capture generation, so a
 * capture over thousands of people allocates nothing in steady state.
 */
export class Motion {
  private owner: GameState | null = null;
  private gen = 0;
  private people = new Map<number, PersonSample>();
  private cars = new Map<number, number>();
  capture(state: GameState): void {
    this.owner = state;
    const gen = ++this.gen;
    const people = this.people;
    // Drop records of people who left (rarely: only when the map outgrows the crowd).
    if (people.size > state.people.size * 1.5 + 64) people.clear();
    for (const person of state.people.values()) {
      const sample = people.get(person.id);
      if (sample) {
        sample.x = person.pos.x; sample.floor = person.pos.floor; sample.state = person.state; sample.gen = gen;
      } else {
        people.set(person.id, { x: person.pos.x, floor: person.pos.floor, state: person.state, gen });
      }
    }
    this.cars.clear();
    for (const group of state.elevatorGroups.values()) for (const car of group.cars) this.cars.set(car.id, car.y);
  }
  personX(state: GameState, person: Person, alpha: number): number {
    if (person.state !== 'walking' || this.owner !== state) return person.pos.x;
    const previous = this.people.get(person.id);
    // Never smear teleportation, floor transitions, or entry into a room.
    if (!previous || previous.gen !== this.gen || previous.floor !== person.pos.floor || previous.state !== person.state) return person.pos.x;
    return previous.x + (person.pos.x - previous.x) * Math.min(1, Math.max(0, alpha));
  }
  carY(state: GameState, id: number, current: number, alpha: number): number {
    const previous = this.owner === state ? this.cars.get(id) : undefined;
    const from = carWorldY(previous ?? current, state.tower.lobbyHeight), to = carWorldY(current, state.tower.lobbyHeight);
    return from + (to - from) * Math.min(1, Math.max(0, alpha));
  }
}
