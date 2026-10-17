import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { RowBuckets } from '../../src/render/rowBuckets';
import { badgeSide, type LandingQueue } from '../../src/render/landingQueues';
import { Motion } from '../../src/render/motion';
import { createInitialState, setupDemoTower, tick } from '../../src/sim';

describe('row bucket culling', () => {
  it('shows only the rows overlapping the visible band', () => {
    const rows = new RowBuckets();
    const low = new Container(), high = new Container(), tall = new Container();
    rows.add(low, 0, 24);
    rows.add(high, -2400, 24);
    // A tall room filed by its top still shows while its lower part is on screen.
    rows.add(tall, -600, 120);
    expect(rows.size).toBe(3);
    rows.cull(-520, 40);
    expect(low.parent!.visible).toBe(true);
    expect(tall.parent!.visible).toBe(true);
    expect(high.parent!.visible).toBe(false);
    rows.showAll();
    expect(high.parent!.visible).toBe(true);
  });

  it('re-files a child that moved to another row', () => {
    const rows = new RowBuckets();
    const child = new Container();
    rows.add(child, 0, 24);
    const first = child.parent;
    rows.add(child, -960, 24);
    expect(child.parent).not.toBe(first);
    expect(rows.size).toBe(1);
    rows.clear();
    expect(rows.size).toBe(0);
  });
});

describe('landing queue badges', () => {
  const queue = (east: number, count: number): LandingQueue => ({ left: 0, right: 48, floor: 3, y: 0, count, up: count - east, down: east, east });
  it('sit over the side where the people actually stand', () => {
    expect(badgeSide(queue(0, 5), () => false)).toBe(-1);
    expect(badgeSide(queue(4, 5), () => false)).toBe(1);
    // A walled side flips the badge to the free one.
    expect(badgeSide(queue(4, 5), side => side === 1)).toBe(-1);
  });
});

describe('motion capture', () => {
  it('reuses its samples between ticks and forgets stale ones', () => {
    const state = createInitialState(42);
    setupDemoTower(state);
    for (let i = 0; i < 1301; i++) tick(state);
    const person = [...state.people.values()][0]!;
    person.state = 'walking'; person.pos = { x: 10, floor: 2 };
    const motion = new Motion();
    motion.capture(state);
    person.pos.x = 11;
    motion.capture(state);
    person.pos.x = 13;
    expect(motion.personX(state, person, 0.5)).toBe(12);
    // A person missing from the latest capture is never interpolated.
    state.people.delete(person.id);
    motion.capture(state);
    state.people.set(person.id, person);
    expect(motion.personX(state, person, 0.5)).toBe(13);
  });
});
