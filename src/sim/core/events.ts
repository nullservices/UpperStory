/**
 * Per-tick UI-facing event stream. The sim is a pure function of
 * (state, commands, tick); these events are a convenience sink that the
 * controller drains after each tick for toasts/modals. They are NOT part of
 * simulation state and never influence the sim.
 */
export type SimEvent =
  | { type: 'ALERT'; message: string }
  | { type: 'MONEY_CHANGED'; balance: number; delta: number }
  | { type: 'TENANT_COMPLETED'; tenantId: number }
  | { type: 'PERSON_GAVE_UP'; personId: number; floor: number }
  | { type: 'LEVEL_UP'; starLevel: number }
  | { type: 'QUARTER_REPORT'; quarter: number; income: number; upkeep: number };

export function pushEvent(state: { events: SimEvent[] }, event: SimEvent): void {
  state.events.push(event);
}
