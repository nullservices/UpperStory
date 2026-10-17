import type { AudioEngine, Bus, NoiseColor } from './engine';

/**
 * Continuous ambience beds: looping filtered noise and slow oscillators,
 * each behind one level gain (and optional stereo panner). Levels move with
 * long time constants so the soundscape breathes rather than jumps; a bed
 * only receives an automation call when its target actually changes.
 */

class Bed {
  private level = 0;
  private panValue = 0;
  constructor(private readonly engine: AudioEngine, readonly gain: GainNode, private readonly panner: StereoPannerNode | null, private readonly tau: number) {}

  set(level: number, pan = 0): void {
    const ctx = this.engine.ctx;
    if (Math.abs(level - this.level) > 0.002 || (level === 0 && this.level !== 0)) {
      this.level = level;
      this.gain.gain.setTargetAtTime(level, ctx.currentTime, this.tau);
    }
    if (this.panner && Math.abs(pan - this.panValue) > 0.02) {
      this.panValue = pan;
      this.panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.5);
    }
  }

  get current(): number { return this.level; }
}

export type BedName = 'office' | 'crowd' | 'traffic' | 'night' | 'rain' | 'machine' | 'motor' | 'fire' | 'rotor';

export class AmbienceBeds {
  private readonly beds = new Map<BedName, Bed>();
  private motorOscillators: OscillatorNode[] = [];
  private rotorLfo?: OscillatorNode;
  private turbine?: GainNode;

  constructor(private readonly e: AudioEngine) {
    this.build();
  }

  set(name: BedName, level: number, pan = 0): void { this.beds.get(name)?.set(level, pan); }
  level(name: BedName): number { return this.beds.get(name)?.current ?? 0; }

  /** Elevator motor pitch rises a little with the number of moving cars. */
  motorPitch(cars: number): void {
    const f = 62 + 8 * Math.min(4, cars);
    for (const [i, osc] of this.motorOscillators.entries()) osc.frequency.setTargetAtTime(f * (i ? 1.012 : 1), this.e.ctx.currentTime, 0.8);
  }

  /** Helicopter rotor speed 0..1: blade rate and turbine whine. */
  rotor(speed: number): void {
    const now = this.e.ctx.currentTime;
    this.rotorLfo?.frequency.setTargetAtTime(3 + 15 * speed, now, 0.3);
    this.turbine?.gain.setTargetAtTime(0.025 * speed, now, 0.3);
  }

  private bed(name: BedName, bus: Bus, panned: boolean, tau = 0.8): GainNode {
    const ctx = this.e.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    let panner: StereoPannerNode | null = null;
    if (panned) { panner = ctx.createStereoPanner(); gain.connect(panner); panner.connect(this.e.buses[bus]); }
    else gain.connect(this.e.buses[bus]);
    this.beds.set(name, new Bed(this.e, gain, panner, tau));
    return gain;
  }

