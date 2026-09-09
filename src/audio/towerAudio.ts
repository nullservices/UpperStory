import type { GameState } from '../sim/state';
import type { SimEvent } from '../sim/core/events';

const KEY = 'upper-story-audio';
type Cue = 'click' | 'build' | 'demolish' | 'door' | 'ready' | 'alert' | 'rating';
interface Preferences { muted: boolean; volume: number; ambience: number }

/** Original synthesized sound. Audio never consumes the simulation's random stream. */
export class TowerAudio {
  readonly preferences: Preferences = { muted: false, volume: 0.35, ambience: 0.25 };
  private context?: AudioContext;
  private master?: GainNode;
  private motor?: GainNode;
  private rain?: GainNode;
  private noise?: AudioBuffer;
  private lastCue = new Map<Cue, number>();
  private cars = new Map<number, string>();
  private incidents = new Set<number>();
  private state?: GameState;
  private revision = 0;
  private structureSize = 0;
  private voices = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (typeof saved.muted === 'boolean') this.preferences.muted = saved.muted;
      for (const key of ['volume', 'ambience'] as const) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) this.preferences[key] = Math.max(0, Math.min(1, saved[key]));
      }
    } catch { /* Storage can be disabled. */ }
    document.addEventListener('pointerdown', () => { void this.unlock(); }, { capture: true });
    document.addEventListener('keydown', () => { void this.unlock(); }, { capture: true });
    document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('button, input[type="checkbox"], summary')) this.play('click');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.context?.suspend().catch(() => {});
      else if (!this.preferences.muted) void this.context?.resume().catch(() => {});
    });
    window.addEventListener('pagehide', () => { void this.context?.suspend().catch(() => {}); });
  }

  async unlock(): Promise<void> {
    if (this.preferences.muted || document.hidden) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext(); this.context = ctx;
        this.master = ctx.createGain(); this.master.gain.value = this.preferences.volume;
        const limiter = ctx.createDynamicsCompressor();
        this.master.connect(limiter); limiter.connect(ctx.destination);
        this.motor = ctx.createGain(); this.motor.gain.value = 0; this.motor.connect(this.master);
        for (const frequency of [58, 116]) {
          const oscillator = ctx.createOscillator(); oscillator.frequency.value = frequency;
          oscillator.connect(this.motor); oscillator.start();
        }
        this.rain = ctx.createGain(); this.rain.gain.value = 0; this.rain.connect(this.master);
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        this.noise = buffer;
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1400;
        source.connect(filter); filter.connect(this.rain); source.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio support or autoplay restrictions must never stop the game. */ }
  }

  configure(patch: Partial<Preferences>): void {
    Object.assign(this.preferences, patch);
    try { localStorage.setItem(KEY, JSON.stringify(this.preferences)); } catch { /* Optional persistence. */ }
    const ctx = this.context;
    if (ctx && this.master) this.master.gain.setTargetAtTime(this.preferences.muted ? 0 : this.preferences.volume, ctx.currentTime, 0.03);
    if (!this.preferences.muted) void this.unlock();
  }

  play(cue: Cue, pan = 0): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.master || this.preferences.muted || this.voices >= 12) return;
    const now = ctx.currentTime;
    const cooldown = cue === 'door' ? 0.45 : cue === 'build' ? 0.12 : cue === 'alert' ? 2 : 0.08;
    if (now - (this.lastCue.get(cue) ?? -Infinity) < cooldown) return;
    this.lastCue.set(cue, now);
    if ((cue === 'build' || cue === 'demolish' || cue === 'door') && this.noise) {
      const source = ctx.createBufferSource(); source.buffer = this.noise;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.value = cue === 'door' ? 1800 : 600;
      const envelope = ctx.createGain(); envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      source.connect(filter); filter.connect(envelope); envelope.connect(this.master);
      source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
      source.start(now); source.stop(now + 0.2);
    }
    const notes: Record<Cue, number[]> = {
      click: [560], build: [140, 210], demolish: [100, 55], door: [880, 660],
      ready: [523, 659], alert: [440, 330, 440], rating: [523, 659, 784, 1047],
    };
    const length = cue === 'click' ? 0.045 : cue === 'build' || cue === 'demolish' ? 0.09 : 0.22;
    for (const [i, frequency] of notes[cue].entries()) {
      const start = now + i * length * 0.8;
      const oscillator = ctx.createOscillator();
      oscillator.type = cue === 'build' || cue === 'demolish' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (cue === 'demolish') oscillator.frequency.exponentialRampToValueAtTime(30, start + length);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(cue === 'click' ? 0.08 : 0.16, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      const stereo = ctx.createStereoPanner(); stereo.pan.value = Math.max(-1, Math.min(1, pan));
      oscillator.connect(gain); gain.connect(stereo); stereo.connect(this.master);
      this.voices++;
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); stereo.disconnect(); this.voices--; };
      oscillator.start(start); oscillator.stop(start + length + 0.01);
    }
  }

  events(events: SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'LEVEL_UP') this.play('rating');
      else if (event.type === 'TENANT_COMPLETED') this.play('ready');
      else if (event.type === 'QUARTER_REPORT') this.play('ready');
    }
  }

  update(state: GameState, active: boolean, view: { x: number; y: number; zoom: number; width: number; height: number }): void {
    const fresh = state !== this.state;
    if (fresh) { this.state = state; this.cars.clear(); this.incidents.clear(); }
    if (fresh || state.tower.structureRevision !== this.revision) {
      let size = state.tower.floors.length + state.tenants.size;
      for (const floor of state.tower.floors) for (const cell of floor.cells) if (cell.content === 'stair' || cell.content === 'escalator') size++;
      for (const group of state.elevatorGroups.values()) size += group.serviceHi - group.serviceLo + 1 + group.cars.reduce((sum, car) => sum + car.speedLevel, 0);
      if (!fresh && size !== this.structureSize) this.play(size < this.structureSize ? 'demolish' : 'build');
      this.structureSize = size;
      this.revision = state.tower.structureRevision;
    }
    let moving = 0;
    const present = new Set<number>();
    for (const group of state.elevatorGroups.values()) for (const car of group.cars) {
      present.add(car.id);
      const x = view.x + group.x * 12 * view.zoom;
      const y = view.y + (car.y <= 0 ? -car.y * 20 : -(car.y + 1) * 20) * view.zoom;
      const visible = x > 200 && x < view.width && y > 94 && y < view.height;
      if (visible && active) {
        if (car.state === 'moving') moving++;
        if (!fresh && car.state === 'doors' && this.cars.get(car.id) !== 'doors') this.play('door', x / view.width * 2 - 1);
      }
      this.cars.set(car.id, car.state);
    }
    for (const id of this.cars.keys()) if (!present.has(id)) this.cars.delete(id);
    for (const incident of state.campaign.incidents) if (!this.incidents.has(incident.id)) {
      if (!fresh) this.play('alert');
      this.incidents.add(incident.id);
    }
    this.incidents = new Set(state.campaign.incidents.map(i => i.id));
    const ctx = this.context;
    if (ctx) {
      const amount = active && !document.hidden ? this.preferences.ambience : 0;
      this.motor?.gain.setTargetAtTime(Math.min(moving, 4) * 0.008 * amount, ctx.currentTime, 0.15);
      this.rain?.gain.setTargetAtTime(state.campaign.weather === 'rain' && view.y > 94 ? 0.15 * amount : 0, ctx.currentTime, 0.3);
    }
  }
}
