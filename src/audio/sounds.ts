import { Priority, bellVoice } from './mix';
import type { AudioEngine } from './engine';

/**
 * One-shot sound recipes. Every sound here is synthesized on the spot from
 * oscillators and filtered noise; none imitates a recording. `pan` and
 * `gain` come from the caller's spatial mix (1 = on screen, centre level).
 */

export interface Place { pan?: number; gain?: number }

const P = (place?: Place): { pan: number; gain: number } => ({ pan: place?.pan ?? 0, gain: place?.gain ?? 1 });

// -------------------------------------------------------------- interface

export function uiClick(e: AudioEngine, pitch = 1): void {
  const v = e.voice({ bus: 'ui', duration: 0.06, priority: Priority.Interface, gain: 1.4 });
  if (!v) return;
  e.tone(v.out, v.t, { type: 'triangle', freq: 1400 * pitch, freqEnd: 900 * pitch, decay: 0.035, peak: 0.12 });
  e.burst(v.out, v.t, { freq: 3500, q: 1.2, decay: 0.012, peak: 0.05 });
}

/** Choosing a build tool: a soft two-pip "select". */
export function uiTool(e: AudioEngine): void {
  const v = e.voice({ bus: 'ui', duration: 0.16, priority: Priority.Interface, gain: 0.9 });
  if (!v) return;
  e.tone(v.out, v.t, { type: 'sine', freq: 880, decay: 0.06, peak: 0.1 });
  e.tone(v.out, v.t + 0.055, { type: 'sine', freq: 1318.5, decay: 0.08, peak: 0.09 });
}

/** Something placed: a wooden "thock" with a little low body. */
export function uiPlace(e: AudioEngine, place?: Place): void {
  const { pan } = P(place);
  const v = e.voice({ bus: 'ui', duration: 0.22, priority: Priority.Interface, pan: pan * 0.5, reverb: 0.08 });
  if (!v) return;
  e.tone(v.out, v.t, { type: 'sine', freq: 210, freqEnd: 120, decay: 0.12, peak: 0.28 });
  e.tone(v.out, v.t, { type: 'triangle', freq: 640, freqEnd: 420, decay: 0.05, peak: 0.12 });
  e.burst(v.out, v.t, { freq: 1800, q: 2, decay: 0.03, peak: 0.12 });
}

/** Demolished: a short crumble of low noise grains. */
export function uiDemolish(e: AudioEngine, place?: Place): void {
  const { pan } = P(place);
  const v = e.voice({ bus: 'ui', duration: 0.6, priority: Priority.Interface, pan: pan * 0.5, reverb: 0.12 });
  if (!v) return;
  e.tone(v.out, v.t, { type: 'sine', freq: 120, freqEnd: 45, decay: 0.3, peak: 0.3 });
  for (let i = 0; i < 6; i++) {
    e.burst(v.out, v.t + 0.02 + i * 0.045 + Math.random() * 0.03, { color: 'brown', filter: 'lowpass', freq: 900 - i * 90, decay: 0.07 + Math.random() * 0.05, peak: 0.35 - i * 0.04 });
  }
}

/** Refused action: a soft, low two-step buzz (not a harsh beep). */
export function uiError(e: AudioEngine, place?: Place): void {
  const { pan } = P(place);
  const v = e.voice({ bus: 'ui', duration: 0.3, priority: Priority.Interface, pan: pan * 0.4 });
  if (!v) return;
  for (const [i, f] of [196, 165].entries()) {
    e.tone(v.out, v.t + i * 0.11, { type: 'square', freq: f, decay: 0.09, peak: 0.06, cutoff: 900, q: 0.8 });
  }
}

/** A notification blip for a tower news alert. */
export function uiNotify(e: AudioEngine): void {
  const v = e.voice({ bus: 'ui', duration: 0.5, priority: Priority.Interface, reverb: 0.15, gain: 0.7 });
  if (!v) return;
  e.bell(v.out, v.t, 987.8, 0.08, 0.35, [[1, 1], [2.01, 0.25]]);
  e.bell(v.out, v.t + 0.09, 1318.5, 0.07, 0.45, [[1, 1], [2.01, 0.2]]);
}

