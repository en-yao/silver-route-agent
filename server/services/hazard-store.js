const sessionHazards = new Map();

export function listHazards(sessionId) {
  return sessionHazards.get(sessionId) ?? [];
}

export function addHazard(sessionId, hazard) {
  const existing = listHazards(sessionId);
  const next = [...existing, hazard];
  sessionHazards.set(sessionId, next);
  return next;
}

export function clearHazards(sessionId) {
  sessionHazards.delete(sessionId);
}
