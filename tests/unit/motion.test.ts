import { describe, expect, it } from 'vitest';
import { Motion } from '../../src/render/motion';
import { createInitialState, setupDemoTower, tick, carWorldY } from '../../src/sim';

function fixture() {
  const state = createInitialState(42);
  setupDemoTower(state);
  for (let i = 0; i < 1301; i++) tick(state);
  const person = [...state.people.values()][0]!;
  person.state = 'walking'; person.pos = { x: 10, floor: 2 };
  return { state, person };
}

describe('render motion interpolation', () => {
  it('smooths walking between ticks without altering simulation positions', () => {
    const { state, person } = fixture(); const motion = new Motion();
    motion.capture(state); person.pos.x = 12;
    expect(motion.personX(state, person, 0.25)).toBe(10.5);
    expect(person.pos.x).toBe(12);
  });
  it('does not smear a person across floors or room transitions', () => {
    const { state, person } = fixture(); const motion = new Motion();
    motion.capture(state); person.pos = { x: 30, floor: 3 };
    expect(motion.personX(state, person, 0.5)).toBe(30);
    person.pos.floor = 2; person.state = 'inTenant';
    expect(motion.personX(state, person, 0.5)).toBe(30);
  });
  it('does not reuse motion from another loaded game with the same entity IDs', () => {
    const a = fixture(), b = fixture(), motion = new Motion();
    motion.capture(a.state); b.person.pos.x = 25;
    expect(motion.personX(b.state, b.person, 0)).toBe(25);
  });
  it('interpolates elevator positions in world space and clamps frame fractions', () => {
    const { state } = fixture(), motion = new Motion();
    const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
    car.y = 1; motion.capture(state); car.y = 2;
    expect(motion.carY(state, car.id, car.y, 0.5)).toBe((carWorldY(1) + carWorldY(2)) / 2);
    expect(motion.carY(state, car.id, car.y, 3)).toBe(carWorldY(2));
  });
});