// -------------------------------------------------------------- elevators

/** The classic two-tone arrival ding, voiced per shaft type. */
export function elevatorBell(e: AudioEngine, kind: 'standard' | 'service' | 'express', goingUp: boolean, place?: Place): void {
  const { pan, gain } = P(place);
  const voice = bellVoice(kind, goingUp);
  const v = e.voice({ bus: 'effects', duration: voice.decay + 0.3, priority: Priority.World, pan, gain: gain * 0.42, reverb: 0.22 });
  if (!v) return;
  const partials: [number, number][] = [[1, 1], [2, 0.18 + 0.2 * voice.bright], [3.01, 0.05 * voice.bright], [4.2, 0.04 * voice.bright]];
  e.bell(v.out, v.t, voice.notes[0], 0.16, voice.decay, partials);
  e.bell(v.out, v.t + 0.32, voice.notes[1], 0.15, voice.decay * 1.2, partials);
}

/** Door swish: a filtered air sweep (open rises, close falls and bumps). */
export function elevatorDoor(e: AudioEngine, opening: boolean, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.5, priority: Priority.Detail, pan, gain: gain * 0.33, delay: opening ? 0.35 : 0 });
  if (!v) return;
  e.burst(v.out, v.t, { color: 'pink', freq: opening ? 900 : 2200, freqEnd: opening ? 2200 : 800, q: 1.4, attack: 0.08, decay: 0.3, peak: 0.12 });
  if (!opening) e.tone(v.out, v.t + 0.33, { freq: 95, freqEnd: 70, decay: 0.08, peak: 0.12 });
}

/** A car breaks down: clunk, metallic clank and a motor whine winding down. */
export function elevatorBreakdown(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 1.6, priority: Priority.Event, pan, gain: Math.max(0.35, gain), reverb: 0.25 });
  if (!v) return;
  e.tone(v.out, v.t, { freq: 80, freqEnd: 40, decay: 0.35, peak: 0.45 });
  e.burst(v.out, v.t, { color: 'brown', filter: 'lowpass', freq: 500, decay: 0.2, peak: 0.5 });
  e.bell(v.out, v.t + 0.05, 310, 0.12, 0.5, [[1, 1], [2.76, 0.6], [5.4, 0.3]]);
  e.tone(v.out, v.t + 0.1, { type: 'sawtooth', freq: 260, freqEnd: 60, attack: 0.02, decay: 1.2, peak: 0.07, cutoff: 900, cutoffEnd: 200 });
}

/** A repaired car: a ratchet and a rising motor. */
export function elevatorRepaired(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.9, priority: Priority.World, pan, gain: gain * 0.7, reverb: 0.15 });
  if (!v) return;
  for (let i = 0; i < 4; i++) e.burst(v.out, v.t + i * 0.06, { freq: 2600, q: 3, decay: 0.025, peak: 0.12 });
  e.tone(v.out, v.t + 0.25, { type: 'sawtooth', freq: 70, freqEnd: 180, attack: 0.1, decay: 0.5, peak: 0.06, cutoff: 600 });
}

// -------------------------------------------------------------- building

/** One hammer strike (construction loop). */
export function hammer(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.25, priority: Priority.Detail, pan, gain: gain * 0.8, reverb: 0.18 });
  if (!v) return;
  const pitch = 0.85 + Math.random() * 0.3;
  e.burst(v.out, v.t, { freq: 2400 * pitch, q: 2.5, decay: 0.03, peak: 0.25 });
  e.tone(v.out, v.t, { freq: 180 * pitch, freqEnd: 110, decay: 0.09, peak: 0.25 });
  e.bell(v.out, v.t, 1250 * pitch, 0.035, 0.12, [[1, 1], [2.3, 0.5]]);
}

