import { describe, expect, it } from 'vitest';
import { createInitialState, tick } from '../../src/sim';

describe('engine determinism', () => {
  it('same seed + same commands = identical state after 100 ticks', () => {
    const a = createInitialState(42);
    const b = createInitialState(42);
    for (let i = 0; i < 100; i++) {
      tick(a);
      tick(b);
    }
    expect(a).toEqual(b);
  });

  it('ticks clear the event sink', () => {
    const state = createInitialState(1);
    state.events.push({ type: 'ALERT', message: 'stale' });
    tick(state);
    expect(state.events).toEqual([]);
  });

  it('tickCount advances', () => {
    const state = createInitialState(1);
    for (let i = 1; i <= 25; i++) {
      tick(state);
      expect(state.tickCount).toBe(i);
    }
  });
});
