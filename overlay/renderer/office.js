// Pure logic: turn the farm's JSON into the list of characters standing on the taskbar. No DOM, so it is testable.
(function (root) {
  const MAX_PETS = 8;
  const NAMES = ['Ana', 'Bruno', 'Carla', 'Davi', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iara', 'João', 'Lia', 'Marcos'];
  const ROLES = ['agenda', 'docs', 'drafts', 'review', 'deadlines'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // A friendly, stable identity for an agent id: a first name and an office role (same hash as the sprite's look).
  function persona(id) {
    const h = hash(String(id));
    return { name: NAMES[(h >>> 21) % NAMES.length], role: ROLES[(h >>> 18) % ROLES.length] };
  }

  // state: farm /api/state, landings: /api/landings (array), offline: couldn't reach the farm
  function buildPets(state, landings, offline) {
    const pets = [];
    if (offline) return [{ id: 'A:offline', kind: 'offline', state: 'sofa', label: '', status: 'offline' }];
    for (const l of landings || []) {
      pets.push({ id: 'L:' + l.id, kind: 'landing', taskId: l.id, state: 'alert', status: 'alert', label: l.title || l.id, persona: persona(l.id) });
    }
    const subs = (state && state.subagents) || [];
    const waiting = new Set((landings || []).map((l) => l.id));
    for (const s of subs) {
      if (s.status === 'running' && !waiting.has(s.id)) {
        pets.push({ id: 'T:' + s.id, kind: 'task', taskId: s.id, state: 'working', status: 'working', label: s.title || s.id, persona: persona(s.id) });
      }
    }
    for (const a of (state && state.agents) || []) {
      if (a.loggedIn === false) continue;
      const busy = Number(a.running || 0) > 0;
      pets.push({ id: 'A:' + a.id, kind: 'chief', agentId: a.id, state: busy ? 'working' : 'idle', status: busy ? 'working' : 'idle', label: a.name || a.id, persona: { name: a.name || a.id, role: 'chief' } });
    }
    return pets.slice(0, MAX_PETS);
  }

  // Idle characters drift between walking, coffee and the sofa.
  function nextIdleMode(prev, rnd) {
    const r = rnd();
    if (r < 0.40) return prev === 'walk' ? 'coffee' : 'walk';
    if (r < 0.65) return 'coffee';
    if (r < 0.85) return 'read';
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

  root.Office = { buildPets, nextIdleMode, freeSlot, persona, ROLES, MAX_PETS };
  if (typeof module === 'object' && module.exports) module.exports = root.Office;
})(typeof self !== 'undefined' ? self : this);
