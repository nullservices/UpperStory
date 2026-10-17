import { shaftWidth } from '../sim/elevators';
import { housekeepingAccess } from '../sim/housekeepingAccess';
import { CONFIG } from '../data/config';
import { floorBuildPlan } from './floorBuild';
import { extendFloor } from '../sim/tower';
import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { Camera } from '../render/camera';
import {
  addElevatorCar,
  buildFloor,
  cellIndexAtWorldX,
  cyclePricing,
  demolishAt,
  demolishTenant,
  escalatorPlacementError,
  floorIndexAtWorldY,
  getFloor,
  getTenantAt,
  groupAt,
  placeEscalator,
  placeStair,
  placeTenant,
  placementError,
  removeElevatorCar,
  stairPlacementError,
  upgradeCarSpeed,
  type ElevatorGroup,
  type GameState,
  type Tenant,
} from '../sim';
import { ElevatorEditor } from '../ui/dialogs/elevatorEditor';
import { QuarterReport } from '../ui/dialogs/quarterReport';
import { TenantInfo } from '../ui/dialogs/tenantInfo';
import type { Hud } from '../ui/hud';
import { TOOL_INFO, TOOL_SHORTCUTS } from '../ui/toolPalette';
import { floorLabel } from '../sim/campaign';
import { maintenanceCoverage, maintenanceOfficeReport } from '../sim/services';
import { BuildStroke, isRowBuildTool } from './buildStroke';
import { repairTenant, changeMovie } from '../sim/tenants';
import { buildElevator, elevatorBuildPlan } from './elevatorBuild';
import { repairElevatorCar, setCarHome, setElevatorPriority, setElevatorStop, setWaitingResponse, setDepartureDelay } from '../sim/elevators';

/** Player-facing build/demolish tools. Tenant tools share TenantType names. */
export type Tool =
  | 'buildFloor'
  | 'buildBasement'
  | 'hotelTwin' | 'hotelSuite' | 'partyHall' | 'cinema' | 'medical'
  | 'parkingRamp' | 'parkingSpace' | 'recycling' | 'metro' | 'cathedral'
  | 'fireStation' | 'bank' | 'helipad' | 'rooftopPool' | 'maintenance' | 'generator'
  | 'lobby'
  | 'stairs'
  | 'office'
  | 'condo'
  | 'demolish'
  | 'elevator'
  | 'escalatorUp'
  | 'escalatorDown'
  | 'select'
  // M3: commercial tenants + staff facilities.
  | 'fastfood'
  | 'security'
  | 'housekeeping'
  | 'hotel'
  | 'restaurant'
  | 'shop'
  | 'serviceElevator'
  // M4: sky lobby (3★ tenant) + the express shaft (structural, always enabled).
  | 'skyLobby'
  | 'expressElevator';

/** In-progress elevator shaft drag (started on pointerdown, committed on up). */
export interface ElevatorDrag {
  fromFloor: number;
  cell: number;
}

/**
 * Routes canvas pointer input into sim build commands. Holds the active tool
 * and the current hover cell; the PlacementPreview reads those every frame.
 * Sim tick events surface here as HUD toasts. M2 adds the vertical transport
 * tools (elevator drag, escalators) and the select tool that opens the
 * tenant/elevator info dialogs.
 */
export class Controller {
  tool: Tool | null = null;
  hover: { floor: number; cell: number } | null = null;
  hoverError: string | null = null;
  /** Last pointer position over the canvas (client px), null when outside it. */
  pointer: { x: number; y: number } | null = null;
  /** True while the primary button is held over the canvas (drags, rows). */
  pointerDown = false;
  /** Invoked whenever the active tool changes (palette click, Escape, ...). */
  onToolChange: ((tool: Tool | null) => void) | null = null;

  private readonly tenantInfo: TenantInfo;
  private readonly elevatorEditor: ElevatorEditor;
  private readonly quarterReport: QuarterReport;
  /** Which dialog (if any) is open — Escape closes it before the tool. */
  private openDialog: 'tenant' | 'elevator' | 'quarter' | null = null;
  private dragStart: ElevatorDrag | null = null;
  private buildStroke: BuildStroke | null = null;
  /** People who gave up since the last summary toast. */
  private gaveUp = { count: 0, floor: 0, lastToast: -Infinity };