/** A short power-drill burst (construction loop). */
export function drill(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const length = 0.5 + Math.random() * 0.6;
  const v = e.voice({ bus: 'effects', duration: length + 0.1, priority: Priority.Detail, pan, gain: gain * 0.5, reverb: 0.1 });
  if (!v) return;
  const f = 150 + Math.random() * 60;
  e.tone(v.out, v.t, { type: 'sawtooth', freq: f * 0.8, freqEnd: f, attack: 0.08, decay: length, peak: 0.08, cutoff: 1500, q: 2 });
  e.burst(v.out, v.t, { freq: 3000, q: 4, attack: 0.08, decay: length, peak: 0.05 });
}

/** A room is finished: a warm two-note marimba chime. */
export function roomReady(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.9, priority: Priority.World, pan, gain: Math.max(0.35, gain) * 0.8, reverb: 0.2 });
  if (!v) return;
  for (const [i, f] of [659.3, 880].entries()) {
    const t = v.t + i * 0.12;
    e.tone(v.out, t, { freq: f, decay: 0.5, peak: 0.16 });
    e.tone(v.out, t, { freq: f * 4, decay: 0.08, peak: 0.04 });
  }
}

// -------------------------------------------------------------- money & milestones

/** A tiny coin "tink" for income (heavily rate-limited by the caller). */
export function moneyPop(e: AudioEngine, size: number): void {
  const v = e.voice({ bus: 'effects', duration: 0.2, priority: Priority.Detail, gain: 0.6, pan: (Math.random() - 0.5) * 0.4 });
  if (!v) return;
  const f = 2400 + Math.min(1, size) * 600;
  e.bell(v.out, v.t, f, 0.05, 0.15, [[1, 1], [1.48, 0.5]]);
}

/** Quarterly report: key clacks, drawer roll and the "ka-ching" bell. */
export function cashRegister(e: AudioEngine): void {
  const v = e.voice({ bus: 'effects', duration: 1.5, priority: Priority.Event, gain: 0.85, reverb: 0.18 });
  if (!v) return;
  e.burst(v.out, v.t, { freq: 2600, q: 3, decay: 0.03, peak: 0.25 });
  e.burst(v.out, v.t + 0.08, { freq: 2200, q: 3, decay: 0.03, peak: 0.22 });
  e.burst(v.out, v.t + 0.16, { color: 'pink', freq: 700, freqEnd: 300, q: 1, attack: 0.02, decay: 0.25, peak: 0.25 });
  e.tone(v.out, v.t + 0.4, { freq: 90, decay: 0.08, peak: 0.25 });
  e.bell(v.out, v.t + 0.2, 2637, 0.14, 0.9, [[1, 1], [1.5, 0.6], [2.0, 0.3], [2.76, 0.15]]);
}

/** Star rating up: a short synth-brass fanfare. */
export function fanfare(e: AudioEngine): void {
  const v = e.voice({ bus: 'effects', duration: 2.6, priority: Priority.Event, reverb: 0.35 });
  if (!v) return;
  const brass = (t: number, f: number, length: number, peak: number): void => {
    for (const detune of [-6, 6]) e.tone(v.out, t, { type: 'sawtooth', freq: f, detune, attack: 0.04, decay: length, peak, cutoff: 2600, cutoffEnd: 700, q: 1 });
  };
  const notes = [392, 392, 392, 523.3];
  for (const [i, f] of notes.entries()) brass(v.t + i * 0.13, f, i === 3 ? 0.3 : 0.12, 0.06);
  for (const f of [523.3, 659.3, 784, 1046.5]) brass(v.t + 0.6, f, 1.6, 0.045);
  e.tone(v.out, v.t + 0.6, { freq: 98, freqEnd: 70, decay: 0.6, peak: 0.3 });
}

