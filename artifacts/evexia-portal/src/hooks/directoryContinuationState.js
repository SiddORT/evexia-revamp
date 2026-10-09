// Scope changes discard the old position, including when a previous query is
// entered again. A cursor is not a bookmark for a reusable search session.
export function continuationPosition(position, scope) {
  return position.scope === scope ? position : { scope, cursor: null };
}