  constructor(
    app: Application,
    private readonly camera: Camera,
    private state: GameState,
    private readonly hud: Hud,
  ) {
    this.tenantInfo = new TenantInfo();
    this.elevatorEditor = new ElevatorEditor();
    this.elevatorEditor.now = () => this.state.tickCount;
    this.quarterReport = new QuarterReport();
    this.tenantInfo.onClose = () => {
      if (this.openDialog === 'tenant') this.openDialog = null;
    };
    this.elevatorEditor.onClose = () => {
      if (this.openDialog === 'elevator') this.openDialog = null;
    };
    this.quarterReport.onClose = () => {
      if (this.openDialog === 'quarter') this.openDialog = null;
    };
    // Pixi reports moves from the whole document, so the hover (and its
    // preview, cursor tip and footer location) would follow the pointer over
    // windows and menus. Only the canvas, or a drag that started on it, counts.
    app.stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (e.nativeEvent.target !== app.canvas && !this.dragStart && !this.buildStroke) {
        if (this.pointer || this.hover) { this.pointer = null; this.hover = null; this.hoverError = null; }
        return;
      }
      this.onPointerMove(e);
    });
    app.canvas.addEventListener('pointerleave', () => {
      this.finishBuildStroke();
      this.pointer = null;
      if (!this.dragStart) { this.hover = null; this.hoverError = null; }
    });
    const cancel = (): void => { this.finishBuildStroke(); this.dragStart = null; this.pointerDown = false; };
    app.canvas.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerup', (e) => { if (e.button === 0) cancel(); });
    app.stage.on('pointerdown', (e: FederatedPointerEvent) => this.onPointerDown(e));
    const commit = (e: FederatedPointerEvent): void => this.onPointerUp(e);
    app.stage.on('pointerup', commit);
    app.stage.on('pointerupoutside', commit);
    window.addEventListener('keydown', (e: KeyboardEvent) => this.onKeyDown(e));
  }

  /** In-progress elevator drag, or null (read by the placement preview). */
  get drag(): ElevatorDrag | null {
    return this.dragStart;
  }

  /** In-progress row build (count and running cost for the cursor tip). */
  get stroke(): { placed: number; spentCents: number; error: string | null } | null {
    return this.buildStroke;
  }

  /** The elevator or room under a grid cell (what Inspect would open). */
  entityAt(floor: number, cell: number): { kind: 'elevator'; group: ElevatorGroup } | { kind: 'tenant'; tenant: Tenant } | null {
    const group = this.groupUnder(floor, cell)
      ?? [...this.state.elevatorGroups.values()].find(g => floor >= g.serviceLo && floor <= g.serviceHi && cell >= g.x && cell < g.x + shaftWidth(g));
    if (group) return { kind: 'elevator', group };
    const tenant = getTenantAt(this.state, floor, cell);
    return tenant ? { kind: 'tenant', tenant } : null;
  }

  /** Palette click / Escape: set the tool and drop any stale hover error. */
  selectTool(tool: Tool | null): void {
    this.finishBuildStroke();
    this.tool = tool;
    this.hoverError = null;
    this.dragStart = null;
    this.onToolChange?.(tool);
  }

  /**
   * Swap the live sim state (new game / save load from main). Everything
   * reads `this.state` through the field each call, so no stale closures —
   * but dialogs may hold tenants/elevators of the old state, so they close.
   */
  setState(state: GameState): void {
    this.state = state;
    this.selectTool('select');
    this.dragStart = null;
    this.hover = null;
    this.hoverError = null;
    this.openDialog = null;
    this.tenantInfo.close();
    this.elevatorEditor.close();
    this.quarterReport.close();
  }

  /** Map one tick's sim events to toasts; clears the queue. */
  drainEvents(): void {
    const { events, tenants } = this.state;
    // A row of rooms finishing together is one message, not one per room.
    const completed = new Map<string, { count: number; floor: number }>();
    for (const event of events) {
      switch (event.type) {
        case 'TENANT_COMPLETED': {
          const tenant = tenants.get(event.tenantId);
          if (tenant) {
            const label = tenantLabel(tenant.type);
            const entry = completed.get(label) ?? { count: 0, floor: tenant.floor };
            entry.count++;
            completed.set(label, entry);
          }
          break;
        }
        case 'LEVEL_UP':
          this.hud.toast(event.starLevel >= 6 ? 'Your tower earned the TOWER rating!' : `Your tower is now rated ${'★'.repeat(event.starLevel)} (${event.starLevel} stars)!`);
          break;
        case 'ALERT':
          this.hud.toast(friendlyAlert(event.message));
          break;
        case 'QUARTER_REPORT': {
          // A floating card: building continues, Escape closes it first.
          if (!this.openDialog) this.openDialog = 'quarter';
          this.quarterReport.open({
            quarter: event.quarter,
            income: event.income,
            upkeep: event.upkeep,
            interest: event.interest,
            // The balance already includes the quarter's net (settlement ran
            // before the event was pushed).
            balanceCents: this.state.money.balanceCents,
          });
          break;
        }
        case 'PERSON_GAVE_UP':
          this.gaveUp.count++;
          this.gaveUp.floor = event.floor;
          break;
        default:
          // MONEY_CHANGED: no toast.
          break;
      }
    }
    events.length = 0;
    for (const [label, { count, floor }] of completed) {
      this.hud.toast(count > 1 ? `${count} ${plural(label)} are ready` : `${label} ready on ${floorLabel(floor)}`);
    }
    // Busy towers can lose several people a second; report them at most every
    // few seconds so the message stack stays readable.
    const now = performance.now();
    if (this.gaveUp.count > 0 && now - this.gaveUp.lastToast > GAVE_UP_TOAST_MS) {
      const { count, floor } = this.gaveUp;
      this.hud.toast(count === 1
        ? `Someone gave up waiting for transport on ${floorLabel(floor)}`
        : `${count} people gave up waiting for transport (latest on ${floorLabel(floor)})`, 'warn');
      this.gaveUp = { count: 0, floor: 0, lastToast: now };
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) return;
    if (e.key === 'Home') { e.preventDefault(); this.camera.center(); return; }
    // Arrow keys pan the view (Shift for big steps), so the tower is reachable without a mouse.
    const pan = (PAN_KEYS as Partial<Record<string, readonly [number, number]>>)[e.key];
    if (pan && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const step = e.shiftKey ? 360 : 96;
      this.camera.x += pan[0] * step;
      this.camera.y += pan[1] * step;
      this.camera.apply();
      return;
    }
    const shortcut = (Object.keys(TOOL_SHORTCUTS) as Tool[]).find(tool => TOOL_SHORTCUTS[tool]!.toLowerCase() === e.key.toLowerCase());
    if (shortcut && !e.ctrlKey && !e.metaKey && !e.altKey) { this.selectTool(shortcut); return; }
    if (e.key !== 'Escape') return;
    if (this.openDialog) {
      // Escape closes a dialog first; a second Escape drops the tool.
      this.closeOpenDialog();
      return;
    }
    this.selectTool('select');
  }

  /** Close whichever modal is open; its onClose clears openDialog. */
  private closeOpenDialog(): void {
    if (this.openDialog === 'tenant') this.tenantInfo.close();
    else if (this.openDialog === 'elevator') this.elevatorEditor.close();
    else if (this.openDialog === 'quarter') this.quarterReport.close();
  }

  private onPointerMove(e: FederatedPointerEvent, finishing = false): void {
    const world = this.camera.screenToWorld(e.global.x, e.global.y);
    this.pointer = { x: e.global.x, y: e.global.y };
    this.pointerDown = (e.buttons & 1) !== 0;
    this.hover = {
      floor: this.tool === 'lobby' ? CONFIG.LOBBY_FLOOR_INDEX : floorIndexAtWorldY(world.y, this.state.tower.lobbyHeight),
      cell: cellIndexAtWorldX(world.x),
    };
    if (this.buildStroke && (finishing || (e.buttons & 1) !== 0)) {
      this.buildStroke.extend(this.state, this.hover.cell);
      this.hover.floor = this.buildStroke.floor;
      this.hover.cell = this.buildStroke.anchor + Math.trunc((this.hover.cell - this.buildStroke.anchor) / this.buildStroke.width) * this.buildStroke.width;
      this.hoverError = this.buildStroke.error;
    } else {
      this.finishBuildStroke();
      this.hoverError = this.errorFor(this.tool, this.hover);
    }
  }

  private onPointerDown(e: FederatedPointerEvent): void {
    if (e.button !== 0 || !this.tool) return;
    this.onPointerMove(e);
    this.pointerDown = true;
    const tool = this.tool;
    const hover = this.hover;
    const state = this.state;
    if (hover && isRowBuildTool(tool)) {
      this.buildStroke = new BuildStroke(tool, hover.floor, hover.cell);
      this.buildStroke.extend(state, hover.cell);
      this.hoverError = this.buildStroke.error;
      return;
    }
    try {
      switch (tool) {
        case 'buildBasement':
        case 'buildFloor': {
          const plan = floorBuildPlan(state, hover, tool === 'buildBasement');
          if (plan.error) throw new Error(plan.error);
          if (plan.extending) extendFloor(state, plan.floor, hover!.cell);
          else buildFloor(state, plan.floor);
          this.hud.toast(`${plan.extending ? 'Extended' : 'Built'} ${floorLabel(plan.floor)}`);
          break;
        }
        case 'elevator':
        case 'serviceElevator':
        case 'expressElevator': {
          // Start a drag; the shaft is committed on pointerup over its span.
          if (hover) this.dragStart = { fromFloor: hover.floor, cell: hover.cell };
          break;
        }
        case 'escalatorUp':
        case 'escalatorDown': {
          if (!hover) break;
          placeEscalator(state, hover.floor, hover.cell, tool === 'escalatorUp' ? 'up' : 'down');
          break;
        }
        case 'select': {
          if (!hover) break;
          // The canvas fills the window, so its coordinates are client coordinates.
          this.selectAt(hover, { x: e.global.x, y: e.global.y });
          break;
        }
        case 'demolish': {
          if (!hover) break;
          const target = this.demolishTarget(hover.floor, hover.cell);
          demolishAt(state, hover.floor, hover.cell);
          if (target) this.hud.toast(`Removed ${target}`);
          break;
        }
        case 'stairs': {
          if (!hover) break;
          placeStair(state, hover.floor, hover.cell);
          break;
        }
        default:
          // Tenant tools share their TenantType names (lobby, office, condo,
          // fastfood, security, housekeeping, hotel, restaurant, shop,
          // skyLobby). The sim rejects anything that star/space does not allow.
          if (hover) placeTenant(state, tool, hover.floor, hover.cell);
          break;
      }
      // Refresh the preview now that funds/structure may have changed.
      this.hoverError = this.errorFor(this.tool, this.hover);
    } catch (err) {
      this.hud.toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  /** Commit the elevator drag: place the shaft over the dragged span. */
  private onPointerUp(e: FederatedPointerEvent): void {
    const tool = this.tool;
    if (e.button === 0 && this.buildStroke) {
      this.onPointerMove(e, true);
      this.finishBuildStroke();
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    this.onPointerMove(e);
    if (tool !== 'elevator' && tool !== 'serviceElevator' && tool !== 'expressElevator') {
      return;
    }
    const drag = this.dragStart;
    this.dragStart = null;
    const hoverFloor = this.hover?.floor ?? drag.fromFloor;
    try {
      const before = elevatorBuildPlan(this.state, drag.fromFloor, hoverFloor, drag.cell, kindFor(tool));
      const group = before.groupId === undefined ? undefined : this.state.elevatorGroups.get(before.groupId);
      const unchanged = group !== undefined && group.serviceLo === before.lo && group.serviceHi === before.hi;
      buildElevator(this.state, drag.fromFloor, hoverFloor, drag.cell, kindFor(tool));
      const span = `${floorLabel(before.lo)} – ${floorLabel(before.hi)}`;
      if (!group) this.hud.toast(`Built ${TOOL_INFO[tool].label.toLowerCase()} · ${span}`);
      else if (!unchanged) this.hud.toast(`Shaft extended · now serves ${span}`);
    } catch (err) {
      this.hud.toast(err instanceof Error ? err.message : String(err), 'error');
    }
    this.hoverError = this.errorFor(tool, this.hover);
  }

  private finishBuildStroke(): void {
    const stroke = this.buildStroke;
    this.buildStroke = null;
    if (!stroke) return;
    const what = stroke.tool === 'lobby' ? 'lobby cells' : plural(TOOL_INFO[stroke.tool].label);
    if (stroke.placed > 1) this.hud.toast(`Built ${stroke.placed} ${what}${stroke.error ? ` — stopped: ${stroke.error}` : ''}`, stroke.error ? 'warn' : 'info');
    else if (stroke.error) this.hud.toast(stroke.error, 'error');
  }

  /** What a Bulldoze click at (floor, cell) would remove, for the cursor tip and toast. */
  demolishTarget(floor: number, cell: number): string | null {
    const where = floorLabel(floor);
    const entity = this.entityAt(floor, cell);
    if (entity?.kind === 'elevator') {
      const kind = entity.group.kind === 'service' ? 'service elevator' : entity.group.kind === 'express' ? 'express elevator' : 'elevator';
      return `${kind} (${floorLabel(entity.group.serviceLo)} – ${floorLabel(entity.group.serviceHi)})`;
    }
    if (entity) return entity.tenant.type === 'lobby' ? 'a lobby cell' : `${tenantLabel(entity.tenant.type)} on ${where}`;
    const content = getFloor(this.state.tower, floor)?.cells[cell]?.content;
    if (content === 'stair') return `stairs on ${where}`;
    if (content === 'escalator') return `escalator on ${where}`;
    return null;
  }

  /** 'select' click: open the info dialog for the thing under the pointer. */
  private selectAt(hover: { floor: number; cell: number }, anchor?: { x: number; y: number }): void {
    const entity = this.entityAt(hover.floor, hover.cell);
    if (entity?.kind === 'elevator') this.openElevatorEditor(entity.group, anchor);
    else if (entity) this.openTenantInfo(entity.tenant, anchor);
  }

  private openTenantInfo(tenant: Tenant, anchor?: { x: number; y: number }): void {
    // Count everyone assigned here (including people away), not just those inside.
    let occupancy = 0;
    let stressSum = 0;
    for (const p of this.state.people.values()) {
      if (p.tenantId !== tenant.id) continue;
      occupancy++;
      stressSum += p.stress;
    }
    this.openDialog = 'tenant';
    this.tenantInfo.open(
      tenant,
      {
        avgStress: occupancy > 0 ? stressSum / occupancy : 0,
        lobbyUpkeepQuarter: lobbyUpkeepQuarter(this.state.starLevel, tenant.sizeCells),
        officeLeaseDaysRemaining: Math.max(0, (tenant.officeLeaseUntilTick ?? 0) - this.state.tickCount) / CONFIG.DAY_TICKS,
        condoAccess: tenant.type === 'condo' ? condoHasAccess(this.state, tenant) : undefined,
        noiseSources: noiseSources(this.state, tenant).map(source => {
          const room = this.state.tenants.get(source.tenantId)!;
          return { type: room.type, x: room.x, floor: room.floor, floorDistance: source.floorDistance, gap: source.gap, clearance: source.clearance };
        }),
        occupancy,
        housekeepingAccess: housekeepingAccess(this.state, tenant),
        maintenance: (() => {
          const report = maintenanceOfficeReport(this.state, tenant.id);
          return report && { shafts: report.shafts.length, totalShafts: this.state.elevatorGroups.size, crews: report.crews, busy: report.busy };
        })(),
        cleaningRemaining: tenant.type === 'housekeeping' ? [...this.state.people.values()]
          .filter(p => p.tenantId === tenant.id && p.kind === 'housekeeper')
          .map(p => Math.max(0, CONFIG.HOUSEKEEPER_ROOMS_PER_DAY - (p.roomsCleanedToday ?? 0))) : undefined,
        housekeepingFloors: tenant.type === 'housekeeping' ? [...new Set(
          [...this.state.people.values()].filter(p => p.tenantId === tenant.id && p.kind === 'housekeeper' && p.activityTenantId >= 0 && p.state !== 'offscreen')
            .map(p => this.state.tenants.get(p.activityTenantId))
            .filter(t => t?.state === 'open').map(t => t!.floor),
        )].sort((a, b) => a - b) : undefined,
      },
      {
        demolish: () => {
          try {
            if (tenant.type === 'lobby') demolishTenant(this.state, tenant.floor, tenant.x);
            else demolishAt(this.state, tenant.floor, tenant.x);
            this.tenantInfo.close();
          } catch (err) {
            this.tenantInfo.setError(err instanceof Error ? err.message : String(err));
          }
        },
        repair: () => {
          try { repairTenant(this.state, tenant.id); this.tenantInfo.refresh(); }
          catch (error) { this.tenantInfo.setError(error instanceof Error ? error.message : String(error)); }
        },
        changeMovie: () => {
          try { changeMovie(this.state, tenant.id); this.tenantInfo.refresh(); }
          catch (error) { this.tenantInfo.setError(error instanceof Error ? error.message : String(error)); }
        },
        cyclePricing: () => {
          try {
            cyclePricing(this.state, tenant.id);
            this.tenantInfo.refresh();
          } catch (err) {
            this.tenantInfo.setError(err instanceof Error ? err.message : String(err));
          }
        },
        close: () => this.tenantInfo.close(),
      },
      anchor,
    );
  }

  private openElevatorEditor(group: ElevatorGroup, anchor?: { x: number; y: number }): void {
    const state = this.state;
    this.openDialog = 'elevator';
    this.elevatorEditor.open(group, {
      addCar: () => this.elevatorAction(() => addElevatorCar(state, group.id)),
      removeCar: (carId: number) =>
        this.elevatorAction(() => removeElevatorCar(state, group.id, carId)),
      upgrade: (carId: number) =>
        this.elevatorAction(() => upgradeCarSpeed(state, group.id, carId)),
      repair: (carId: number) => this.elevatorAction(() => repairElevatorCar(state, group.id, carId)),
      home: (carId, floor) => this.elevatorAction(() => setCarHome(state, group.id, carId, floor)),
      priority: (day, period, priority) => this.elevatorAction(() => setElevatorPriority(state, group.id, day, period, priority)),
      response: (day, period, floors) => this.elevatorAction(() => setWaitingResponse(state, group.id, day, period, floors)),
      departure: (day, period, seconds) => this.elevatorAction(() => setDepartureDelay(state, group.id, day, period, seconds)),
      stop: (floor, enabled) => this.elevatorAction(() => setElevatorStop(state, group.id, floor, enabled)),
      maintenanceOffices: () => maintenanceCoverage(state, group.id).officeIds.length,
      close: () => this.elevatorEditor.close(),
    }, anchor);
  }

  /** Run a sim elevator command; surface failures in the editor's error line. */
  private elevatorAction(action: () => void): void {
    try {
      action();
      this.elevatorEditor.clearError();
    } catch (err) {
      this.elevatorEditor.setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** The elevator group whose cells cover (floor, x), if any. */
  private groupUnder(floor: number, x: number): ElevatorGroup | undefined {
    const cell = getFloor(this.state.tower, floor)?.cells[x];
    if (!cell) return undefined;
    if (cell.content === 'elevatorShaft') return groupAt(this.state, floor, x);
    if (cell.content === 'elevatorLobby') return groupAt(this.state, floor, x - 1);
    return undefined;
  }

  private errorFor(
    tool: Tool | null,
    hover: { floor: number; cell: number } | null,
  ): string | null {
    if (!tool || !hover) return null;
    const state = this.state;
    switch (tool) {
      case 'buildBasement':
        return floorBuildPlan(state, hover, true).error;
      case 'buildFloor':
        return floorBuildPlan(state, hover).error;
      case 'demolish':
      case 'select':
        return null;
      case 'elevator':
      case 'serviceElevator':
      case 'expressElevator': {
        return elevatorBuildPlan(state, this.dragStart?.fromFloor ?? hover.floor,
          hover.floor, this.dragStart?.cell ?? hover.cell, kindFor(tool)).error;
      }
      case 'escalatorUp':
      case 'escalatorDown':
        return escalatorPlacementError(state, hover.floor, hover.cell);
      case 'stairs':
        return stairPlacementError(state, hover.floor, hover.cell);
      default:
        // Tenant tools — placementError(state, type, floor, x) covers every
        // TenantType name, including the M3 commercial types and the M4 sky
        // lobby.
        return placementError(state, tool, hover.floor, hover.cell);
    }
  }
}

const GAVE_UP_TOAST_MS = 8000;
const PAN_KEYS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as const;

function tenantLabel(type: string): string {
  return (TOOL_INFO as Partial<Record<string, { label: string }>>)[type]?.label ?? type;
}

/** "Office" → "offices", "Parking" → "parking spaces", "Stairs" → "stairs". */
export function plural(label: string): string {
  const lower = label.replace(/ [↑↓]$/, '').toLowerCase();
  if (lower === 'parking') return 'parking spaces';
  if (lower.endsWith('s')) return lower;
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

/**
 * The evaluation's vacancy alerts use raw type ids and floor indices
 * ("A fastfood on floor 0 has gone vacant!"); show the player-facing names.
 */
export function friendlyAlert(message: string): string {
  const match = /^A (\w+) on floor (-?\d+) (has new occupants|has gone vacant)!$/.exec(message);
  if (!match) return message;
  return `${tenantLabel(match[1]!)} on ${floorLabel(Number(match[2]))} ${match[3]}`;
}

/** Elevator shaft tool → the group kind it commits as. */
function kindFor(
  tool: 'elevator' | 'serviceElevator' | 'expressElevator',
): 'standard' | 'service' | 'express' {
  if (tool === 'serviceElevator') return 'service';
  if (tool === 'expressElevator') return 'express';
  return 'standard';
}
import { noiseSources } from '../sim/noise';
import { lobbyUpkeepQuarter } from '../sim/money';
import { condoHasAccess } from '../sim/condoEconomy';
