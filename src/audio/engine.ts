import { Priority, VoicePool, busGains, type Preferences } from './mix';

/**
 * Small Web Audio engine: three buses (ambience, effects, interface) into a
 * master gain, a gentle glue compressor and a brick-wall limiter, plus one
 * shared convolution reverb whose impulse response is generated here. All
 * sources are oscillators or short procedurally generated noise buffers.
 */

export type Bus = 'ambience' | 'effects' | 'ui';
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface VoiceOptions {
  bus: Bus;
  /** Seconds the voice lasts (for voice limiting and cleanup). */
  duration: number;
  gain?: number;
  pan?: number;
  /** Send level into the shared reverb (0..1). */
  reverb?: number;
  priority?: Priority;
  /** Start delay in seconds. */
  delay?: number;
}

export interface Voice { ctx: AudioContext; out: AudioNode; t: number }

export interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Glide target (exponential) reached at the end of the note. */
  freqEnd?: number;
  detune?: number;
  attack?: number;
  decay: number;
  peak: number;
  /** Optional lowpass on the tone (with optional sweep). */
  cutoff?: number;
  cutoffEnd?: number;
  q?: number;
}

export interface NoiseOptions {
  color?: NoiseColor;
  filter?: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
  decay: number;
  peak: number;
  /** Playback rate (pitch/texture) of the noise buffer. */
  rate?: number;
}

