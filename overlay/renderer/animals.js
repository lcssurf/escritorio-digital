// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// The "animals" set: real, cute, cartoon animals (not people with an animal head), small and clean at the same one-pixel detail
// as the people: a round head with big shiny eyes, four stubby legs (the penguin and the owl stand upright), a tail that wags.
// They are told apart the way a pet is: a vest and a bandana in the team's colour (gold for the chief, with a silver medal on
// the coordinators) and the role's accessory on the head (headset, visor, pencil, round glasses, bow tie, scarf, cap, heart,
// crown, monocle). Their life is a pet's: they eat from a bowl, play with a ball, curl up in a pet bed, sit on a stool at the
// computer, and jump when something is approved. Same states as the people: walk, idle, coffee, read, sofa, working, alert, cheer.
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

  function ctxFor(c, L, k) {
    const g = { c, L, k, p: palette(L), sh: k.shade };
    g.r = (col, x, y, w, h) => k.R(c, col, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    return g;
  }

  // ---------------------------------------------------------------- the face
  function eye(g, x, y, o) {
    const r = g.r;
    if (o.closed || o.blink) { r(K, x, y + 2, 2, 1); return; }
    if (o.happy) { r(K, x, y + 2, 1, 1); r(K, x + 1, y + 1, 1, 1); r(K, x + 2, y + 2, 1, 1); return; }
    r(K, x, y, 2, 3); r('#fff', x, y, 1, 1);          // a tall dark eye with a shine: that is what makes it cute
  }
  // the head: 11 x 9 at (hx, hy); ears above (and beside)
  function head(g, hx, hy, o) {
    const { r, L, p } = g, sp = L.species, F = sp === 'penguin' ? p.body : L.fur, D = L.furD;
    const light = sp === 'panda' ? '#f4f4f8' : sp === 'penguin' ? '#fff' : L.muz;
    // ears behind the face
    if (sp === 'cat' || sp === 'fox') {
      for (const x of [hx + 1, hx + 7]) { r(F, x, hy - 1, 3, 2); r(F, x + (x === hx + 1 ? 0 : 1), hy - 2, 2, 1); r(F, x + (x === hx + 1 ? 0 : 2), hy - 3, 1, 1); }
      if (sp === 'fox') { r('#2a2a32', hx + 1, hy - 3, 1, 1); r('#2a2a32', hx + 9, hy - 3, 1, 1); }
      r(sp === 'cat' ? PINK : '#4a3228', hx + 2, hy - 1, 1, 1); r(sp === 'cat' ? PINK : '#4a3228', hx + 8, hy - 1, 1, 1);
    }
    if (sp === 'dog') { r(p.ear, hx - 1, hy + 1, 3, 6); r(p.ear, hx + 9, hy + 1, 3, 5); r(p.ear, hx, hy, 2, 1); }
    if (sp === 'rabbit') { r(F, hx + 2, hy - 8, 2, 8); r(p.earIn, hx + 3, hy - 7, 1, 5); r(F, hx + 6, hy - 9, 2, 9); r(p.earIn, hx + 7, hy - 8, 1, 6); }
    if (sp === 'panda') { r(p.ear, hx, hy - 2, 3, 3); r(p.ear, hx + 8, hy - 2, 3, 3); }
    if (sp === 'raccoon') { r(F, hx + 1, hy - 2, 3, 3); r(p.mark, hx + 1, hy - 2, 3, 1); r(F, hx + 7, hy - 2, 3, 3); r(p.mark, hx + 7, hy - 2, 3, 1); }
    if (sp === 'owl') { r(p.ear, hx + 1, hy - 3, 2, 4); r(p.ear, hx + 8, hy - 3, 2, 4); }
    // face
    r(F, hx + 1, hy, 9, 9); r(F, hx, hy + 1, 11, 7);
    if (sp === 'cat') { r(D, hx + 3, hy, 1, 2); r(D, hx + 5, hy, 1, 2); r(D, hx + 7, hy, 1, 2); r(light, hx + 6, hy + 5, 5, 3); }
    if (sp === 'dog') { r(p.mark, hx + 6, hy + 1, 4, 4); r(light, hx + 6, hy + 5, 5, 3); }
    if (sp === 'rabbit') { r(light, hx + 5, hy + 5, 6, 3); }
    if (sp === 'fox') { r(light, hx + 3, hy + 5, 8, 4); r(light, hx, hy + 5, 3, 3); }
    if (sp === 'raccoon') { r(p.mark, hx, hy + 2, 11, 4); r(light, hx + 6, hy + 6, 5, 2); }
    if (sp === 'panda') { r(p.mark, hx + 1, hy + 2, 3, 4); r(p.mark, hx + 6, hy + 2, 3, 4); r(p.mark, hx + 9, hy + 5, 2, 2); }
    if (sp === 'penguin') { r('#fff', hx + 2, hy + 3, 8, 5); r('#fff', hx + 1, hy + 4, 10, 3); }
    if (sp === 'owl') { r(L.muz, hx + 1, hy + 2, 4, 5); r(L.muz, hx + 6, hy + 2, 4, 5); r(D, hx + 1, hy, 9, 1); }
    // eyes
    const ey = hy + 3, e1 = { x: hx + 2, y: ey }, e2 = { x: hx + 7, y: ey };
    if (sp === 'owl') {
      if (o.closed || o.blink) { r(K, hx + 2, hy + 4, 3, 1); r(K, hx + 7, hy + 4, 3, 1); }
      else { r('#fff', hx + 1, hy + 3, 4, 4); r('#fff', hx + 6, hy + 3, 4, 4); r(K, hx + 3, hy + 4, 2, 2); r(K, hx + 8, hy + 4, 2, 2); r('#fff', hx + 3, hy + 4, 1, 1); r('#fff', hx + 8, hy + 4, 1, 1); }
    } else if (sp === 'panda' || sp === 'raccoon') {
      if (o.closed || o.blink) { r('#fff', e1.x, ey + 1, 2, 1); r('#fff', e2.x, ey + 1, 2, 1); }
      else { r('#fff', e1.x, ey, 2, 3); r('#fff', e2.x, ey, 2, 3); r(K, e1.x + 1, ey + 1, 1, 2); r(K, e2.x + 1, ey + 1, 1, 2); }
    } else { eye(g, e1.x, e1.y, o); eye(g, e2.x, e2.y, o); }
    // nose and mouth
    if (sp === 'owl') { r(p.nose, hx + 4, hy + 5, 3, 3); r('#c47d12', hx + 5, hy + 7, 1, 1); }
    else if (sp === 'penguin') { r(p.nose, hx + 8, hy + 5, 4, 2); r('#c47d12', hx + 8, hy + 6, 4, 1); }
    else {
      r(p.nose, hx + 9, hy + 5, 2, 1);
      if (o.happy || o.open) { r('#8a2a3a', hx + 8, hy + 7, 3, 2); r('#e8808f', hx + 9, hy + 8, 2, 1); }
      else { r('#3a2a2a', hx + 9, hy + 6, 1, 1); r('#3a2a2a', hx + 8, hy + 7, 3, 1); }
      if (sp === 'rabbit' && !(o.happy || o.open)) r('#fff', hx + 9, hy + 8, 1, 1);
      if (sp === 'cat') { r('#e9e9ef', hx + 11, hy + 5, 3, 1); r('#e9e9ef', hx + 11, hy + 7, 3, 1); }
      if (sp !== 'panda' && sp !== 'raccoon') r('#f79ab0', hx + 5, hy + 6, 2, 1);
    }
    return { hx, hy, e1, e2 };
  }

  // ---------------------------------------------------------------- identity: vest, bandana, medals and the role's accessory
  function vest(g, x, y, w, h) {
    const { r, L, sh } = g, t = L.team;
    r(t, x, y, w, h); r(sh(t, 1.25), x, y, w, 1); r(sh(t, 0.7), x, y + h - 1, w, 1);
    if (L.chief) r('#f5c542', x, y, w, 1); else if (L.lead) r('#cfd6e6', x, y, w, 1);
  }
  function bandana(g, nx, ny) {
    const { r, L, sh } = g, t = L.team;
    r(t, nx, ny, 8, 1); r(sh(t, 0.7), nx, ny, 8, 1); r(t, nx, ny + 1, 8, 1); r(t, nx + 1, ny + 2, 6, 1); r(t, nx + 2, ny + 3, 4, 1); r(sh(t, 1.25), nx + 3, ny + 4, 2, 1);
    if (L.chief) { r('#f5c542', nx + 3, ny + 5, 2, 2); r('#fff3b0', nx + 3, ny + 5, 1, 1); }
    else if (L.lead) { r('#cfd6e6', nx + 3, ny + 5, 2, 2); }
  }
  function neckKit(g, nx, ny) {
    const { r, L, sh } = g;
    if (L.kit === 5) { const b = L.team; r(b, nx, ny + 1, 3, 3); r(b, nx + 5, ny + 1, 3, 3); r(sh(b, 0.6), nx + 3, ny + 1, 2, 3); r(sh(b, 1.3), nx, ny + 1, 3, 1); }   // bow tie
    if (L.kit === 6) { const s = '#f08a24'; r(s, nx - 1, ny, 10, 3); r(sh(s, 1.25), nx - 1, ny, 10, 1); r(s, nx + 6, ny + 3, 3, 5); r(sh(s, 0.7), nx + 6, ny + 7, 3, 1); }   // scarf
  }
  function headgear(g, h) {
    const { r, L } = g, T = L.team, hx = h.hx, hy = h.hy, D = '#2a2a38';
    switch (L.kit) {
      case 1: r(D, hx + 1, hy - 1, 9, 1); r(D, hx, hy, 1, 4); r(T, hx - 1, hy + 3, 2, 3); r(D, hx + 9, hy + 6, 1, 3); r(D, hx + 7, hy + 9, 4, 1); r('#e5484d', hx + 7, hy + 8, 2, 2); break;   // headset
      case 2: r('#2fae5a', hx + 1, hy + 1, 10, 2); r('#1f7a3d', hx + 1, hy + 3, 10, 1); r(D, hx, hy, 11, 1); break;                                                                      // green visor
      case 3: r('#f5c542', hx + 3, hy - 4, 1, 6); r('#e5484d', hx + 3, hy - 5, 1, 1); r(K, hx + 3, hy + 2, 1, 1); break;                                                                  // pencil behind the ear
      case 4: for (const e of [h.e1, h.e2]) { r('#2a2230', e.x - 1, e.y - 1, 4, 1); r('#2a2230', e.x - 1, e.y + 3, 4, 1); r('#2a2230', e.x - 1, e.y, 1, 3); r('#2a2230', e.x + 2, e.y, 1, 3); } break;   // round glasses
      case 7: r('#2f6fa0', hx + 2, hy - 3, 7, 3); r('#244f73', hx + 2, hy - 1, 7, 1); r(D, hx + 8, hy - 1, 4, 1); r('#f5c542', hx + 5, hy - 3, 1, 1); break;                                  // courier cap
      case 8: r('#ff5d8f', hx + 7, hy - 3, 3, 2); r('#ffd1e0', hx + 8, hy - 3, 1, 1); r('#ff5d8f', hx + 8, hy - 4, 1, 1); r('#ff5d8f', hx + 7, hy - 4, 1, 1); r('#ff5d8f', hx + 9, hy - 4, 1, 1); break;   // heart
      case 9: r('#f5c542', hx + 2, hy - 4, 7, 2); r('#f5c542', hx + 2, hy - 6, 2, 2); r('#f5c542', hx + 5, hy - 7, 2, 3); r('#f5c542', hx + 8, hy - 6, 2, 2); r('#e5484d', hx + 5, hy - 4, 1, 1); break;   // crown
      case 10: { const e = h.e2; r('#f5c542', e.x - 1, e.y - 1, 4, 1); r('#f5c542', e.x - 1, e.y + 3, 4, 1); r('#f5c542', e.x - 1, e.y, 1, 3); r('#f5c542', e.x + 2, e.y, 1, 3); r('#f5c542', e.x + 3, e.y + 4, 1, 6); break; }   // monocle
      default: break;
    }
  }
  function identity(g, h) {
    bandana(g, h.hx + 1, h.hy + 9); neckKit(g, h.hx + 1, h.hy + 9); headgear(g, h);
  }

  // ---------------------------------------------------------------- tails
  function tail(g, x, y, beat) {
    const { r, L, p } = g, sp = L.species, w = (beat % 4 < 2) ? 0 : 1;
    if (sp === 'cat') { r(p.tail, x - 3 - w, y - 2, 2, 7); r(p.tail, x - 2, y + 3, 3, 2); r(p.tailTip, x - 3 - w, y - 3, 2, 2); }
    else if (sp === 'dog') { r(p.tail, x - 3 - w, y, 2, 5); r(p.tail, x - 2, y + 3, 3, 2); }
    else if (sp === 'rabbit') { r('#fff', x - 3, y + 2, 4, 4); }
    else if (sp === 'fox') { r(p.tail, x - 8 - w, y + 1, 8, 5); r(p.tail, x - 6 - w, y, 5, 7); r('#fff', x - 8 - w, y + 2, 3, 3); }
    else if (sp === 'raccoon') { r(p.tail, x - 6 - w, y - 2, 6, 8); r(p.tailTip, x - 6 - w, y, 6, 1); r(p.tailTip, x - 6 - w, y + 2, 6, 1); r(p.tailTip, x - 6 - w, y + 4, 6, 1); }
    else if (sp === 'panda') { r('#fff', x - 3, y + 2, 4, 3); }
    else if (sp === 'owl') { r(p.tail, x - 2, y + 5, 3, 5); }
    else { r(p.tail, x - 3, y + 6, 3, 3); }
  }

  // ---------------------------------------------------------------- bodies
  // four legs: gx = left of the body, by = top of the body
  function walker(g, f, beat, mode, opt) {
    const { r, L, p, sh } = g, ph = f % 4, walk = mode === 'walk', b = L.build === 1 ? 1 : 0;
    const dy = mode === 'jump' ? [0, 3, 5, 3][ph] : 0, off = walk ? [0, 1, 0, -1][ph] : 0;
    const gx = 10 - b, by = 31 - dy, bw = 18 + 2 * b;
    tail(g, gx, by, beat);
    const leg = 5, ly = by + 8;
    r(sh(p.limb, 0.85), gx + 2 + off, ly, 2, leg); r(sh(p.limb, 0.85), gx + bw - 6 - off, ly, 2, leg);
    r(p.paw, gx + 2 + off, ly + leg - 1, 2, 1); r(p.paw, gx + bw - 6 - off, ly + leg - 1, 2, 1);
    r(p.body, gx + 1, by, bw - 2, 9); r(p.body, gx, by + 1, bw, 7);
    r(p.belly, gx + 2, by + 6, bw - 4, 3);
    if (L.species === 'cat') { r(sh(L.fur, 0.82), gx + 5, by, 1, 3); r(sh(L.fur, 0.82), gx + 8, by, 1, 3); r(sh(L.fur, 0.82), gx + 11, by, 1, 3); }
    if (L.species === 'dog') r(p.mark, gx + 8, by + 1, 5, 4);
    if (L.species === 'panda') { r('#2a2a32', gx + bw - 7, by, 6, 4); r('#2a2a32', gx + 1, by + 5, 4, 4); }
    if (L.species === 'raccoon') r(p.mark, gx + 3, by + 1, 1, 3);
    vest(g, gx + 4, by, bw - 8, 4);
    r(p.limb, gx + 5 + off, ly, 2, leg); r(p.limb, gx + bw - 3 - off, ly, 2, leg);
    r(p.paw, gx + 5 + off, ly + leg - 1, 2, 1); r(p.paw, gx + bw - 3 - off, ly + leg - 1, 2, 1);
    if (mode === 'wave') { const up = f % 2; r(p.limb, gx + bw - 3, by - 2 - up, 2, 8); r(p.paw, gx + bw - 3, by - 3 - up, 2, 2); }
    const hdx = (opt && opt.hdx) || 0, hdy = (opt && opt.hdy) || 0;
    const h = head(g, gx + bw - 4 + hdx, by - 7 + hdy + (walk && ph % 2 ? 1 : 0), g.o);
    return h;
  }
  // upright: the sitting mammals, and the birds standing
  function sitter(g, f, beat, mode, opt) {
    const { r, L, p, sh } = g, bird = isBird(L.species), ph = f % 4, walk = mode === 'walk', b = L.build === 1 ? 1 : 0;
    const lift = (opt && opt.lift) || 0, bx = 19 - b, by = 34 - lift, w = 9 + 2 * b;
    if (!bird) tail(g, bx, by + 2, beat);
    if (bird) { r(L.species === 'penguin' ? '#2a2a3a' : L.furD, bx - 2, by + 2, 2, 6); r(L.species === 'penguin' ? '#2a2a3a' : L.furD, bx + w, by + 2, 2, 6); }   // flippers / wings
    r(p.body, bx + 1, by, w - 2, 8); r(p.body, bx, by + 1, w, 7);
    r(p.belly, bx + 2, by + 3, w - 4, 5);
    if (L.species === 'owl') for (const [x, y] of [[3, 4], [5, 4], [4, 6], [6, 6]]) r(L.furD, bx + x, by + y, 1, 1);
    if (L.species === 'panda') r('#2a2a32', bx, by + 1, w, 2);
    vest(g, bx + 1, by + 2, w - 2, 5);
    const fo = walk ? [0, 1, 0, -1][ph] : 0;
    r(p.paw, bx + fo, by + 8, 4, 2); r(p.paw, bx + w - 4 - fo, by + 8, 4, 2);
    if (!bird) { r(p.limb, bx + w - 2, by + 2, 2, 5); r(p.paw, bx + w - 2, by + 6, 2, 1); }
    if (opt && opt.reach) { r(p.limb, bx + w - 2, by + 3, 7, 2); r(p.paw, bx + w + 4, by + 3, 2, 2); }
    return head(g, bx - 2, by - 9 + ((opt && opt.hdy) || 0) + (walk && ph % 2 ? 1 : 0), g.o);
  }

  // one toy per animal, so nobody wonders what that is: a ball of yarn, a bone, a carrot, bamboo, a fish, a mouse, a cookie, a tennis ball
  function toy(g, sp, x, y, beat) {
    const r = g.r;
    if (sp === 'cat') { r('#a87bd6', x + 1, y - 6, 5, 6); r('#a87bd6', x, y - 5, 7, 4); r('#c9a8ee', x + 1, y - 5, 2, 1); r('#8a5cb8', x + 1, y - 3, 5, 1); r('#8a5cb8', x + 2, y - 5, 1, 4); r('#a87bd6', x - 3, y - 1, 3, 1); r('#a87bd6', x - 4, y, 2, 1); }   // yarn with its thread
    else if (sp === 'dog') { r('#f4f0e0', x + 1, y - 3, 7, 2); r('#f4f0e0', x, y - 4, 2, 4); r('#f4f0e0', x + 7, y - 4, 2, 4); r('#d6d0bc', x + 1, y - 2, 7, 1); }   // a bone
    else if (sp === 'rabbit') { r('#f08a24', x + 1, y - 7, 3, 4); r('#f08a24', x + 2, y - 3, 1, 3); r('#d4701a', x + 1, y - 5, 3, 1); r('#30a46c', x, y - 10, 2, 3); r('#30a46c', x + 3, y - 10, 2, 3); r('#30a46c', x + 2, y - 9, 1, 2); }   // a carrot
    else if (sp === 'panda') { r('#4cb86a', x + 2, y - 9, 3, 9); r('#2f8f4a', x + 2, y - 6, 3, 1); r('#2f8f4a', x + 2, y - 2, 3, 1); r('#7fd68f', x + 2, y - 9, 1, 9); r('#4cb86a', x + 5, y - 8, 3, 2); }   // bamboo
    else if (sp === 'penguin') { r('#7aa6d6', x + 1, y - 5, 6, 3); r('#5a86b6', x + 1, y - 3, 6, 1); r('#7aa6d6', x + 7, y - 6, 2, 5); r('#fff', x + 2, y - 5, 1, 1); r(K, x + 2, y - 4, 1, 1); }   // a fish
    else if (sp === 'owl') { r('#b9b4c4', x + 1, y - 4, 6, 3); r('#b9b4c4', x + 5, y - 5, 2, 2); r('#f2a0b0', x + 5, y - 5, 1, 1); r(K, x + 6, y - 3, 1, 1); r('#f2a0b0', x - 3, y - 2, 4, 1); }   // a mouse with a tail
    else if (sp === 'raccoon') { r('#d9a05b', x + 1, y - 6, 5, 6); r('#d9a05b', x, y - 5, 7, 4); r('#7a4a22', x + 2, y - 5, 1, 1); r('#7a4a22', x + 4, y - 4, 1, 1); r('#7a4a22', x + 2, y - 2, 1, 1); r('#e8be85', x + 1, y - 6, 3, 1); }   // a cookie
    else { r('#c8e65a', x + 1, y - 6, 5, 6); r('#c8e65a', x, y - 5, 7, 4); r('#fff', x + 1, y - 5, 1, 4); r('#fff', x + 2, y - 6, 3, 1); r('#9fc23a', x + 5, y - 5, 1, 4); }   // a tennis ball
  }

  // ---------------------------------------------------------------- scenes
  function draw(ctx, L, state, f, beat, k) {
    const g = ctxFor(ctx, L, k), FY = k.FY, bird = isBird(L.species), r = g.r;
    g.o = { blink: beat % 23 === 0 };
    let info = { mx: -20, my: -20, sip: true };
    if (state === 'working') {
      const lift = 6;
      k.deskScene(ctx, 24, FY - 11, beat, L.role);
      r('#6a4a8a', 14, FY - lift, 14, 3); r('#4e3568', 14, FY - lift + 3, 14, 3); r('#8a6aaa', 14, FY - lift, 14, 1);   // a stool with a cushion
      const h = sitter(g, f, beat, 'idle', { lift, reach: true });
      identity(g, h);
    } else if (state === 'coffee') {   // eating from a bowl
      const nib = beat % 2 ? 1 : 0;
      r('#e5e5ee', 36, FY - 4, 9, 4); r('#c9c9d6', 37, FY - 1, 7, 1); r('#a5632a', 37, FY - 4, 7, 1); r('#8a5a2b', 38 + (beat % 3), FY - 5, 2, 1);
      const h = bird ? sitter(g, f, beat, 'idle', { hdy: 2 + nib }) : walker(g, f, beat, 'idle', { hdx: 5, hdy: 6 + nib });
      identity(g, h);
    } else if (state === 'read') {     // playing with its own toy, one that tells what it is
      const bounce = [0, 3, 5, 3][beat % 4], tx = 38 + [0, 1, 2, 1][beat % 4];
      toy(g, L.species, tx, FY - bounce, beat);
      const h = bird ? sitter(g, f, beat, 'idle', { hdy: 1 }) : walker(g, f, beat, 'idle', { hdx: 3, hdy: 3 });
      identity(g, h);
    } else if (state === 'sofa') {     // curled up in a pet bed
      r('#8a3f5a', 9, FY - 6, 30, 6); r('#a85a75', 10, FY - 7, 28, 2); r('#6a2f45', 9, FY - 1, 30, 1); r('#8a3f5a', 11, FY - 8, 26, 1);
      const p = g.p, bx = 13, by = FY - 13;
      tail(g, bx + 4, by + 9, 0);
      r(p.body, bx + 1, by + 2, 20, 8); r(p.body, bx, by + 3, 22, 6); r(p.belly, bx + 4, by + 8, 14, 2);
      vest(g, bx + 6, by + 2, 9, 3);
      r(p.limb, bx + 14, by + 7, 8, 3); r(p.paw, bx + 20, by + 7, 3, 3);
      g.o = { closed: true };
      const h = head(g, bx + 14, by - 1, g.o);
      identity(g, h);
      r('#8a3f5a', 9, FY - 4, 30, 4); r('#a85a75', 10, FY - 5, 28, 1); r('#6a2f45', 9, FY - 1, 30, 1);   // the front of the bed
      info = { hy: FY - 13, mx: -20, my: -20, sip: true };
    } else if (state === 'cheer') {
      g.o = { happy: true, open: true };
      identity(g, bird ? sitter(g, f, beat, 'idle', { hdy: -[0, 3, 5, 3][f % 4] }) : walker(g, f, beat, 'jump'));
    } else if (state === 'alert') {
      identity(g, bird ? sitter(g, f, beat, 'idle', {}) : walker(g, f, beat, 'wave'));
    } else {
      const walk = state === 'walk';
      identity(g, bird ? sitter(g, f, beat, walk ? 'walk' : 'idle', {}) : walker(g, f, beat, walk ? 'walk' : 'idle'));
    }
    return info;
  }

  const api = { draw, palette };
  root.AnimalSprites = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
