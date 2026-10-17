import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TowerAudio } from '../../src/audio/towerAudio';
import { createInitialState, setupNewGame, setupDemoTower, serializeGame } from '../../src/sim';

/** Fake Web Audio: every node has every param; started sources are recorded. */
const starts = vi.fn();
const resume = vi.fn(async () => {});
const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
const node = () => ({
  connect: vi.fn(), disconnect: vi.fn(), start: starts, stop: vi.fn(), onended: null, buffer: null, loop: false, type: '',
  gain: parameter(), frequency: parameter(), detune: parameter(), Q: parameter(), pan: parameter(), playbackRate: parameter(),
  threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(),
});
class Context {
  currentTime = 10;
  state = 'running';
  sampleRate = 100;
  destination = {};
  resume = resume;
  suspend = vi.fn(async () => {});
  createGain = node;
  createOscillator = node;
  createDynamicsCompressor = node;
  createBiquadFilter = node;
  createStereoPanner = node;
  createBufferSource = node;
  createConvolver = node;
  createBuffer = (channels: number, length: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (i: number) => data[i]! };
  };
}
const contexts: Context[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  contexts.length = 0;
  vi.stubGlobal('AudioContext', class extends Context { constructor() { super(); contexts.push(this); } });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const view = { x: 0, y: 600, zoom: 1, width: 1280, height: 720 };

it('waits for interaction, throttles repeated cues and respects mute', async () => {
  const audio = new TowerAudio();
  audio.play('bell'); expect(starts).not.toHaveBeenCalled();
  await audio.unlock(); starts.mockClear();
  audio.play('bell'); const count = starts.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < 100; i++) audio.play('bell');
  expect(starts).toHaveBeenCalledTimes(count);
  audio.configure({ muted: true }); audio.play('rating');
  expect(starts).toHaveBeenCalledTimes(count);
  expect(localStorage.setItem).toHaveBeenCalledWith('upper-story-audio', expect.stringContaining('"muted":true'));
});

it('survives unavailable audio and storage without changing simulation state', async () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Unavailable'); } });
  vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('Unavailable'); });
  vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Unavailable'); });
  const audio = new TowerAudio(); await audio.unlock(); audio.configure({ volume: 0.2 });
  const state = createInitialState(1); setupNewGame(state);
  const before = serializeGame(state);
  audio.update(state, true, view);
  expect(serializeGame(state)).toBe(before);
});

it('restores muted preferences, clamps malformed levels and fills new buses with defaults', async () => {
  vi.mocked(localStorage.getItem).mockReturnValue('{"muted":true,"volume":20,"ambience":-4,"effects":"loud"}');
  const audio = new TowerAudio(); await audio.unlock();
  expect(audio.preferences).toEqual({ muted: true, volume: 1, ambience: 0, effects: 0.7, interface: 0.5 });
  expect(starts).not.toHaveBeenCalled();
});

it('rings the arrival bell for visible cars only while playing, and never touches the state', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999); // no random ambient detail
  const audio = new TowerAudio(); await audio.unlock();
  const state = createInitialState(3); setupDemoTower(state);
  const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
  car.state = 'moving';
  audio.update(state, true, view);
  const before = serializeGame(state);
  starts.mockClear();
  car.state = 'doors';
  audio.update(state, false, view); // paused: no bell
  expect(starts).not.toHaveBeenCalled();
  car.state = 'moving'; audio.update(state, true, view);
  contexts[0]!.currentTime += 5;
  car.state = 'doors'; audio.update(state, true, view);
  const bell = starts.mock.calls.length;
  expect(bell).toBeGreaterThan(0);
  // Off screen (camera far away): silent.
  starts.mockClear();
  car.state = 'moving'; audio.update(state, true, { ...view, x: -60000 });
  contexts[0]!.currentTime += 5;
  car.state = 'doors'; audio.update(state, true, { ...view, x: -60000 });
  expect(starts).not.toHaveBeenCalled();
  car.state = 'moving';
  expect(serializeGame(state)).toBe(before);
});

it('sounds new incidents, blackouts and breakdowns once on their transitions', async () => {
  const audio = new TowerAudio(); await audio.unlock();
  const state = createInitialState(4); setupDemoTower(state);
  audio.update(state, true, view);
  const tenant = [...state.tenants.values()].find(t => t.type === 'office')!;
  starts.mockClear();
  state.campaign.incidents.push({ id: 9999, kind: 'fire', tenantId: tenant.id, deadline: 1e9, responseAt: null, response: null });
  audio.update(state, true, view);
  const alarm = starts.mock.calls.length;
  expect(alarm).toBeGreaterThan(10);
  starts.mockClear();
  audio.update(state, false, view); // same incident, paused: no new alarm
  expect(starts).not.toHaveBeenCalled();
  state.campaign.incidents.length = 0;
  state.campaign.blackoutUntilTick = state.tickCount + 100;
  audio.update(state, false, view);
  expect(starts.mock.calls.length).toBeGreaterThan(0);
  starts.mockClear();
  const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
  car.outOfService = true;
  audio.update(state, false, view);
  expect(starts.mock.calls.length).toBeGreaterThan(0);
});

it('maps sim events to cues with rate limiting', async () => {
  const audio = new TowerAudio(); await audio.unlock();
  const state = createInitialState(5); setupDemoTower(state);
  audio.update(state, true, view);
  starts.mockClear();
  for (let i = 0; i < 20; i++) audio.events([{ type: 'MONEY_CHANGED', balance: 1, delta: 500 }]);
  const pops = starts.mock.calls.length;
  expect(pops).toBeGreaterThan(0);
  expect(pops).toBeLessThanOrEqual(3);
  starts.mockClear();
  audio.events([{ type: 'LEVEL_UP', starLevel: 6 }]);
  expect(starts.mock.calls.length).toBeGreaterThan(20);
  starts.mockClear();
  for (let i = 0; i < 10; i++) audio.events([{ type: 'PERSON_GAVE_UP', personId: i, floor: 1 }]);
  expect(starts.mock.calls.length).toBeLessThanOrEqual(2);
});

it('sounds tool changes once per burst', async () => {
  const audio = new TowerAudio(); await audio.unlock(); starts.mockClear();
  audio.toolChanged();
  const once = starts.mock.calls.length;
  expect(once).toBeGreaterThan(0);
  audio.toolChanged(); audio.toolChanged();
  expect(starts).toHaveBeenCalledTimes(once);
});