const SILENT = 0.0001;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly buses: Record<Bus, GainNode>;
  readonly master: GainNode;
  readonly reverbIn: GainNode;
  readonly voices = new VoicePool(28);
  private readonly noises = new Map<NoiseColor, AudioBuffer>();
  /** Multiplier on the ambience bus (fades out while paused). */
  private ambienceFade = 1;
  private prefs: Preferences;

  constructor(ctx: AudioContext, prefs: Preferences) {
    this.ctx = ctx;
    this.prefs = prefs;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.3;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.connect(glue); glue.connect(limiter); limiter.connect(ctx.destination);
    this.buses = { ambience: ctx.createGain(), effects: ctx.createGain(), ui: ctx.createGain() };
    for (const bus of Object.values(this.buses)) bus.connect(this.master);
    // Shared reverb: a generated stereo impulse response (dark, ~1.7 s).
    this.reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = this.impulse(1.7);
    const reverbOut = ctx.createGain(); reverbOut.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200;
    this.reverbIn.connect(tone); tone.connect(convolver); convolver.connect(reverbOut); reverbOut.connect(this.master);
    this.apply(prefs, true);
  }

  /** Re-level buses from the preferences (smoothly unless `now`). */
  apply(prefs: Preferences, now = false): void {
    this.prefs = prefs;
    const g = busGains(prefs);
    this.set(this.master.gain, g.master, now ? 0 : 0.05);
    this.set(this.buses.effects.gain, g.effects, now ? 0 : 0.05);
    this.set(this.buses.ui.gain, g.ui, now ? 0 : 0.05);
    this.set(this.buses.ambience.gain, g.ambience * this.ambienceFade, now ? 0 : 0.05);
  }

  /** Fade the ambience bus (0 while paused, 1 while playing). */
  fadeAmbience(level: number, seconds = 0.6): void {
    if (Math.abs(level - this.ambienceFade) < 0.001) return;
    this.ambienceFade = level;
    this.set(this.buses.ambience.gain, busGains(this.prefs).ambience * level, seconds / 3);
  }

  get now(): number { return this.ctx.currentTime; }

  /** Smoothly move an AudioParam (time constant `tau`; 0 = immediate). */
  set(param: AudioParam, value: number, tau = 0.1): void {
    if (tau <= 0) { param.value = value; return; }
    param.setTargetAtTime(value, this.ctx.currentTime, tau);
  }

  /** A procedurally generated noise buffer (2 s, looped by sources). */
  noise(color: NoiseColor): AudioBuffer {
    let buffer = this.noises.get(color);
    if (buffer) return buffer;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * 2));
    buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    fillNoise(buffer.getChannelData(0), color);
    this.noises.set(color, buffer);
    return buffer;
  }

  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / length;
        // Exponential decay; a one-pole lowpass that closes over time darkens the tail.
        const k = 0.65 - 0.5 * t;
        low += k * ((Math.random() * 2 - 1) - low);
        const early = i < rate * 0.012 ? 0 : 1;
        data[i] = low * Math.pow(1 - t, 2.4) * early;
      }
    }
    return buffer;
  }

  /**
   * Open a voice: returns the node to connect sound sources into, already
   * panned, levelled and routed (with a reverb send), or null when the voice
   * limit refuses it. The chain disconnects itself after `duration`.
   */
  voice(o: VoiceOptions): Voice | null {
    const ctx = this.ctx;
    // Inaudible (far off screen): don't spend a voice on it.
    if (ctx.state !== 'running' || (o.gain ?? 1) < 0.01) return null;
    const t = ctx.currentTime + 0.01 + (o.delay ?? 0);
    if (!this.voices.acquire(ctx.currentTime, o.duration + (o.delay ?? 0), o.priority ?? Priority.World)) return null;
    const out = ctx.createGain(); out.gain.value = o.gain ?? 1;
    const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    out.connect(panner); panner.connect(this.buses[o.bus]);
    let send: GainNode | null = null;
    if (o.reverb) { send = ctx.createGain(); send.gain.value = o.reverb; panner.connect(send); send.connect(this.reverbIn); }
    const life = (o.duration + (o.delay ?? 0) + 0.3) * 1000;
    setTimeout(() => { out.disconnect(); panner.disconnect(); send?.disconnect(); }, life);
    return { ctx, out, t };
  }

  /** An enveloped oscillator note into `dest`, starting at `t`. */
  tone(dest: AudioNode, t: number, o: ToneOptions): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.detune) osc.detune.value = o.detune;
    const attack = o.attack ?? 0.005;
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + attack + o.decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENT, t);
    env.gain.linearRampToValueAtTime(o.peak, t + attack);
    env.gain.exponentialRampToValueAtTime(SILENT, t + attack + o.decay);
    let head: AudioNode = env;
    let filter: BiquadFilterNode | null = null;
    if (o.cutoff) {
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = o.q ?? 0.7;
      filter.frequency.setValueAtTime(o.cutoff, t);
      if (o.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.cutoffEnd), t + attack + o.decay);
      osc.connect(filter); filter.connect(env); head = env;
    } else osc.connect(env);
    head.connect(dest);
    osc.onended = () => { osc.disconnect(); filter?.disconnect(); env.disconnect(); };
    osc.start(t); osc.stop(t + attack + o.decay + 0.02);
  }

  /** An enveloped, filtered noise burst into `dest`, starting at `t`. */
  burst(dest: AudioNode, t: number, o: NoiseOptions): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(o.color ?? 'white');
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const filter = ctx.createBiquadFilter(); filter.type = o.filter ?? 'bandpass'; filter.Q.value = o.q ?? 1;
    const attack = o.attack ?? 0.003;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + attack + o.decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENT, t);
    env.gain.linearRampToValueAtTime(o.peak, t + attack);
    env.gain.exponentialRampToValueAtTime(SILENT, t + attack + o.decay);
    src.connect(filter); filter.connect(env); env.connect(dest);
    src.onended = () => { src.disconnect(); filter.disconnect(); env.disconnect(); };
    // Random offset so repeated bursts never sound identical.
    src.start(t, Math.random() * 1.5); src.stop(t + attack + o.decay + 0.02);
  }

  /** An inharmonic struck-metal tone (bells, chimes) from partial ratios/levels. */
  bell(dest: AudioNode, t: number, freq: number, peak: number, decay: number, partials: [number, number][]): void {
    for (const [ratio, level] of partials) {
      this.tone(dest, t, { freq: freq * ratio, peak: peak * level, attack: 0.002, decay: decay / Math.sqrt(ratio) });
    }
  }
}

/** Fill a buffer with white, pink (Paul Kellet's economy filter) or brown noise. */
export function fillNoise(data: Float32Array, color: NoiseColor, random: () => number = Math.random): void {
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    if (color === 'white') data[i] = white * 0.9;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    } else {
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.5;
    }
  }
  // Tilt the buffer so its last sample meets its first: loops never click.
  if (color !== 'white' && data.length > 1) {
    const step = (data[data.length - 1]! - data[0]!) / (data.length - 1);
    for (let i = 0; i < data.length; i++) data[i] = data[i]! - step * i;
  }
}
