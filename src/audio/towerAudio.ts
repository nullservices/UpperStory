import type { GameState } from '../sim/state';
import type { Tenant } from '../sim/tenants';
import type { SimEvent } from '../sim/core/events';
import { carWorldY, shaftWidth } from '../sim/elevators';
import { floorTopY } from '../sim/tower';
import { CONFIG } from '../data/config';
import { ambient } from '../render/ambient';
import { animTime } from '../render/animClock';
import { AudioEngine } from './engine';
import { AmbienceBeds } from './ambience';
import {
  HeliTracker, RateLimiter, SILENT_MIX, ambienceMix, blackoutOn, chance, clamp, heliPose, sanitizePreferences, spatial, spatialWorld,
  tenantBox, type AmbienceMix, type Preferences, type View,
} from './mix';
import * as S from './sounds';

const KEY = 'upper-story-audio';
/** Named cues other modules (the Sound window) can preview. */
export type Cue = 'click' | 'tool' | 'place' | 'demolish' | 'error' | 'door' | 'bell' | 'ready' | 'alert' | 'rating' | 'tower' | 'cash' | 'notify';
export type { Preferences } from './mix';

const MIX_INTERVAL = 0.25;
const FORCED_FLYOVER = typeof window !== 'undefined' && typeof URLSearchParams !== 'undefined' && window.location
  ? new URLSearchParams(window.location.search).get('flyover') : null;

interface CarMemory { state: string; broken: boolean }

/**
 * The tower's sound: original synthesized ambience, world effects and
 * interface feedback, driven by sim events (per tick) and a read-only look
 * at the state (per frame). Audio never consumes the simulation's random
 * stream and never writes to the state.
 */
export class TowerAudio {
  readonly preferences: Preferences;
  private engine?: AudioEngine;
  private beds?: AmbienceBeds;
  private readonly limiter = new RateLimiter();
  private readonly heli = new HeliTracker();
  private state?: GameState;
  private view: View = { x: 0, y: 0, zoom: 1, width: 1280, height: 720 };
  private revision = 0;
  private structureSize = 0;
  private readonly cars = new Map<number, CarMemory>();
  private incidents = new Set<number>();
  private blackout = false;
  private wedding = false;
  private mix: AmbienceMix = SILENT_MIX;
  private mixAge = Infinity;
  private mixView: View = { x: 0, y: 0, zoom: 1, width: 0, height: 0 };
  private lastFrame = -1;
  private pointerX = -1;
  private notifyPending = false;
  private eventCueThisFrame = false;
  private alarmAt = 0;
  private tickTock = false;
  private flyerWasVisible = false;
  private toastObserved = false;
  private toastProbe = 0;

