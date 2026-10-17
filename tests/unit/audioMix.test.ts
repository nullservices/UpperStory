import { describe, expect, it } from 'vitest';
import {
  HeliTracker, Priority, RateLimiter, VoicePool, ambienceMix, bellVoice, birdSong, busGains, chance, daylight, heliPose,
  sanitizePreferences, spatial, workHours, DEFAULT_PREFERENCES,
} from '../../src/audio/mix';
import { fillNoise } from '../../src/audio/engine';
import { createInitialState, setupDemoTower } from '../../src/sim';
import { CONFIG } from '../../src/data/config';

const view = { x: 0, y: 600, zoom: 1, width: 1280, height: 720 };

describe('levels', () => {
  it('tapers sliders, mutes the master and keeps the interface lighter than effects', () => {
    const g = busGains(DEFAULT_PREFERENCES);
    expect(g.master).toBeGreaterThan(0);
    expect(g.ui).toBeLessThan(g.effects);
    expect(busGains({ ...DEFAULT_PREFERENCES, muted: true }).master).toBe(0);
    expect(busGains({ ...DEFAULT_PREFERENCES, effects: 0.25 }).effects).toBeLessThan(busGains(DEFAULT_PREFERENCES).effects * 0.4);
  });

  it('sanitizes saved preferences', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ volume: Number.NaN, interface: 2 })).toEqual({ ...DEFAULT_PREFERENCES, interface: 1 });
  });
});

describe('limiting', () => {
  it('cooldowns and token buckets', () => {
    const r = new RateLimiter();
    expect(r.allow('a', 0, 1)).toBe(true);
    expect(r.allow('a', 0.5, 1)).toBe(false);
    expect(r.allow('a', 1.01, 1)).toBe(true);
    const burst = [0, 0, 0, 0].map(() => r.bucket('b', 10, 3, 1));
    expect(burst).toEqual([true, true, true, false]);
    expect(r.bucket('b', 11.1, 3, 1)).toBe(true);
  });

  it('refuses ambient detail before important events', () => {
    const pool = new VoicePool(10);
    let detail = 0;
    for (let i = 0; i < 20; i++) if (pool.acquire(0, 5, Priority.Detail)) detail++;
    expect(detail).toBe(5);
    let events = 0;
    for (let i = 0; i < 20; i++) if (pool.acquire(0, 5, Priority.Event)) events++;
    expect(events).toBe(13);
    expect(pool.active(6)).toBe(0);
    expect(pool.acquire(6, 1, Priority.Detail)).toBe(true);
  });

  it('turns rates into per-frame chances', () => {
    expect(chance(0, 1)).toBe(0);
    expect(chance(1, 1 / 60)).toBeCloseTo(1 / 60, 3);
    expect(chance(100, 1)).toBeCloseTo(1, 6);
  });
});

describe('space', () => {
  it('pans by screen position and fades with distance off screen', () => {
    const centre = spatial(640, 360, view);
    expect(centre.pan).toBeCloseTo(0);
    expect(centre.gain).toBeGreaterThan(0.9);
    expect(spatial(0, 360, view).pan).toBeLessThan(-0.5);
    const near = spatial(1280 + 200, 360, view).gain;
    const far = spatial(1280 + 900, 360, view).gain;
    expect(near).toBeGreaterThan(far);
    expect(spatial(1280 * 5, 360, view).gain).toBe(0);
    expect(spatial(640, 360, { ...view, zoom: 0.5 }).gain).toBeLessThan(centre.gain);
  });
});

describe('ambience', () => {
  it('follows the time of day', () => {
    expect(daylight(3)).toBe(0);
    expect(daylight(12)).toBe(1);
    expect(workHours(10)).toBe(1);
    expect(workHours(22)).toBe(0);
    expect(birdSong(7.5)).toBeGreaterThan(birdSong(13));
  });

  it('weights layers by what is on screen', () => {
    const state = createInitialState(2); setupDemoTower(state);
    for (const t of state.tenants.values()) { t.state = 'open'; t.occupancy = t.capacity; }
    state.calendar.minuteOfDay = 600; // 10:00 on a weekday
    const onTower = ambienceMix(state, view);
    expect(onTower.office).toBeGreaterThan(0);
    expect(onTower.crowd).toBeGreaterThan(0);
    expect(onTower.traffic).toBeGreaterThan(0.5);
    expect(onTower.machine).toBeGreaterThan(0);
    expect(onTower.rain).toBe(0);
    const away = ambienceMix(state, { ...view, x: -50000, y: 50000 });
    expect(away.office).toBe(0);
    expect(away.crowd).toBe(0);
    expect(away.traffic).toBeLessThan(0.05);
    state.calendar.minuteOfDay = 1440 + 120; // 02:00
    state.campaign.weather = 'rain';
    const night = ambienceMix(state, view);
    expect(night.office).toBeLessThan(onTower.office);
    expect(night.rain).toBeGreaterThan(0.5);
    expect(night.birds).toBe(0);
    state.campaign.blackoutUntilTick = state.tickCount + 10;
    expect(ambienceMix(state, view).machine).toBe(0);
  });

  it('lists visible construction sites', () => {
    const state = createInitialState(2); setupDemoTower(state);
    const constructing = [...state.tenants.values()].filter(t => t.state === 'constructing').length;
    expect(ambienceMix(state, view).construction.length).toBe(Math.min(6, constructing));
  });
});

describe('voices', () => {
  it('pitches the bell per shaft type and rings up/down in opposite order', () => {
    const express = bellVoice('express', true), service = bellVoice('service', true);
    expect(express.notes[0]).toBeGreaterThan(service.notes[0]);
    const down = bellVoice('standard', false), up = bellVoice('standard', true);
    expect(down.notes).toEqual([up.notes[1], up.notes[0]]);
  });

  it('generates loopable noise', () => {
    let seed = 1;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const color of ['pink', 'brown'] as const) {
      const data = new Float32Array(4000);
      fillNoise(data, color, random);
      expect(Math.abs(data[0]! - data[3999]!)).toBeLessThan(0.05);
      expect(data.every(v => Number.isFinite(v) && Math.abs(v) < 2)).toBe(true);
    }
  });
});

describe('helicopter', () => {
  it('flies a VIP in, parks with the rotor winding down, then leaves', () => {
    const state = createInitialState(2); setupDemoTower(state);
    const pad = [...state.tenants.values()][0]!;
    pad.type = 'helipad'; pad.state = 'open';
    state.calendar.day = 1; state.calendar.minuteOfDay = 0; // no cosmetic slot due
    const heli = new HeliTracker();
    state.campaign.incidents.push({ id: 1, kind: 'vip', tenantId: pad.id, deadline: 1e9, responseAt: null, response: null });
    heli.update(state, 0);
    const f = heli.flights.get(pad.id)!;
    expect(f.phase).toBe('approach');
    expect(Math.abs(heliPose(f, 0).dx)).toBeGreaterThan(800);
    heli.update(state, 7100);
    expect(f.phase).toBe('landed');
    expect(heliPose(f, 7100 + 5000).speed).toBe(0);
    state.campaign.incidents.length = 0;
    heli.update(state, 20000);
    expect(f.phase).toBe('spoolup');
    heli.update(state, 23000);
    heli.update(state, 31000);
    expect(heli.flights.has(pad.id)).toBe(false);
    expect(CONFIG.CELL_WIDTH_PX).toBeGreaterThan(0);
  });
});