/** TOWER rating / wedding: a peal of church bells rung down the scale. */
export function weddingBells(e: AudioEngine, delay = 0): void {
  const v = e.voice({ bus: 'effects', duration: 7, priority: Priority.Event, reverb: 0.5, delay });
  if (!v) return;
  // Church-bell partials: hum, prime, minor third, fifth, nominal, upper partials.
  const partials: [number, number][] = [[0.5, 0.6], [1, 1], [1.19, 0.45], [1.5, 0.3], [2, 0.5], [2.52, 0.2], [3.01, 0.1]];
  const scale = [784, 698.5, 659.3, 587.3, 523.3, 493.9, 440, 392];
  for (let round = 0; round < 2; round++) {
    for (const [i, f] of scale.entries()) e.bell(v.out, v.t + round * 2.6 + i * 0.3, f, 0.07, 2.4, partials);
  }
}

// -------------------------------------------------------------- incidents

/** Electromechanical fire bell: a striker rattling against a gong. */
export function fireAlarm(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 1.6, priority: Priority.Event, pan, gain: gain * 0.7, reverb: 0.2 });
  if (!v) return;
  for (let i = 0; i < 20; i++) e.bell(v.out, v.t + i * 0.06, 1480, i === 0 ? 0.08 : 0.05, 0.25, [[1, 1], [2.32, 0.4], [3.9, 0.2]]);
}

/** A few fire crackles (wood pops plus a low ember thump). */
export function crackle(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.25, priority: Priority.Detail, pan: pan + (Math.random() - 0.5) * 0.15, gain: gain * 0.5 });
  if (!v) return;
  const pops = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pops; i++) {
    e.burst(v.out, v.t + Math.random() * 0.08, { freq: 1500 + Math.random() * 3500, q: 2, attack: 0.001, decay: 0.006 + Math.random() * 0.02, peak: 0.1 + Math.random() * 0.2 });
  }
  if (Math.random() < 0.3) e.tone(v.out, v.t, { freq: 140 + Math.random() * 80, freqEnd: 70, decay: 0.06, peak: 0.12 });
}

/** Bomb threat: a tense low brass stab over a descending two-tone. */
export function bombAlert(e: AudioEngine, place?: Place): void {
  const { pan } = P(place);
  const v = e.voice({ bus: 'effects', duration: 2.2, priority: Priority.Event, pan: pan * 0.5, reverb: 0.35 });
  if (!v) return;
  for (const detune of [-12, 0, 12]) e.tone(v.out, v.t, { type: 'sawtooth', freq: 110, detune, attack: 0.03, decay: 1.4, peak: 0.07, cutoff: 700, cutoffEnd: 150 });
  for (let i = 0; i < 2; i++) {
    e.tone(v.out, v.t + 0.25 + i * 0.6, { type: 'square', freq: 466.2, decay: 0.22, peak: 0.04, cutoff: 1800 });
    e.tone(v.out, v.t + 0.55 + i * 0.6, { type: 'square', freq: 349.2, decay: 0.22, peak: 0.04, cutoff: 1800 });
  }
}

/** Ticking while a bomb threat stands (tick/tock alternates). */
export function bombTick(e: AudioEngine, tock: boolean, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.08, priority: Priority.Detail, pan, gain: gain * 0.4 });
  if (!v) return;
  e.tone(v.out, v.t, { freq: tock ? 1500 : 1900, decay: 0.03, peak: 0.12 });
  e.burst(v.out, v.t, { freq: 5000, q: 2, decay: 0.008, peak: 0.08 });
}

/** Cockroaches: a scurry of tiny clicks drifting across the stereo field. */
export function skitter(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.6, priority: Priority.World, pan, gain: Math.max(0.3, gain) * 0.6 });
  if (!v) return;
  let t = v.t;
  const count = 10 + Math.floor(Math.random() * 12);
  for (let i = 0; i < count; i++) {
    t += 0.012 + Math.random() * 0.022;
    e.burst(v.out, t, { filter: 'highpass', freq: 4000 + Math.random() * 4000, q: 0.7, attack: 0.001, decay: 0.004, peak: 0.12 + Math.random() * 0.1 });
  }
}

