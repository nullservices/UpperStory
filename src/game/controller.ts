import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { Camera } from '../render/camera';
import {
  addElevatorCar,
  buildFloor,
  buildFloorError,
  cellIndexAtWorldX,
  cyclePricing,
  demolishAt,
  elevatorPlacementError,
  escalatorPlacementError,
  floorIndexAtWorldY,
  getFloor,
  getTenantAt,
  groupAt,
  placeElevatorGroup,
  placeEscalator,
  placeStair,
  placeTenant,
  placementError,
  removeElevatorCar,
  stairPlacementError,
  topFloorIndex,
  upgradeCarSpeed,
  type ElevatorGroup,
  type GameState,
  type Tenant,
} from '../sim';
import { ElevatorEditor } from '../ui/dialogs/elevatorEditor';
import { QuarterReport } from '../ui/dialogs/quarterReport';
import { TenantInfo } from '../ui/dialogs/tenantInfo';
import type { Hud } from '../ui/hud';
import { BuildStroke, isRowBuildTool } from './buildStroke';

/** Player-facing build/demolish tools. Tenant tools share TenantType names. */
export type Tool =
  | 'buildFloor'
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
  /** Invoked whenever the active tool changes (palette click, Escape, ...). */
  onToolChange: ((tool: Tool | null) => void) | null = null;

  private readonly tenantInfo: TenantInfo;
  private readonly elevatorEditor: ElevatorEditor;
  private readonly quarterReport: QuarterReport;
  /** Which dialog (if any) is open — Escape closes it before the tool. */
  private openDialog: 'tenant' | 'elevator' | 'quarter' | null = null;
  private dragStart: ElevatorDrag | null = null;
  private buildStroke: BuildStroke | null = null;

  constructor(
    app: Application,
    private readonly camera: Camera,
    private state: GameState,
    private readonly hud: Hud,
  ) {
    this.tenantInfo = new TenantInfo();
    this.elevatorEditor = new ElevatorEditor();
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
    app.stage.on('pointermove', (e: FederatedPointerEvent) => this.onPointerMove(e));
    app.canvas.addEventListener('pointerleave', () => {
      this.finishBuildStroke();
      if (!this.dragStart) { this.hover = null; this.hoverError = null; }
    });
    const cancel = (): void => { this.finishBuildStroke(); this.dragStart = null; };
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
    for (const event of events) {
      switch (event.type) {
        case 'TENANT_COMPLETED': {
          const tenant = tenants.get(event.tenantId);
          if (tenant) {
            this.hud.toast(`${tenant.type} ready on floor ${tenant.floor}`);
          }
          break;
        }
        case 'LEVEL_UP':
          this.hud.toast(`Tower rated ★${event.starLevel}!`);
          break;
        case 'ALERT':
          this.hud.toast(event.message);
          break;
        case 'QUARTER_REPORT': {
          this.finishBuildStroke();
          this.openDialog = 'quarter';
          this.quarterReport.open({
            quarter: event.quarter,
            income: event.income,
            upkeep: event.upkeep,
            // The balance already includes the quarter's net (settlement ran
            // before the event was pushed).
            balanceCents: this.state.money.balanceCents,
          });
          break;
        }
        case 'PERSON_GAVE_UP':
          this.hud.toast(`Someone gave up waiting on floor ${event.floor}`);
          break;
        default:
          // MONEY_CHANGED: no toast.
          break;
      }
    }
    events.length = 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector('[role="dialog"][data-open="true"], dialog[open]')) return;
    if (e.key === 'Home') { e.preventDefault(); this.camera.center(); return; }
    const shortcuts: Record<string, Tool> = { i: 'select', f: 'buildFloor', e: 'elevator', o: 'office', c: 'condo' };
    const shortcut = shortcuts[e.key.toLowerCase()];
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
    this.hover = {
      floor: floorIndexAtWorldY(world.y),
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
        case 'buildFloor': {
          const next = topFloorIndex(state.tower) + 1;
          buildFloor(state, next);
          this.hud.toast(`Built floor ${next}`);
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
          this.selectAt(hover);
          break;
        }
        case 'demolish': {
          if (!hover) break;
          demolishAt(state, hover.floor, hover.cell);
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
      this.hud.toast(err instanceof Error ? err.message : String(err));
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
    const lo = Math.min(drag.fromFloor, hoverFloor);
    const hi = Math.max(drag.fromFloor, hoverFloor);
    try {
      placeElevatorGroup(this.state, lo, hi, drag.cell, kindFor(tool));
    } catch (err) {
      this.hud.toast(err instanceof Error ? err.message : String(err));
    }
    this.hoverError = this.errorFor(tool, this.hover);
  }

  private finishBuildStroke(): void {
    const stroke = this.buildStroke;
    this.buildStroke = null;
    if (!stroke) return;
    if (stroke.placed > 1) this.hud.toast(`Built ${stroke.placed} facilities${stroke.error ? ` — ${stroke.error}` : ''}`);
    else if (stroke.error) this.hud.toast(stroke.error);
  }

  /** 'select' click: open the info dialog for the thing under the pointer. */
  private selectAt(hover: { floor: number; cell: number }): void {
    const group = this.groupUnder(hover.floor, hover.cell)
      ?? [...this.state.elevatorGroups.values()].find(g => hover.floor >= g.serviceLo && hover.floor <= g.serviceHi && hover.cell >= g.x && hover.cell < g.x + 2);
    if (group) { this.openElevatorEditor(group); return; }
    const tenant = getTenantAt(this.state, hover.floor, hover.cell);
    if (tenant) this.openTenantInfo(tenant);
  }

  private openTenantInfo(tenant: Tenant): void {
    // The sim never fills Tenant.occupancy, so count its people directly.
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
        occupancy,
      },
      {
        demolish: () => {
          try {
            demolishAt(this.state, tenant.floor, tenant.x);
            this.tenantInfo.close();
          } catch (err) {
            this.tenantInfo.setError(err instanceof Error ? err.message : String(err));
          }
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
    );
  }

  private openElevatorEditor(group: ElevatorGroup): void {
    const state = this.state;
    this.openDialog = 'elevator';
    this.elevatorEditor.open(group, {
      addCar: () => this.elevatorAction(() => addElevatorCar(state, group.id)),
      removeCar: (carId: number) =>
        this.elevatorAction(() => removeElevatorCar(state, group.id, carId)),
      upgrade: (carId: number) =>
        this.elevatorAction(() => upgradeCarSpeed(state, group.id, carId)),
      close: () => this.elevatorEditor.close(),
    });
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
      case 'buildFloor':
        return buildFloorError(state, topFloorIndex(state.tower) + 1);
      case 'demolish':
      case 'select':
        return null;
      case 'elevator':
      case 'serviceElevator':
      case 'expressElevator': {
        if (!this.dragStart) return null;
        const lo = this.dragStart
          ? Math.min(this.dragStart.fromFloor, hover.floor)
          : hover.floor;
        const hi = this.dragStart
          ? Math.max(this.dragStart.fromFloor, hover.floor)
          : hover.floor;
        return elevatorPlacementError(
          state,
          lo,
          hi,
          this.dragStart?.cell ?? hover.cell,
          kindFor(tool),
        );
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

/** Elevator shaft tool → the group kind it commits as. */
function kindFor(
  tool: 'elevator' | 'serviceElevator' | 'expressElevator',
): 'standard' | 'service' | 'express' {
  if (tool === 'serviceElevator') return 'service';
  if (tool === 'expressElevator') return 'express';
  return 'standard';
}
