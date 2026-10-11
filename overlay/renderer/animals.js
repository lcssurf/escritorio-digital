// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// The "animals" set: real, cute, cartoon animals (not people with an animal head). Chunky 2-pixel "units", a big round head,
// big shiny eyes, four stubby legs (or upright for the birds), a tail that wags. They are told apart the way a real pet is: a
// bandana in the team's colour, a collar medal for the chief and the coordinators, and the role's accessory on the head
// (headset, visor, pencil, round glasses, bow tie, scarf, cap, heart, crown, monocle).
// Drawn on the same canvas as the people and in the same states: walk, idle, coffee, sofa, read, working, alert, cheer.
(function (root) {
  const K = '#1b1824', PINK = '#f2a0b0';

  function palette(L) {
    const F = L.fur, D = L.furD, M = L.muz;
    switch (L.species) {
      case 'cat': return { body: F, belly: M, limb: F, paw: M, ear: F, earIn: PINK, nose: '#e8808f', tail: F, tailTip: D, mark: D };
      case 'dog': return { body: F, belly: M, limb: F, paw: M, ear: D, earIn: D, nose: K, tail: F, tailTip: F, mark: D };
      case 'rabbit': return { body: F, belly: '#ffffff', limb: F, paw: '#ffffff', ear: F, earIn: '#ffc1d0', nose: '#ff8fa6', tail: '#fff', tailTip: '#fff', mark: D };
      case 'fox': return { body: F, belly: M, limb: '#4a3228', paw: '#4a3228', ear: F, earIn: '#4a3228', nose: K, tail: F, tailTip: '#fff', mark: M };
      case 'panda': return { body: '#f4f4f8', belly: '#f4f4f8', limb: '#2a2a32', paw: '#2a2a32', ear: '#2a2a32', earIn: '#2a2a32', nose: K, tail: '#fff', tailTip: '#fff', mark: '#2a2a32' };
      case 'raccoon': return { body: F, belly: M, limb: D, paw: '#3a3a44', ear: F, earIn: D, nose: K, tail: F, tailTip: '#3a3a44', mark: '#2a2a32' };
      case 'penguin': return { body: '#2a2a3a', belly: '#ffffff', limb: '#2a2a3a', paw: '#f5a524', ear: null, earIn: null, nose: '#f5a524', tail: '#2a2a3a', tailTip: '#2a2a3a', mark: '#ffffff' };
      default: return { body: F, belly: M, limb: F, paw: '#f5a524', ear: L.furD, earIn: L.furD, nose: '#f5a524', tail: L.furD, tailTip: L.furD, mark: L.furD };   // owl
    }
  }
  const isBird = (sp) => sp === 'penguin' || sp === 'owl';

  // ---------------------------------------------------------------- one drawing context: units of 2 pixels
  function ctxFor(c, L, k) {
    const g = { c, L, k, p: palette(L), sh: k.shade };
    g.u = (col, x, y, w, h) => k.R(c, col, Math.round(x * 2), Math.round(y * 2), Math.round(w * 2), Math.round(h * 2));
    g.px = (col, x, y, w, h) => k.R(c, col, x, y, w, h);
    return g;
  }

  function eye(g, x, y, o, patch) {
    const { u, px } = g;
    if (o.closed || o.blink) { px(K, x * 2, y * 2 + 2, 4, 1); px(K, x * 2, y * 2 + 1, 1, 1); px(K, x * 2 + 3, y * 2 + 1, 1, 1); return; }
    if (o.happy) { px(K, x * 2, y * 2 + 3, 1, 1); px(K, x * 2 + 1, y * 2 + 1, 2, 1); px(K, x * 2 + 3, y * 2 + 3, 1, 1); px(K, x * 2 + 1, y * 2 + 2, 1, 1); px(K, x * 2 + 2, y * 2 + 2, 1, 1); return; }
    u(K, x, y, 2, 2);                                       // a big dark eye...
    px('#fff', x * 2, y * 2, 2, 2); px('#fff', x * 2 + 3, y * 2 + 3, 1, 1);   // ...with a shine: that is what makes it cute
    if (patch) { px(K, x * 2 + 2, y * 2 + 1, 2, 3); }
  }

  // ---------------------------------------------------------------- the head (10 x 9 units at hx, hy)
  function head(g, hx, hy, o) {
    const { u, px, L, p } = g, sp = L.species, F = sp === 'penguin' ? p.body : L.fur;
    // ears behind the face
    if (sp === 'cat') { u(F, hx + 1, hy - 1, 3, 2); u(F, hx + 2, hy - 2, 1, 1); u(F, hx + 6, hy - 1, 3, 2); u(F, hx + 7, hy - 2, 1, 1); u(p.earIn, hx + 2, hy - 1, 1, 1); u(p.earIn, hx + 7, hy - 1, 1, 1); }
    if (sp === 'dog') { u(p.ear, hx - 1, hy + 1, 2, 6); u(p.ear, hx - 1, hy, 2, 1); u(p.ear, hx + 8, hy + 1, 2, 5); }
    if (sp === 'rabbit') { u(F, hx + 1, hy - 6, 2, 7); u(p.earIn, hx + 2, hy - 5, 1, 5); u(F, hx + 5, hy - 7, 2, 8); u(p.earIn, hx + 6, hy - 6, 1, 6); }
    if (sp === 'fox') { u(F, hx + 1, hy - 2, 3, 3); u(F, hx + 6, hy - 2, 3, 3); u('#2a2a32', hx + 1, hy - 2, 3, 1); u('#2a2a32', hx + 6, hy - 2, 3, 1); u(p.earIn, hx + 2, hy - 1, 1, 1); u(p.earIn, hx + 7, hy - 1, 1, 1); }
    if (sp === 'panda') { u(p.ear, hx, hy - 1, 3, 3); u(p.ear, hx + 7, hy - 1, 3, 3); }
    if (sp === 'raccoon') { u(F, hx + 1, hy - 1, 3, 2); u(p.mark, hx + 1, hy - 1, 3, 1); u(F, hx + 6, hy - 1, 3, 2); u(p.mark, hx + 6, hy - 1, 3, 1); }
    if (sp === 'owl') { u(p.ear, hx + 1, hy - 2, 2, 3); u(p.ear, hx + 7, hy - 2, 2, 3); }
    // face
    u(F, hx + 1, hy, 8, 9); u(F, hx, hy + 1, 10, 7);
    const light = sp === 'panda' ? '#f4f4f8' : sp === 'penguin' ? '#fff' : L.muz;
    if (sp === 'cat') { u(L.furD, hx + 3, hy, 1, 2); u(L.furD, hx + 5, hy, 1, 2); u(light, hx + 6, hy + 5, 4, 3); }
    if (sp === 'dog') { u(p.mark, hx + 5, hy + 2, 4, 3); u(light, hx + 6, hy + 5, 5, 3); }
    if (sp === 'rabbit') { u(light, hx + 5, hy + 5, 6, 3); }
    if (sp === 'fox') { u(light, hx + 4, hy + 5, 7, 4); u(light, hx, hy + 5, 4, 3); }
    if (sp === 'raccoon') { u(p.mark, hx, hy + 3, 10, 3); u(light, hx + 6, hy + 6, 5, 2); }
    if (sp === 'panda') { u(p.mark, hx + 1, hy + 2, 3, 4); u(p.mark, hx + 6, hy + 2, 3, 4); u(p.mark, hx + 8, hy + 5, 3, 2); }
    if (sp === 'penguin') { u('#fff', hx + 2, hy + 3, 7, 5); u('#fff', hx + 1, hy + 4, 9, 3); }
    if (sp === 'owl') { u(L.muz, hx + 1, hy + 2, 4, 4); u(L.muz, hx + 5, hy + 2, 4, 4); u(L.furD, hx + 1, hy, 8, 1); }
    // eyes
    const ey = hy + 3, e1 = hx + 2, e2 = hx + 6;
    if (sp === 'owl') {
      if (o.closed || o.blink) { px(K, (hx + 2) * 2, (hy + 4) * 2, 6, 1); px(K, (hx + 6) * 2, (hy + 4) * 2, 6, 1); }
      else { u('#fff', hx + 1.5, hy + 2.5, 3, 3); u('#fff', hx + 5.5, hy + 2.5, 3, 3); u(K, hx + 3, hy + 3, 1.5, 2); u(K, hx + 6.5, hy + 3, 1.5, 2); px('#fff', (hx + 3) * 2, (hy + 3) * 2, 1, 1); px('#fff', (hx + 6.5) * 2, (hy + 3) * 2, 1, 1); }
    } else if (sp === 'panda') { eye(g, e1 + 0.5, ey + 0.5, o, false); eye(g, e2 + 0.5, ey + 0.5, o, false); }
    else { eye(g, e1, ey, o, false); eye(g, e2, ey, o, false); }
    // nose and mouth
    const nx = sp === 'owl' ? hx + 4 : hx + 8;
    if (sp === 'owl') { u(p.nose, hx + 4, hy + 5, 2, 2); u('#c47d12', hx + 4, hy + 6, 2, 1); }
    else if (sp === 'penguin') { u(p.nose, hx + 7, hy + 5, 4, 2); u('#c47d12', hx + 7, hy + 6, 4, 1); }
    else {
      u(p.nose, nx, hy + 5, 2, 1.5);
      px('#3a2a2a', (nx) * 2 + 1, (hy + 6.5) * 2, 1, 2);
      if (o.happy || o.open) { px('#3a2a2a', nx * 2 - 1, (hy + 7) * 2 + 1, 5, 1); u('#e8808f', nx - 0.5, hy + 7.5, 2, 1); }
      else px('#3a2a2a', nx * 2 - 1, (hy + 7) * 2 + 1, 4, 1);
    }
    if (sp === 'rabbit' && !(o.happy || o.open)) px('#fff', nx * 2, (hy + 7) * 2 + 2, 2, 2);   // little front teeth
    if (sp === 'cat') { px('#e9e9ef', (hx + 10) * 2, (hy + 5) * 2, 5, 1); px('#e9e9ef', (hx + 10) * 2, (hy + 7) * 2, 5, 1); }   // whiskers
    // cheeks
    if (sp !== 'panda' && sp !== 'raccoon' && sp !== 'owl') px('#f79ab0', (hx + 4) * 2, (hy + 6) * 2, 3, 2);
    return { hx, hy, e1, e2, ey, nx };
  }

  // ---------------------------------------------------------------- what the role wears (anchored on the head and the neck)
  function bandana(g, nx, ny) {
    const { u, L, sh } = g, t = L.team, d = sh(t, 0.75), l = sh(t, 1.25);
    u(t, nx - 1, ny, 8, 1.5); u(d, nx - 1, ny, 8, 0.5); u(t, nx, ny + 1.5, 6, 1.5); u(t, nx + 1, ny + 3, 4, 1); u(t, nx + 2, ny + 4, 2, 1); u(l, nx + 2, ny + 3, 1, 1);
    if (L.chief) { u('#f5c542', nx + 2, ny + 5, 2, 1.5); u('#fff3b0', nx + 2, ny + 5, 1, 0.5); }
    else if (L.lead) { u('#cfd6e6', nx + 2, ny + 5, 2, 1.5); }
  }
  function vest(g, x, y, w, h) {
    const { u, L, sh } = g, t = L.team;
    u(t, x, y, w, h); u(sh(t, 1.2), x, y, w, 0.5); u(sh(t, 0.72), x, y + h - 0.5, w, 0.5);
    if (L.chief) u('#f5c542', x, y, w, 0.5);
    else if (L.lead) u('#cfd6e6', x, y, w, 0.5);
    if (L.icon >= 0 && w > 6) { const pat = g.k.PATTERNS ? g.k.PATTERNS[L.icon % g.k.PATTERNS.length] : null; if (pat) for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) if (pat[r][q] === '1') g.px('#ffffffd9', Math.round((x + w / 2) * 2) - 2 + q, Math.round(y * 2) + 2 + r, 1, 1); }
  }
  function neckKit(g, nx, ny) {
    const { u, L, sh } = g;
    if (L.kit === 5) { const b = L.team; u(b, nx - 1, ny, 3, 2); u(b, nx + 3, ny, 3, 2); u(sh(b, 0.6), nx + 2, ny, 1, 2); u(sh(b, 1.3), nx - 1, ny, 3, 0.5); }   // bow tie
    if (L.kit === 6) { const s = '#f08a24'; u(s, nx - 1, ny, 8, 2); u(sh(s, 1.25), nx - 1, ny, 8, 0.5); u(s, nx + 4, ny + 2, 2, 3); u(sh(s, 0.7), nx + 4, ny + 4, 2, 1); }   // scarf
  }
  function headgear(g, h, o) {
    const { u, px, L, sh } = g, T = L.team;
    switch (L.kit) {
      case 1: u('#2a2a38', h.hx + 1, h.hy - 1, 9, 1); u(T, h.hx - 1, h.hy + 3, 2, 3); u('#2a2a38', h.hx + 9, h.hy + 6, 1, 1); px('#2a2a38', (h.hx + 8) * 2, (h.hy + 8) * 2 + 1, 6, 1); u('#e5484d', h.hx + 7, h.hy + 8, 1, 1); break;
      case 2: u('#2fae5a', h.hx + 1, h.hy + 1, 10, 1.5); u('#1f7a3d', h.hx + 1, h.hy + 2.5, 10, 0.5); u('#2a2a38', h.hx, h.hy + 0.5, 10, 0.5); break;
      case 3: px('#f5c542', (h.hx + 1) * 2, (h.hy - 1) * 2, 2, 7); px('#e5484d', (h.hx + 1) * 2, (h.hy - 1) * 2 - 1, 2, 1); px(K, (h.hx + 1) * 2, (h.hy + 2) * 2 + 1, 2, 1); break;
      case 4: { for (const x of [h.e1, h.e2]) { px('#2a2230', x * 2 - 2, h.ey * 2 - 2, 8, 1); px('#2a2230', x * 2 - 2, h.ey * 2 + 5, 8, 1); px('#2a2230', x * 2 - 2, h.ey * 2 - 2, 1, 8); px('#2a2230', x * 2 + 5, h.ey * 2 - 2, 1, 8); } break; }
      case 7: u('#2f6fa0', h.hx + 2, h.hy - 2, 6, 2); u('#244f73', h.hx + 2, h.hy - 0.5, 6, 0.5); u('#2a2a38', h.hx + 7, h.hy - 0.5, 4, 0.5); u('#f5c542', h.hx + 4, h.hy - 2, 1, 0.5); break;
      case 8: u('#ff5d8f', h.hx + 6, h.hy - 2, 3, 2); u('#ffd1e0', h.hx + 7, h.hy - 1.5, 1, 0.5); u('#ff5d8f', h.hx + 7, h.hy - 3, 1, 1); u('#ff5d8f', h.hx + 6, h.hy - 2, 1, 1); break;
      case 9: u('#f5c542', h.hx + 2, h.hy - 3, 6, 1.5); u('#f5c542', h.hx + 2, h.hy - 5, 1.5, 2.5); u('#f5c542', h.hx + 4.2, h.hy - 6, 1.5, 3.5); u('#f5c542', h.hx + 6.5, h.hy - 5, 1.5, 2.5); u('#e5484d', h.hx + 4.5, h.hy - 3, 1, 1); break;
      case 10: px('#f5c542', h.e2 * 2 - 2, h.ey * 2 - 2, 8, 1); px('#f5c542', h.e2 * 2 - 2, h.ey * 2 + 5, 8, 1); px('#f5c542', h.e2 * 2 - 2, h.ey * 2 - 2, 1, 8); px('#f5c542', h.e2 * 2 + 5, h.ey * 2 - 2, 1, 8); px('#f5c542', h.e2 * 2 + 6, h.ey * 2 + 6, 1, 10); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- tails
  function tailAt(g, x, y, beat, big) {
    const { u, L, p } = g, sp = L.species, w = (beat % 4 < 2) ? 0 : 1;
    if (sp === 'cat') { u(p.tail, x - 1 - w, y + 2, 2, 5); u(p.tail, x - 2 - w, y - 1, 2, 4); u(p.tailTip, x - 2 - w, y - 2, 2, 1); }
    else if (sp === 'dog') { u(p.tail, x - 1 - w, y + 2, 2, 3); u(p.tail, x - 2 - w, y, 2, 3); }
    else if (sp === 'rabbit') { u('#fff', x - 1, y + 4, 3, 3); }
    else if (sp === 'fox') { u(p.tail, x - 4 - w, y + 1, 5, 5); u(p.tail, x - 5 - w, y + 3, 3, 3); u('#fff', x - 5 - w, y + 4, 3, 2); }
    else if (sp === 'raccoon') { u(p.tail, x - 3 - w, y - 1, 4, 7); u(p.tailTip, x - 3 - w, y + 1, 4, 1); u(p.tailTip, x - 3 - w, y + 3, 4, 1); u(p.tailTip, x - 3 - w, y - 1, 4, 1); }
    else if (sp === 'panda') { u('#fff', x - 1, y + 4, 2, 2); }
    else if (sp === 'owl') { u(p.tail, x - 1, y + 4, 3, 4); }
    else { u(p.tail, x - 1, y + 5, 2, 3); }
  }

  // ---------------------------------------------------------------- bodies
  // four legs, on the ground row 22; (bx, by) = top-left of the body. mode: idle | walk | wave | jump
  function walker(g, f, beat, mode) {
    const { u, L, p, sh } = g, ph = f % 4, walk = mode === 'walk';
    const j = mode === 'jump' ? [0, 2, 3, 2][ph] : 0, b = L.build === 1 ? 1 : 0;
    const by = 11 - j, bx = 5 - b;
    const off = walk ? [0, 1, 0, -1][ph] : 0;
    tailAt(g, bx, by - 1, beat);
    // far legs (darker), then the body, then near legs
    u(sh(p.limb, 0.85), bx + 2 + off, by + 6, 2, 4 + j); u(sh(p.limb, 0.85), bx + 10 - off, by + 6, 2, 4 + j);
    u(p.paw, bx + 2 + off, by + 9 + j, 2, 1); u(p.paw, bx + 10 - off, by + 9 + j, 2, 1);
    u(p.body, bx + 1, by, 14 + 2 * b, 7); u(p.body, bx, by + 1, 16 + 2 * b, 5);
    if (L.species === 'fox' || L.species === 'cat' || L.species === 'dog' || L.species === 'rabbit' || L.species === 'raccoon') u(p.belly, bx + 2, by + 5, 12 + 2 * b, 2);
    if (L.species === 'cat') { u(sh(L.fur, 0.85), bx + 4, by, 1, 2); u(sh(L.fur, 0.85), bx + 7, by, 1, 2); u(sh(L.fur, 0.85), bx + 10, by, 1, 2); }
    if (L.species === 'dog') u(p.mark, bx + 6, by + 1, 4, 3);
    if (L.species === 'panda') { u('#2a2a32', bx + 9, by, 5, 3); u('#2a2a32', bx + 2, by + 4, 3, 3); }
    if (L.species === 'raccoon') u(p.mark, bx + 3, by + 1, 1, 2);
    vest(g, bx + 3, by - 0.5, 11 + 2 * b, 3.5);
    u(p.limb, bx + 5 + off, by + 6, 2, 4 + j); u(p.limb, bx + 13 - off, by + 6, 2, 4 + j);   // near legs
    u(p.paw, bx + 5 + off, by + 9 + j, 2, 1); u(p.paw, bx + 13 - off, by + 9 + j, 2, 1);
    let wave = null;
    if (mode === 'wave') { const up = f % 2; u(p.limb, bx + 13, by + 1 - up, 2, 6); u(p.paw, bx + 13, by - up, 2, 1.5); wave = true; }
    const h = head(g, bx + 10 + 0, by - 6 + (walk && ph % 2 ? 0.5 : 0), g.o);
    return { h, nx: bx + 11, ny: by + 3, wave };
  }
  // upright: the sitting mammals and the two birds (penguin and owl stand like this)
  function sitter(g, f, beat, mode, o) {
    const { u, L, p, sh } = g, bird = isBird(L.species), ph = f % 4, walk = mode === 'walk';
    const b = L.build === 1 ? 1 : 0, bob = walk && ph % 2 ? 0 : 0;
    const by = bird ? 9 : 10, bx = 8 - b;
    if (!bird) tailAt(g, bx - 1, by + 7, beat);
    if (bird && L.species === 'penguin') { u('#2a2a3a', bx - 1, by + 2, 2, 6); u('#2a2a3a', bx + 9 + b, by + 2, 2, 6); }   // flippers
    if (bird && L.species === 'owl') { u(L.furD, bx - 1, by + 2, 2, 6); u(L.furD, bx + 9 + b, by + 2, 2, 6); }           // wings
    u(p.body, bx + 1, by, 8 + 2 * b, 11); u(p.body, bx, by + 2, 10 + 2 * b, 8);
    u(p.belly, bx + 2, by + 3, 6 + 2 * b, 7);
    if (L.species === 'owl') for (const [x, y] of [[3, 4], [5, 4], [4, 6], [6, 6], [3, 8], [5, 8]]) u(L.furD, bx + x, by + y, 1, 0.5);
    if (L.species === 'panda') { u('#2a2a32', bx, by + 2, 10 + 2 * b, 2); }
    vest(g, bx + 1, by + 3, 8 + 2 * b, 5);
    // feet
    const fo = walk ? [0, 1, 0, -1][ph] : 0;
    u(p.paw, bx + 1 + fo, by + 10, 3, 1.5); u(p.paw, bx + 6 + b * 2 - fo, by + 10, 3, 1.5);
    // front paws: down, or forward when working / holding a mug
    const reach = o && o.reach;
    if (!bird) { u(p.limb, bx + 7 + b, by + 3, 2, 5); u(p.paw, bx + 7 + b, by + 7, 2, 1); }
    if (reach) { u(p.limb, bx + 8 + b, by + 3, 6, 2); u(p.paw, bx + 13 + b, by + 3, 2, 2); }
    const h = head(g, bx - 1, by - 8 + (walk && ph % 2 ? 0.5 : 0), g.o);
    return { h, nx: bx + 1, ny: by - 0, bx, by };
  }

  // ---------------------------------------------------------------- scenes (what the people's poses do, done for animals)
  function draw(ctx, L, state, f, beat, k) {
    const g = ctxFor(ctx, L, k);
    g.o = { blink: beat % 23 === 0 };
    const bird = isBird(L.species);
    let info = {};
    const FY = k.FY;
    const finish = (r, extra) => {   // the identity: bandana, accessories, then the head gear
      if (!extra || extra.bandana !== false) bandana(g, r.nx, r.ny);
      neckKit(g, r.nx, r.ny);
      headgear(g, r.h, g.o);
    };
    if (state === 'working') {
      const hy = FY - 11;
      k.deskScene(ctx, 24, hy, beat, L.role);
      g.u('#6a4a8a', 3, 19, 11, 1.5); g.u('#4e3568', 3, 20.5, 11, 1);   // a cushion to sit on
      const r = sitter(g, f, beat, 'idle', { reach: true });
      finish(r);
    } else if (state === 'coffee') {
      const sip = beat % 10 >= 7;
      const o = { ...g.o }; if (sip) { o.happy = true; g.o = o; }
      const r = sitter(g, f, beat, 'idle', {});
      finish(r);
      const mx = sip ? 30 : 36, my = sip ? 24 : 30;
      k.R(ctx, '#fff', mx, my, 6, 7); k.R(ctx, '#e3e5f0', mx, my + 6, 6, 1); k.R(ctx, '#fff', mx + 6, my + 2, 2, 3); k.R(ctx, '#6b4a2b', mx, my, 6, 1);
      g.u(L.fur, mx / 2 - 1, my / 2 + 2, 2, 2);
      info = { hy: 34, mx, my, sip };
    } else if (state === 'sofa' || state === 'read') {
      const hy = FY - 11;
      k.sofaBase(ctx, L, 24, hy, true);
      const reading = state === 'read';
      const { u, p } = g;
      const bx = 5, by = 14;
      u(p.body, bx + 1, by, 14, 5); u(p.body, bx, by + 1, 16, 4); u(p.belly, bx + 3, by + 3, 10, 2);
      if (L.species === 'panda') { u('#2a2a32', bx + 3, by, 5, 2); }
      tailAt(g, bx, by + 1, 0);
      u(p.limb, bx + 11, by + 3, 4, 2); u(p.paw, bx + 14, by + 3, 2, 2);   // front paws, tucked
      g.o = reading ? { blink: beat % 23 === 0 } : { closed: true };
      const h = head(g, bx + 11, by - 5, g.o);
      const r = { h, nx: bx + 12, ny: by - 0 };
      bandana(g, r.nx, r.ny + 0.5); headgear(g, h, g.o);
      k.sofaBase(ctx, L, 24, hy, false);
      if (reading) {
        const flip = beat % 14 >= 12;
        k.R(ctx, '#f4f0e0', 38, 24, 12, 11); k.R(ctx, '#4a6fd0', 38, 24, 2, 11); k.R(ctx, '#c9c4b0', 42, 27, 6, 1); k.R(ctx, '#c9c4b0', 42, 30, 6, 1);
        if (flip) k.R(ctx, '#fff', 46, 22, 3, 12);
      } else info = { hy: FY - 11 };
    } else if (state === 'cheer') {
      const r = walker(g, f, beat, 'jump');
      g.o = { happy: true, open: true };
      finish(r);
    } else if (state === 'alert') {
      const r = bird ? sitter(g, f, beat, 'idle', {}) : walker(g, f, beat, 'wave');
      finish(r);
    } else {
      const walk = state === 'walk';
      const r = bird ? sitter(g, f, beat, walk ? 'walk' : 'idle', {}) : walker(g, f, beat, walk ? 'walk' : 'idle');
      finish(r);
    }
    return info;
  }

  const api = { draw, palette };
  root.AnimalSprites = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