/** VIP arrival: an elegant plucked major-ninth arpeggio. */
export function vipChime(e: AudioEngine): void {
  const v = e.voice({ bus: 'effects', duration: 2, priority: Priority.Event, reverb: 0.45 });
  if (!v) return;
  for (const [i, f] of [523.3, 659.3, 784, 987.8, 1174.7].entries()) {
    e.tone(v.out, v.t + i * 0.09, { type: 'triangle', freq: f, decay: 1.1, peak: 0.08 });
    e.tone(v.out, v.t + i * 0.09, { freq: f * 2, decay: 0.3, peak: 0.03 });
  }
}

/** Blackout: a falling power-down whine and a relay clack. */
export function powerDown(e: AudioEngine): void {
  const v = e.voice({ bus: 'effects', duration: 1.6, priority: Priority.Event, reverb: 0.3 });
  if (!v) return;
  e.burst(v.out, v.t, { freq: 3000, q: 2, decay: 0.03, peak: 0.3 });
  e.tone(v.out, v.t, { type: 'sawtooth', freq: 240, freqEnd: 30, attack: 0.01, decay: 1.3, peak: 0.07, cutoff: 1200, cutoffEnd: 120 });
  e.tone(v.out, v.t, { freq: 120, freqEnd: 40, decay: 1.1, peak: 0.2 });
}

/** Power restored: relay clack, rising hum and a fluorescent "tink". */
export function powerUp(e: AudioEngine): void {
  const v = e.voice({ bus: 'effects', duration: 1.4, priority: Priority.Event, reverb: 0.3 });
  if (!v) return;
  e.burst(v.out, v.t, { freq: 2800, q: 2, decay: 0.03, peak: 0.3 });
  e.tone(v.out, v.t, { type: 'sawtooth', freq: 40, freqEnd: 120, attack: 0.3, decay: 0.8, peak: 0.06, cutoff: 500 });
  for (let i = 0; i < 3; i++) e.bell(v.out, v.t + 0.35 + i * 0.12 + Math.random() * 0.05, 3200 + i * 300, 0.03, 0.12, [[1, 1]]);
}

/** Someone gives up waiting: a soft breathy sigh. */
export function sigh(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.9, priority: Priority.Detail, pan, gain: gain * 0.7, reverb: 0.1 });
  if (!v) return;
  e.burst(v.out, v.t, { color: 'pink', freq: 1300, freqEnd: 650, q: 3, attack: 0.15, decay: 0.6, peak: 0.12 });
  e.burst(v.out, v.t, { color: 'pink', freq: 600, freqEnd: 380, q: 4, attack: 0.15, decay: 0.6, peak: 0.08 });
}

// -------------------------------------------------------------- seasonal

/** Sleigh bells: a shaken cluster of tiny jingles. */
export function sleighBells(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'effects', duration: 0.5, priority: Priority.World, pan, gain: gain * 0.5, reverb: 0.25 });
  if (!v) return;
  for (let i = 0; i < 7; i++) {
    const f = 3800 + Math.random() * 1800;
    e.bell(v.out, v.t + Math.random() * 0.07, f, 0.035, 0.18, [[1, 1], [1.37, 0.6], [2.13, 0.3]]);
  }
}

/** Halloween: a detuned diminished chord with a slow swell. */
export function spookyChord(e: AudioEngine, place?: Place): void {
  const { pan } = P(place);
  const v = e.voice({ bus: 'effects', duration: 3.8, priority: Priority.World, pan: pan * 0.5, gain: 0.8, reverb: 0.6 });
  if (!v) return;
  for (const f of [146.8, 174.6, 207.7, 246.9, 293.7]) {
    for (const detune of [-9, 9]) e.tone(v.out, v.t, { type: 'triangle', freq: f, freqEnd: f * 0.97, detune, attack: 0.9, decay: 2.6, peak: 0.035, cutoff: 1400 });
  }
  e.tone(v.out, v.t + 0.4, { freq: 1174.7, freqEnd: 1108.7, attack: 0.6, decay: 2.2, peak: 0.015 });
}

// -------------------------------------------------------------- ambient details

