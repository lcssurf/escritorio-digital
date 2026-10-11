// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// Pure logic: turn the farm's JSON into the list of characters standing on the taskbar. No DOM, so it is testable.
(function (root) {
  const MAX_PETS = 20;
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

  const PRIORITY = { alert: 0, working: 1, idle: 2, sofa: 3 };

  // The characters on the taskbar. With a team (members from /api/team) every member is always there: working when a job
  // is running for them, asking for you when finished work of theirs waits for approval, otherwise at ease. Jobs that
  // belong to nobody on the team still get a generic character, so nothing is ever invisible.
  // keep: ids of specialists that were active a moment ago, so they don't vanish the instant they finish.
  function buildPets(state, landings, offline, members, keep) {
    if (offline) return [{ id: 'A:offline', kind: 'offline', state: 'sofa', label: '', status: 'offline', persona: { name: '', role: 'chief' } }];
    landings = landings || [];
    const subs = ((state && state.subagents) || []).filter((s) => s.status === 'running' || s.status === 'waiting');   // waiting = coordinating its team
    const pets = [];
    if (members && members.length) {
      const known = new Set(members.map((m) => m.id));
      for (const m of members) {
        const wait = landings.filter((l) => (l.specialist || 'chief') === m.id);
        const run = subs.filter((t) => (t.specialist || 'chief') === m.id);
        const st = wait.length ? 'alert' : run.length ? 'working' : 'idle';
        const standing = m.id === 'chief' || m.lead || m.pinned || (keep && keep.has(m.id));
        if (st === 'idle' && !standing) continue;   // an idle specialist is not on the bar: they appear when called
        const t = wait[0] || run[0];
        pets.push({ id: 'S:' + m.id, kind: 'member', member: m, memberId: m.id, taskId: t && t.id, state: st, status: st,
          count: wait.length || run.length, label: wait.length > 1 ? '' : (t && t.title) || '',
          persona: { name: m.name, title: m.title, role: m.id === 'chief' ? 'chief' : 'member' } });
      }
      for (const l of landings) if (!known.has(l.specialist || 'chief')) pets.push(orphanLanding(l));
      for (const t of subs) if (!known.has(t.specialist || 'chief')) pets.push(orphanTask(t));
    } else {
      for (const l of landings) pets.push(orphanLanding(l));
      const waiting = new Set(landings.map((l) => l.id));
      for (const t of subs) if (!waiting.has(t.id)) pets.push(orphanTask(t));
      for (const a of (state && state.agents) || []) {
        if (a.loggedIn === false) continue;
        const busy = Number(a.running || 0) > 0;
        pets.push({ id: 'A:' + a.id, kind: 'chief', agentId: a.id, state: busy ? 'working' : 'idle', status: busy ? 'working' : 'idle', label: a.name || a.id, persona: { name: a.name || a.id, role: 'chief' } });
      }
    }
    pets.sort((a, b) => (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9));
    const head = pets.slice(0, MAX_PETS);
    // keep the team's own order on the bar (the chief first), whatever they are doing
    return head.sort((a, b) => order(a) - order(b));
  }
  const order = (p) => (p.kind === 'member' ? (p.memberId === 'chief' ? 0 : p.member && p.member.lead ? 1 : 2) : 3);
  const orphanLanding = (l) => ({ id: 'L:' + l.id, kind: 'landing', taskId: l.id, state: 'alert', status: 'alert', label: l.title || l.id, persona: persona(l.id) });
  const orphanTask = (t) => ({ id: 'T:' + t.id, kind: 'task', taskId: t.id, state: 'working', status: 'working', label: t.title || t.id, persona: persona(t.id) });

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
