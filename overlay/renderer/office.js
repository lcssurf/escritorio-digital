// Pure logic: turn the farm's JSON into the list of characters standing on the taskbar. No DOM, so it is testable.
(function (root) {
  const MAX_PETS = 8;

  // state: farm /api/state, landings: /api/landings (array), offline: couldn't reach the farm
  function buildPets(state, landings, offline) {
    const pets = [];
    if (offline) return [{ id: 'A:offline', kind: 'offline', state: 'sofa', label: '', status: 'offline' }];
    for (const l of landings || []) {
      pets.push({ id: 'L:' + l.id, kind: 'landing', taskId: l.id, state: 'alert', status: 'alert', label: l.title || l.id });
    }
    const subs = (state && state.subagents) || [];
    const waiting = new Set((landings || []).map((l) => l.id));
    for (const s of subs) {
      if (s.status === 'running' && !waiting.has(s.id)) {
        pets.push({ id: 'T:' + s.id, kind: 'task', taskId: s.id, state: 'working', status: 'working', label: s.title || s.id });
      }
    }
    for (const a of (state && state.agents) || []) {
      if (a.loggedIn === false) continue;
      const busy = Number(a.running || 0) > 0;
      pets.push({ id: 'A:' + a.id, kind: 'chief', agentId: a.id, state: busy ? 'working' : 'idle', status: busy ? 'working' : 'idle', label: a.name || a.id });
    }
    return pets.slice(0, MAX_PETS);
  }

  // Idle characters drift between walking, coffee and the sofa.
  function nextIdleMode(prev, rnd) {
    const r = rnd();
    if (r < 0.45) return prev === 'walk' ? 'coffee' : 'walk';
    if (r < 0.75) return 'coffee';
    return 'sofa';
  }

  // First free slot along the bar, so characters that work next to each other don't overlap.
  function freeSlot(taken, spacing, start) {
    for (let k = 0; k < 64; k++) {
      const x = start + k * spacing;
      if (!taken.some((t) => Math.abs(t - x) < spacing * 0.8)) return x;
    }
    return start;
  }

  root.Office = { buildPets, nextIdleMode, freeSlot, MAX_PETS };
  if (typeof module === 'object' && module.exports) module.exports = root.Office;
})(typeof self !== 'undefined' ? self : this);