  private noise(color: NoiseColor, rate = 1): AudioBufferSourceNode {
    const src = this.e.ctx.createBufferSource();
    src.buffer = this.e.noise(color); src.loop = true; src.playbackRate.value = rate;
    src.start(this.e.ctx.currentTime, Math.random() * 1.5);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.e.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  /** A gain whose level wobbles around `base` by `depth` at `rate` Hz. */
  private wobble(base: number, depth: number, rate: number, shape: OscillatorType = 'sine'): { amp: GainNode; lfo: OscillatorNode } {
    const ctx = this.e.ctx;
    const amp = ctx.createGain(); amp.gain.value = base;
    const lfo = ctx.createOscillator(); lfo.type = shape; lfo.frequency.value = rate;
    const d = ctx.createGain(); d.gain.value = depth;
    lfo.connect(d); d.connect(amp.gain); lfo.start();
    return { amp, lfo };
  }

  private osc(type: OscillatorType, freq: number, level: number, dest: AudioNode): OscillatorNode {
    const ctx = this.e.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = level;
    o.connect(g); g.connect(dest); o.start();
    return o;
  }

  private build(): void {
    // Office: a soft air-conditioned room tone with a slow murmur and a faint mains hum.
    {
      const out = this.bed('office', 'ambience', true);
      const { amp } = this.wobble(0.75, 0.25, 0.11);
      const band = this.filter('bandpass', 750, 0.5), low = this.filter('lowpass', 2400);
      this.noise('pink').connect(band); band.connect(low); low.connect(amp); amp.connect(out);
      this.osc('sine', 120, 0.05, out);
    }
    // Crowd babble: formant bands of pink noise, each fluttering at a syllable rate.
    {
      const out = this.bed('crowd', 'ambience', true);
      for (const [f, rate, q] of [[280, 2.7, 2], [520, 3.9, 2.5], [1050, 5.3, 3], [1900, 6.7, 3]] as const) {
        const band = this.filter('bandpass', f, q);
        const { amp } = this.wobble(0.55, 0.45, rate * (0.9 + Math.random() * 0.2));
        this.noise('pink', 0.9 + Math.random() * 0.2).connect(band); band.connect(amp); amp.connect(out);
      }
    }
    // Street traffic: a low, slowly swelling rumble.
    {
      const out = this.bed('traffic', 'ambience', false, 1.2);
      const low = this.filter('lowpass', 420);
      const { amp } = this.wobble(0.7, 0.3, 0.05);
      this.noise('brown').connect(low); low.connect(amp); amp.connect(out);
      const hiss = this.filter('bandpass', 1200, 0.6);
      const hissGain = this.e.ctx.createGain(); hissGain.gain.value = 0.12;
      this.noise('pink').connect(hiss); hiss.connect(hissGain); hissGain.connect(out);
    }
    // Night: crickets (pulsed high tones in chirp groups).
    {
      const out = this.bed('night', 'ambience', false, 1.5);
      const chirp = this.wobble(0.5, 0.5, 31, 'square');
      const groups = this.wobble(0.5, 0.5, 0.85, 'square');
      this.osc('sine', 4400, 0.6, chirp.amp); this.osc('sine', 4730, 0.4, chirp.amp);
      chirp.amp.connect(groups.amp); groups.amp.connect(out);
    }
    // Rain: hiss plus a soft low wash.
    {
      const out = this.bed('rain', 'ambience', false, 1.5);
      const hp = this.filter('highpass', 600), lp = this.filter('lowpass', 6500);
      this.noise('white').connect(hp); hp.connect(lp); lp.connect(out);
      const wash = this.filter('lowpass', 260);
      const washGain = this.e.ctx.createGain(); washGain.gain.value = 0.9;
      this.noise('brown').connect(wash); wash.connect(washGain); washGain.connect(out);
    }
    // Elevator machinery: low mains-harmonic hum near the shafts.
    {
      const out = this.bed('machine', 'ambience', true);
      const low = this.filter('lowpass', 320);
      low.connect(out);
      this.osc('sine', 50, 0.6, low); this.osc('sine', 100, 0.35, low); this.osc('triangle', 150.5, 0.12, low);
    }
    // Moving cars: a soft motor drone.
    {
      const out = this.bed('motor', 'ambience', true, 0.4);
      const low = this.filter('lowpass', 230, 2.5);
      low.connect(out);
      this.motorOscillators = [this.osc('sawtooth', 62, 0.5, low), this.osc('sawtooth', 62.7, 0.5, low)];
      const whine = this.filter('bandpass', 900, 6);
      const whineGain = this.e.ctx.createGain(); whineGain.gain.value = 0.15;
      this.noise('pink').connect(whine); whine.connect(whineGain); whineGain.connect(out);
    }
    // Fire roar (world effect).
    {
      const out = this.bed('fire', 'effects', true, 0.6);
      const band = this.filter('bandpass', 320, 0.7);
      const { amp } = this.wobble(0.7, 0.3, 0.45);
      this.noise('brown').connect(band); band.connect(amp); amp.connect(out);
    }
    // Helicopter rotor: band-limited noise chopped at the blade rate, plus turbine whine.
    {
      const out = this.bed('rotor', 'effects', true, 0.4);
      const band = this.filter('bandpass', 170, 1.1);
      const chop = this.wobble(0.45, 0.55, 18, 'triangle');
      this.rotorLfo = chop.lfo;
      this.noise('pink').connect(band); band.connect(chop.amp); chop.amp.connect(out);
      const thump = this.filter('lowpass', 90);
      this.noise('brown').connect(thump); thump.connect(chop.amp);
      this.turbine = this.e.ctx.createGain(); this.turbine.gain.value = 0; this.turbine.connect(out);
      this.osc('sine', 1650, 1, this.turbine);
    }
  }
}
