/**
 * Monotonic entity ids. Never reused within a run — save files restore the
 * counter so newly created entities can't collide with loaded ones.
 */
export function nextId(state: { nextEntityId: number }): number {
  const id = state.nextEntityId;
  state.nextEntityId += 1;
  return id;
}