export function keyboard(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const keys = 3 + Math.floor(Math.random() * 7);
  const v = e.voice({ bus: 'ambience', duration: keys * 0.12 + 0.1, priority: Priority.Detail, pan, gain: gain * 1.0 });
  if (!v) return;
  let t = v.t;
  for (let i = 0; i < keys; i++) {
    t += 0.06 + Math.random() * 0.08;
    e.burst(v.out, t, { freq: 2500 + Math.random() * 1500, q: 2.5, attack: 0.001, decay: 0.012, peak: 0.12 });
  }
}

/** A distant desk phone: a soft electronic trill. */
export function phone(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'ambience', duration: 1.6, priority: Priority.Detail, pan, gain: gain * 0.3, reverb: 0.3 });
  if (!v) return;
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 10; i++) {
      e.tone(v.out, v.t + ring * 0.75 + i * 0.05, { freq: i % 2 ? 1250 : 1560, decay: 0.04, peak: 0.05, cutoff: 2200 });
    }
  }
}

export function cutlery(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const v = e.voice({ bus: 'ambience', duration: 0.4, priority: Priority.Detail, pan: pan + (Math.random() - 0.5) * 0.3, gain: gain * 0.5, reverb: 0.2 });
  if (!v) return;
  const hits = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < hits; i++) e.bell(v.out, v.t + i * 0.07, 3000 + Math.random() * 2500, 0.04, 0.2, [[1, 1], [1.6, 0.5], [2.7, 0.25]]);
}

/** A bird call: a few fast pitch-swept chirps. */
export function bird(e: AudioEngine, place?: Place): void {
  const { pan, gain } = P(place);
  const notes = 2 + Math.floor(Math.random() * 4);
  const v = e.voice({ bus: 'ambience', duration: notes * 0.14 + 0.2, priority: Priority.Detail, pan, gain: gain * 0.5, reverb: 0.25 });
  if (!v) return;
  const base = 2600 + Math.random() * 1800;
  const up = Math.random() < 0.5;
  for (let i = 0; i < notes; i++) {
    const f = base * (1 + (Math.random() - 0.5) * 0.15);
    e.tone(v.out, v.t + i * (0.09 + Math.random() * 0.05), { freq: up ? f * 0.8 : f * 1.2, freqEnd: up ? f * 1.25 : f * 0.75, attack: 0.01, decay: 0.06, peak: 0.06 });
  }
}

/** A car passing on the street: a swelling, panning tyre-and-engine whoosh. */
export function carPass(e: AudioEngine, gain: number): void {
  const length = 2 + Math.random() * 1.5;
  const v = e.voice({ bus: 'ambience', duration: length + 0.2, priority: Priority.Detail, gain: gain * 0.5 });
  if (!v) return;
  const panner = v.ctx.createStereoPanner();
  const from = Math.random() < 0.5 ? -0.8 : 0.8;
  panner.pan.setValueAtTime(from, v.t);
  panner.pan.linearRampToValueAtTime(-from, v.t + length);
  panner.connect(v.out);
  const g = v.ctx.createGain(); g.gain.value = 1; g.connect(panner);
  e.burst(g, v.t, { color: 'pink', freq: 500, freqEnd: 350, q: 0.8, attack: length * 0.5, decay: length * 0.5, peak: 0.18 });
  e.tone(g, v.t, { type: 'sawtooth', freq: 70 + Math.random() * 30, freqEnd: 55, attack: length * 0.5, decay: length * 0.5, peak: 0.03, cutoff: 260 });
  setTimeout(() => { panner.disconnect(); g.disconnect(); }, (length + 0.5) * 1000);
}

export function thunder(e: AudioEngine): void {
  const v = e.voice({ bus: 'ambience', duration: 4, priority: Priority.Detail, gain: 0.35, pan: (Math.random() - 0.5) * 0.8, reverb: 0.4 });
  if (!v) return;
  e.burst(v.out, v.t, { color: 'brown', filter: 'lowpass', freq: 380, freqEnd: 90, attack: 0.25, decay: 3.2, peak: 0.6 });
  e.burst(v.out, v.t + 0.15, { color: 'brown', filter: 'lowpass', freq: 220, attack: 0.1, decay: 1.4, peak: 0.4 });
}

