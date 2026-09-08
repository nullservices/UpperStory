import { carWorldY, type GameState, type Person } from '../sim';

/** The previous simulation tick, used only to interpolate visible motion. */
export class Motion {
  private owner: GameState | null = null;
  private people = new Map<number, { x: number; floor: number; state: Person['state'] }>();
  private cars = new Map<number, number>();
  capture(state: GameState): void {
    this.owner = state;
    this.people.clear(); this.cars.clear();
    for (const person of state.people.values()) this.people.set(person.id, { x: person.pos.x, floor: person.pos.floor, state: person.state });
    for (const group of state.elevatorGroups.values()) for (const car of group.cars) this.cars.set(car.id, car.y);
  }
  personX(state: GameState, person: Person, alpha: number): number {
    const previous = this.owner === state ? this.people.get(person.id) : undefined;
    // Never smear teleportation, floor transitions, or entry into a room.
    if (!previous || previous.floor !== person.pos.floor || previous.state !== person.state || person.state !== 'walking') return person.pos.x;
    return previous.x + (person.pos.x - previous.x) * Math.min(1, Math.max(0, alpha));
  }
  carY(state: GameState, id: number, current: number, alpha: number): number {
    const previous = this.owner === state ? this.cars.get(id) : undefined;
    const from = carWorldY(previous ?? current), to = carWorldY(current);
    return from + (to - from) * Math.min(1, Math.max(0, alpha));
  }
}