  constructor() {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* Storage can be disabled. */ }
    this.preferences = sanitizePreferences(saved);
    document.addEventListener('pointerdown', event => {
      if (typeof event?.clientX === 'number') this.pointerX = event.clientX;
      void this.unlock();
    }, { capture: true });
    document.addEventListener('keydown', () => { void this.unlock(); }, { capture: true });
    document.addEventListener('click', event => {
      const target = event?.target;
      if (typeof Element === 'undefined' || !(target instanceof Element)) return;
      // Palette buttons sound through toolChanged() (also covers keyboard shortcuts).
      if (target.closest('.tool-grid button')) return;
      if (target.closest('button, input[type="checkbox"], summary, [role="menuitem"]')) this.play('click');
    });
    document.addEventListener('visibilitychange', () => {
      const ctx = this.engine?.ctx;
      if (document.hidden) void ctx?.suspend().catch(() => {});
      else if (!this.preferences.muted) void ctx?.resume().catch(() => {});
    });
    window.addEventListener('pagehide', () => { void this.engine?.ctx.suspend().catch(() => {}); });
  }

  /** Create or resume the audio context (browsers require a user gesture first). */
  async unlock(): Promise<void> {
    if (this.preferences.muted || document.hidden) return;
    try {
      if (!this.engine) {
        const engine = new AudioEngine(new AudioContext(), this.preferences);
        this.engine = engine;
        this.beds = new AmbienceBeds(engine);
        this.mixAge = Infinity;
      }
      this.observeToasts();
      if (this.engine.ctx.state === 'suspended') await this.engine.ctx.resume();
    } catch { /* Audio support or autoplay restrictions must never stop the game. */ }
  }

  configure(patch: Partial<Preferences>): void {
    Object.assign(this.preferences, sanitizePreferences({ ...this.preferences, ...patch }));
    try { localStorage.setItem(KEY, JSON.stringify(this.preferences)); } catch { /* Optional persistence. */ }
    this.engine?.apply(this.preferences);
    if (this.preferences.muted) {
      const ctx = this.engine?.ctx;
      if (ctx) setTimeout(() => { if (this.preferences.muted) void ctx.suspend().catch(() => {}); }, 150);
    } else void this.unlock();
  }

  private get live(): AudioEngine | null {
    const e = this.engine;
    return e && e.ctx.state === 'running' && !this.preferences.muted ? e : null;
  }

  private get dpr(): number {
    return typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  }

  /** Pan for interface sounds: where the pointer last pressed. */
  private pointerPan(): number {
    return this.pointerX >= 0 ? clamp((this.pointerX / Math.max(1, this.view.width)) * 2 - 1, -1, 1) : 0;
  }

  /** The active build tool changed (palette click or keyboard shortcut): a soft select pip, rate-limited. */
  toolChanged(): void {
    this.play('tool');
  }

  /** Play a named cue (non-positional unless `pan` is given). */
  play(cue: Cue, pan?: number): void {
    const e = this.live;
    if (!e) return;
    const now = e.now;
    const cooldowns: Partial<Record<Cue, number>> = { click: 0.05, tool: 0.05, place: 0.07, demolish: 0.1, error: 0.25, door: 0.3, bell: 0.3, ready: 0.4, alert: 2, notify: 3, cash: 1, rating: 1, tower: 5 };
    if (!this.limiter.allow(`cue:${cue}`, now, cooldowns[cue] ?? 0.1)) return;
    const place = { pan: pan ?? this.pointerPan(), gain: 1 };
    switch (cue) {
      case 'click': S.uiClick(e); break;
      case 'tool': S.uiTool(e); break;
      case 'place': S.uiPlace(e, place); break;
      case 'demolish': S.uiDemolish(e, place); break;
      case 'error': S.uiError(e, place); break;
      case 'door': case 'bell': S.elevatorBell(e, 'standard', false, { pan: pan ?? 0 }); break;
      case 'ready': S.roomReady(e, { pan: pan ?? 0 }); break;
      case 'alert': S.bombAlert(e, { pan: pan ?? 0 }); break;
      case 'notify': S.uiNotify(e); break;
      case 'cash': S.cashRegister(e); break;
      case 'rating': S.fanfare(e); break;
      case 'tower': S.fanfare(e); S.weddingBells(e, 1.4); break;
    }
  }

  /** Sim events from one tick. */
  events(events: SimEvent[]): void {
    const e = this.live;
    for (const event of events) {
      if (!e) continue;
      const now = e.now;
      switch (event.type) {
        case 'LEVEL_UP':
          this.play(event.starLevel >= 6 ? 'tower' : 'rating');
          if (event.starLevel >= 6) this.limiter.touch('wedding', now);
          this.eventCueThisFrame = true;
          break;
        case 'TENANT_COMPLETED': {
          const tenant = this.state?.tenants.get(event.tenantId);
          if (!this.limiter.allow('ready', now, 0.4)) break;
          const place = tenant ? this.tenantPlace(tenant) : { pan: 0, gain: 1 };
          S.roomReady(e, place);
          break;
        }
        case 'QUARTER_REPORT':
          this.play('cash'); this.eventCueThisFrame = true;
          break;
        case 'MONEY_CHANGED':
          if (event.delta > 0 && this.limiter.allow('money', now, 1.4)) S.moneyPop(e, Math.log10(Math.max(1, event.delta)) / 7);
          break;
        case 'PERSON_GAVE_UP': {
          const rect = this.floorOnScreen(event.floor);
          if (rect && this.limiter.allow('sigh', now, 25)) S.sigh(e, { pan: (Math.random() - 0.5) * 0.6, gain: 0.8 });
          break;
        }
        case 'ALERT':
          if (!event.kind) this.notifyPending = true;
          break;
      }
    }
  }

  private floorOnScreen(floor: number): boolean {
    const lh = this.state?.tower.lobbyHeight ?? 1;
    const y = this.view.y + (floorTopY(floor, lh) + CONFIG.FLOOR_HEIGHT_PX / 2) * this.view.zoom;
    return y >= 0 && y <= this.view.height;
  }

  private tenantPlace(t: Tenant): { pan: number; gain: number } {
    const box = tenantBox(t, this.state?.tower.lobbyHeight ?? 1);
    return spatialWorld((box.left + box.right) / 2, (box.top + box.bottom) / 2, this.view, this.dpr);
  }

  /** Per frame: transitions, ambience and scheduled detail. `active` = the sim is running. */
  update(state: GameState, active: boolean, view: View): void {
    this.view = view;
    const fresh = state !== this.state;
    if (fresh) {
      this.state = state;
      this.cars.clear();
      this.incidents = new Set(state.campaign.incidents.map(i => i.id));
      this.blackout = blackoutOn(state);
      this.wedding = state.campaign.weddingHeld;
      this.revision = -1;
    }
    const e = this.live;
    const now = e?.now ?? 0;
    const dt = e && this.lastFrame >= 0 ? clamp(now - this.lastFrame, 0, 0.1) : 0;
    this.lastFrame = e ? now : -1;
    if (e && !this.toastObserved && now - this.toastProbe > 2) { this.toastProbe = now; this.observeToasts(); }

    this.trackStructure(state, fresh);
    this.trackCars(state, fresh, active);
    this.trackIncidents(state, fresh);
    this.trackPower(state, fresh);

    if (this.notifyPending) {
      this.notifyPending = false;
      if (!this.eventCueThisFrame) this.play('notify');
    }
    this.eventCueThisFrame = false;

    const beds = this.beds;
    if (!e || !beds) return;
    e.fadeAmbience(active && !document.hidden ? 1 : 0);
    this.mixAge += dt;
    // Re-mix on a timer, or at once when the camera jumps (map click, zoom).
    const mv = this.mixView;
    const jumped = Math.abs(view.x - mv.x) > view.width / 4 || Math.abs(view.y - mv.y) > view.height / 4 || view.zoom !== mv.zoom;
    if (this.mixAge >= MIX_INTERVAL || jumped) {
      this.mixAge = 0;
      this.mixView = { ...view };
      this.mix = ambienceMix(state, view, this.dpr);
      const m = this.mix;
      beds.set('office', m.office * 0.18, m.officePan);
      beds.set('crowd', m.crowd * 0.3, m.crowdPan);
      beds.set('traffic', m.traffic * 0.16);
      beds.set('night', m.night * 0.03);
      beds.set('rain', m.rain * 0.08);
      beds.set('machine', m.machine * 0.06, m.machinePan);
      beds.set('motor', m.motor * 0.06, m.motorPan);
      beds.motorPitch(m.motorCars);
    }
    this.worldLoops(state, active, dt);
    if (active) this.details(e, dt);
  }

  // ------------------------------------------------------------ transitions

  private trackStructure(state: GameState, fresh: boolean): void {
    if (!fresh && state.tower.structureRevision === this.revision) return;
    let size = state.tower.floors.length + state.tenants.size;
    for (const floor of state.tower.floors) for (const cell of floor.cells) if (cell.content === 'stair' || cell.content === 'escalator') size++;
    for (const group of state.elevatorGroups.values()) size += group.serviceHi - group.serviceLo + 1 + group.cars.reduce((sum, car) => sum + car.speedLevel, 0);
    if (!fresh && size !== this.structureSize) this.play(size < this.structureSize ? 'demolish' : 'place');
    this.structureSize = size;
    this.revision = state.tower.structureRevision;
  }

  private trackCars(state: GameState, fresh: boolean, active: boolean): void {
    const e = this.live;
    const lh = state.tower.lobbyHeight;
    const seen = new Set<number>();
    for (const group of state.elevatorGroups.values()) for (const car of group.cars) {
      seen.add(car.id);
      const before = this.cars.get(car.id);
      const broken = !!car.outOfService;
      if (e && before && !fresh) {
        const wx = (group.x + shaftWidth(group) / 2) * CONFIG.CELL_WIDTH_PX;
        const place = spatialWorld(wx, carWorldY(car.y, lh) - CONFIG.FLOOR_HEIGHT_PX / 2, this.view, this.dpr);
        const now = e.now;
        if (broken && !before.broken) S.elevatorBreakdown(e, { pan: place.pan, gain: Math.max(0.3, place.gain) });
        else if (!broken && before.broken && place.gain > 0.1) S.elevatorRepaired(e, place);
        if (active && place.gain > 0.08) {
          if (car.state === 'doors' && before.state !== 'doors') {
            // Several cars may arrive together: a small token bucket keeps it musical.
            if (this.limiter.allow(`car:${car.id}`, now, 1.2) && this.limiter.bucket('bell', now, 3, 0.9)) {
              S.elevatorBell(e, group.kind, car.dir >= 0, place);
              if (this.limiter.bucket('door', now, 3, 1.5)) S.elevatorDoor(e, true, { pan: place.pan, gain: place.gain });
            }
          } else if (before.state === 'doors' && car.state !== 'doors' && this.limiter.bucket('door', now, 3, 1.5)) {
            S.elevatorDoor(e, false, place);
          }
        }
      }
      if (before) { before.state = car.state; before.broken = broken; } else this.cars.set(car.id, { state: car.state, broken });
    }
    for (const id of this.cars.keys()) if (!seen.has(id)) this.cars.delete(id);
  }

  private trackIncidents(state: GameState, fresh: boolean): void {
    const e = this.live;
    const ids = new Set<number>();
    for (const incident of state.campaign.incidents) {
      ids.add(incident.id);
      if (fresh || this.incidents.has(incident.id) || !e) continue;
      const tenant = state.tenants.get(incident.tenantId);
      const place = tenant ? this.tenantPlace(tenant) : { pan: 0, gain: 1 };
      this.eventCueThisFrame = true;
      if (incident.kind === 'fire') { S.fireAlarm(e, { pan: place.pan, gain: Math.max(0.45, place.gain) }); this.alarmAt = e.now; }
      else if (incident.kind === 'bomb') S.bombAlert(e, place);
      else if (incident.kind === 'infestation') S.skitter(e, place);
      else if (incident.kind === 'vip') S.vipChime(e);
    }
    this.incidents = ids;
  }

  private trackPower(state: GameState, fresh: boolean): void {
    const blackout = blackoutOn(state);
    const wedding = state.campaign.weddingHeld;
    const e = this.live;
    if (!fresh && e) {
      if (blackout !== this.blackout) { (blackout ? S.powerDown : S.powerUp)(e); this.eventCueThisFrame = true; }
      if (wedding && !this.wedding && this.limiter.allow('wedding', e.now, 20)) { S.weddingBells(e); this.eventCueThisFrame = true; }
    }
    this.blackout = blackout;
    this.wedding = wedding;
  }

  // ------------------------------------------------------------ continuous world sound

  private worldLoops(state: GameState, active: boolean, dt: number): void {
    const e = this.engine!, beds = this.beds!;
    // Fires: roar at the loudest visible fire; the alarm repeats while one is in earshot.
    let fire = { pan: 0, gain: 0 };
    for (const incident of state.campaign.incidents) {
      if (incident.kind !== 'fire') continue;
      const tenant = state.tenants.get(incident.tenantId);
      if (!tenant) continue;
      const place = this.tenantPlace(tenant);
      if (place.gain > fire.gain) fire = place;
    }
    beds.set('fire', fire.gain * 0.35 * (active ? 1 : 0.25), fire.pan);
    if (active && fire.gain > 0.12) {
      if (e.now - this.alarmAt > 5) { this.alarmAt = e.now; S.fireAlarm(e, fire); }
      if (Math.random() < chance(9 * fire.gain, dt)) S.crackle(e, fire);
    }

    // Helicopter traffic at the helipad, mirroring the drawn flights.
    let rotor = { pan: 0, gain: 0, speed: 0 };
    if (this.mix.helipad || this.heli.flights.size) {
      this.heli.update(state, animTime(), FORCED_FLYOVER === 'helicopter');
      for (const [padId, flight] of this.heli.flights) {
        const pad = state.tenants.get(padId);
        if (!pad) continue;
        const pose = heliPose(flight, animTime());
        const box = tenantBox(pad, state.tower.lobbyHeight);
        const place = spatialWorld((box.left + box.right) / 2 + pose.dx, box.top - pose.alt, this.view, this.dpr);
        const level = place.gain * Math.min(1, pose.speed * 1.4);
        if (level > rotor.gain) rotor = { pan: place.pan, gain: level, speed: pose.speed };
      }
    }
    beds.rotor(rotor.speed);
    beds.set('rotor', active ? rotor.gain * 0.4 : 0, rotor.pan);

    // Seasonal flyovers (positions published by the incident view).
    const flyer = ambient.flyer;
    const visible = active && flyer.visible;
    if (visible) {
      const place = spatial(flyer.x + flyer.w / 2, flyer.y + flyer.h / 2, this.view, 1);
      const witch = ambient.moon !== null;
      if (witch) { if (!this.flyerWasVisible) S.spookyChord(e, place); }
      else if (this.limiter.allow('sleigh', e.now, 0.22 + Math.random() * 0.12)) S.sleighBells(e, { pan: place.pan, gain: 0.8 });
    }
    this.flyerWasVisible = visible;
  }

  /** Scheduled ambient detail and loops of one-shots (only while the sim runs). */
  private details(e: AudioEngine, dt: number): void {
    const m = this.mix;
    const roll = (rate: number): boolean => rate > 0 && Math.random() < chance(rate, dt);
    const jitter = (pan: number): number => clamp(pan + (Math.random() - 0.5) * 0.5, -0.8, 0.8);
    if (roll(1.1 * m.office)) S.keyboard(e, { pan: jitter(m.officePan), gain: 0.5 + 0.5 * m.office });
    if (roll(0.035 * m.office)) S.phone(e, { pan: jitter(m.officePan), gain: 0.6 + 0.4 * m.office });
    if (roll(1.2 * m.crowd * m.dining)) S.cutlery(e, { pan: jitter(m.crowdPan), gain: 0.5 + 0.5 * m.crowd });
    if (roll(0.5 * m.birds)) S.bird(e, { pan: (Math.random() - 0.5) * 1.4, gain: 0.5 + 0.5 * m.birds });
    if (roll(0.1 * m.traffic)) S.carPass(e, m.traffic);
    if (m.rain > 0 && roll(1 / 50)) S.thunder(e);
    if (m.construction.length) {
      const site = m.construction[Math.floor(Math.random() * m.construction.length)]!;
      const place = spatialWorld(site.x, site.y, this.view, this.dpr);
      const busy = Math.min(1, 0.5 + m.construction.length * 0.25);
      if (roll(2.6 * busy)) S.hammer(e, place);
      if (roll(0.12 * busy)) S.drill(e, place);
    }
    const state = this.state!;
    for (const incident of state.campaign.incidents) {
      if (incident.kind !== 'bomb' && incident.kind !== 'infestation') continue;
      const tenant = state.tenants.get(incident.tenantId);
      if (!tenant) continue;
      const place = this.tenantPlace(tenant);
      if (place.gain < 0.15) continue;
      if (incident.kind === 'bomb' && this.limiter.allow('tick', e.now, 0.5)) { this.tickTock = !this.tickTock; S.bombTick(e, this.tickTock, place); }
      if (incident.kind === 'infestation' && roll(0.18)) S.skitter(e, place);
    }
  }

  // ------------------------------------------------------------ interface hooks

  /** Error toasts (refused placements and actions) get a soft buzz. */
  private observeToasts(): void {
    if (this.toastObserved || typeof MutationObserver === 'undefined' || typeof document.querySelector !== 'function') return;
    const stack = document.querySelector('.toast-stack');
    if (!stack) return;
    this.toastObserved = true;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && node.classList.contains('toast-error')) { this.play('error'); return; }
      }
    }).observe(stack, { childList: true });
  }
}
