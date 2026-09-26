import { expect, it } from 'vitest';
import { deserializeGame, serializeGame } from '../../src/sim';
import { addElevatorCar, elevatorCapacity, stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople } from '../../src/sim/people';
import { joinQueue, pressCall } from '../../src/sim/queues';
import { newTestGame, scenarioTower, setClock } from '../helpers/simHarness';

it.each([
  { name: 'morning arrivals', minute: 540, trips: [[1, 5, 40]] },
  { name: 'lunch cross-traffic', minute: 720, trips: [[1, 5, 20], [5, 1, 20], [3, 5, 10], [3, 1, 10]] },
  { name: 'evening departures', minute: 1080, trips: [[5, 1, 40], [3, 1, 20]] },
])('two cars finish $name without losing or duplicating passengers', ({ minute, trips }) => {
  const state = newTestGame(); scenarioTower(state); setClock(state, minute);
  const group = [...state.elevatorGroups.values()][0]!;
  addElevatorCar(state, group.id);
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const template = [...state.people.values()][0]!;
  state.people.clear();
  const ids: number[] = [];
  for (const [from, to, count] of trips) {
    for (let i = 0; i < count!; i++) {
      const id = state.nextEntityId++; ids.push(id);
      const dir = to! > from! ? 1 : -1;
      state.people.set(id, { ...template, id, state: 'waiting', legIndex: 0,
        pos: { floor: from!, x: group.x + 1 },
        route: [{ mode: 'elevator', from: from!, to: to!, dir, groupId: group.id }] });
      expect(joinQueue(state, id, from!, dir === 1 ? 'up' : 'down')).toBe(true);
      pressCall(state, from!, dir === 1 ? 'up' : 'down');
    }
  }
  let restored: typeof state | undefined;
  const usedCars = new Set<number>();
  for (let tick = 0; tick < 400; tick++) {
    stepElevators(state);
    if (restored) stepElevators(restored);
    if (tick === 10) restored = deserializeGame(serializeGame(state));
    const riding = group.cars.flatMap(car => {
      expect(car.passengers.length).toBeLessThanOrEqual(elevatorCapacity(group.kind));
      if (car.passengers.length) usedCars.add(car.id);
      return car.passengers;
    });
    const queued = Object.values(state.queues).flat();
    expect(new Set([...riding, ...queued]).size).toBe(riding.length + queued.length);
    for (const id of ids) {
      const p = state.people.get(id)!;
      expect(Number(riding.includes(id)) + Number(queued.includes(id)) + Number(p.legIndex === 1)).toBe(1);
      if (p.legIndex === 1) expect(p.pos.floor).toBe(p.route![0]!.to);
    }
  }
  expect(usedCars.size).toBe(2);
  expect(ids.every(id => state.people.get(id)!.legIndex === 1)).toBe(true);
  expect(Object.values(state.queues).flat()).toEqual([]);
  expect(serializeGame(restored!)).toBe(serializeGame(state));
});
