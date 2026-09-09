import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TowerAudio } from '../../src/audio/towerAudio';
import { createInitialState, setupNewGame, serializeGame } from '../../src/sim';

const starts = vi.fn();
const resume = vi.fn(async () => {});
const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: starts, stop: vi.fn(), gain: parameter(), frequency: parameter(), pan: parameter(), onended: null });
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
  createBuffer = () => ({ getChannelData: () => new Float32Array(200) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('waits for interaction, throttles repeated cues and respects mute', async () => {
  const audio = new TowerAudio();
  audio.play('door'); expect(starts).not.toHaveBeenCalled();
  await audio.unlock(); starts.mockClear();
  audio.play('door'); const count = starts.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < 100; i++) audio.play('door');
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
  audio.update(state, true, { x: 0, y: 600, zoom: 1, width: 1280, height: 720 });
  expect(serializeGame(state)).toBe(before);
});

it('restores muted preferences and clamps malformed saved levels', async () => {
  vi.mocked(localStorage.getItem).mockReturnValue('{"muted":true,"volume":20,"ambience":-4}');
  const audio = new TowerAudio(); await audio.unlock();
  expect(audio.preferences).toEqual({ muted: true, volume: 1, ambience: 0 });
  expect(starts).not.toHaveBeenCalled();
});
