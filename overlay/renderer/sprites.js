// Pixel-art office workers, drawn with rectangles on a small canvas that CSS scales up (no image files).
// Every look comes from the agent's id: skin, hair, suit, tie, glasses and the desk prop of its role.
// Pipeline per frame: body/props -> dark outline pass (so they read on any taskbar colour) -> effects (steam, zzz, bubbles).
(function (root) {
  const W = 56, H = 46, CX = 24, FY = 44; // canvas size, body centre column, ground row (exclusive)
  const OUT = [27, 24, 36];

  const SKINS = ['#f6d0a4', '#e8b685', '#c98f5c', '#8d5a3a', '#ffdcb8'];
  const HAIRS = ['#2a2230', '#5b3a29', '#9a5b33', '#d1a43a', '#c9c9d2', '#8a3030', '#3a4a7a'];
  const SUITS = ['#3e5483', '#383848', '#7a4568', '#2f7364', '#8a4545', '#58702f', '#2f6fa0'];
  const TIES = ['#e5484d', '#f5a524', '#3b9cf2', '#8b5cf6', '#30a46c'];
  const ROLES = ['agenda', 'docs', 'drafts', 'review', 'deadlines'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  function look(seed) {
    const h = hash(String(seed)), pick = (arr, n) => arr[(h >>> n) % arr.length];
    const skin = pick(SKINS, 0), hair = pick(HAIRS, 3), suit = pick(SUITS, 6);
    return { skin, skinD: shade(skin, 0.86), hair, hairL: shade(hair, 1.3), suit, suitD: shade(suit, 0.76), suitL: shade(suit, 1.18),
             tie: pick(TIES, 9), long: ((h >>> 12) % 3) === 0, glasses: ((h >>> 15) % 4) === 0, role: (h >>> 18) % ROLES.length,
             pants: '#2b2b3a', pantsD: '#21212d' };
  }
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // ---------------------------------------------------------------- body parts
  function head(c, L, x, hy, o) {
    o = o || {};
    if (L.long) { R(c, L.hair, x - 6, hy - 16, 3, 12); R(c, L.hairL, x - 6, hy - 16, 1, 12); }
    R(c, L.skinD, x - 1, hy - 10, 3, 2);                                   // neck
    R(c, L.skin, x - 3, hy - 17, 9, 8);                                    // face
    R(c, L.skinD, x - 3, hy - 11, 9, 1);                                   // jaw shade
    R(c, L.hair, x - 5, hy - 20, 12, 4); R(c, L.hairL, x - 3, hy - 20, 6, 1);   // hair top
    R(c, L.hair, x - 5, hy - 17, 3, 7);                                    // back hair
    R(c, L.hair, x - 3, hy - 17, 9, 1);                                    // fringe
    // eyes (looking right), blink / happy / closed
    const ex = x + 1;
    if (o.closed) { R(c, '#2a2230', ex, hy - 13, 2, 1); R(c, '#2a2230', ex + 3, hy - 13, 2, 1); }
    else if (o.happy) { R(c, '#2a2230', ex, hy - 14, 1, 1); R(c, '#2a2230', ex + 1, hy - 13, 1, 1); R(c, '#2a2230', ex + 3, hy - 14, 1, 1); R(c, '#2a2230', ex + 4, hy - 13, 1, 1); }
    else if (o.blink) { R(c, '#2a2230', ex, hy - 13, 2, 1); R(c, '#2a2230', ex + 3, hy - 13, 2, 1); }
    else { R(c, '#fff', ex, hy - 14, 2, 3); R(c, '#fff', ex + 3, hy - 14, 2, 3); R(c, '#2a2230', ex + 1, hy - 14, 1, 3); R(c, '#2a2230', ex + 4, hy - 14, 1, 3); }
    if (L.glasses) { R(c, '#2a2230', ex - 1, hy - 15, 4, 1); R(c, '#2a2230', ex + 2, hy - 15, 4, 1); R(c, '#2a2230', ex - 1, hy - 12, 4, 1); R(c, '#2a2230', ex + 2, hy - 12, 4, 1); }
    R(c, o.open ? '#7a3535' : '#b86a6a', x + 2, hy - 11, o.happy || o.open ? 3 : 2, 1);   // mouth
    R(c, '#f2a0a0', x, hy - 12, 1, 1);                                     // cheek
  }
  function torso(c, L, x, hy) {
    R(c, L.suit, x - 4, hy - 9, 9, 9);
    R(c, L.suitD, x - 4, hy - 9, 2, 9);
    R(c, L.suitL, x + 3, hy - 9, 1, 9);
    R(c, '#f4f4f8', x, hy - 9, 3, 4);                                      // shirt
    R(c, L.tie, x + 1, hy - 8, 1, 6); R(c, shade(L.tie, 0.8), x + 1, hy - 3, 1, 1);
    R(c, '#1b1824', x - 4, hy - 1, 9, 1);                                  // belt
  }
  function legsStand(c, L, x, hy, offFar, offNear) {
    const len = FY - 2 - hy;
    R(c, L.pantsD, x - 3 + offFar, hy, 3, len); R(c, '#111018', x - 4 + offFar, FY - 2, 4, 2);
    R(c, L.pants, x + 1 + offNear, hy, 3, len); R(c, '#1b1824', x + 0 + offNear, FY - 2, 5, 2);
  }
  function arm(c, L, x, hy, side, dx, dy) {   // side: -1 far arm, 1 near arm; dx/dy swing of the hand
    const ax = side > 0 ? x + 4 : x - 6, col = side > 0 ? L.suit : L.suitD;
    R(c, col, ax, hy - 8, 2, 4);
    R(c, col, ax + dx, hy - 5 + dy, 2, 3);
    R(c, L.skin, ax + dx, hy - 2 + dy, 2, 2);
  }

  // ---------------------------------------------------------------- poses
  function standing(c, L, x, f, mode, beat) {
    const walk = mode === 'walk', ph = f % 4, bob = walk && ph % 2 ? -1 : 0, hy = FY - 8 + bob;
    const sw = walk ? [0, 2, 0, -2][ph] : 0;
    legsStand(c, L, x, hy, -sw, sw);
    torso(c, L, x, hy);
    arm(c, L, x, hy, -1, walk ? -[0, 1, 0, -1][ph] : 0, 0);
    head(c, L, x, hy, { blink: beat % 23 === 0 });
    if (mode === 'wave') {
      const up = f % 2;
      R(c, L.suit, x + 4, hy - 15 - up, 2, 8); R(c, L.skin, x + 4, hy - 17 - up, 2, 2);
    } else arm(c, L, x, hy, 1, walk ? [0, 1, 0, -1][ph] : 0, 0);
    return hy;
  }

  function propFor(c, role, x, y, f) {   // small desk prop of the agent's role, sitting on the desk top (y)
    if (role === 0) { R(c, '#fff', x, y - 6, 6, 6); R(c, '#e5484d', x, y - 6, 6, 2); R(c, '#777', x + 1, y - 3, 4, 1); R(c, '#777', x + 1, y - 1, 3, 1); }               // calendar
    else if (role === 1) { R(c, '#f5a524', x, y - 3, 7, 3); R(c, '#fff', x + 1, y - 6, 6, 3); R(c, '#e8d9a0', x, y - 8, 6, 2); }                                         // folders
    else if (role === 2) { R(c, '#8b5cf6', x, y - 6, 5, 6); R(c, '#fff', x + 1, y - 5, 4, 1); R(c, '#fff', x + 1, y - 3, 3, 1); R(c, '#f5a524', x + 6, y - 5, 1, 5); }   // book + pen
    else if (role === 3) { R(c, '#a8d8f0', x + 1, y - 6, 4, 4); R(c, '#2a2230', x, y - 7, 6, 1); R(c, '#2a2230', x, y - 2, 6, 1); R(c, '#2a2230', x, y - 7, 1, 5); R(c, '#2a2230', x + 5, y - 7, 1, 5); R(c, '#8a6a3a', x + 5, y - 2, 3, 1); } // magnifier
    else { R(c, '#e5484d', x, y - 6, 6, 6); R(c, '#fff', x + 1, y - 5, 4, 4); R(c, '#2a2230', x + 3, y - 5, 1, 2 + (f % 2)); R(c, '#2a2230', x + 3, y - 3, 2, 1); }      // alarm clock
  }

  function working(c, L, x, f, beat) {
    const hy = FY - 11;
    // chair
    R(c, '#5b5d78', x - 8, hy - 9, 2, 12); R(c, '#4a4c64', x - 7, hy + 3, 10, 2);
    R(c, '#3c3e52', x - 3, hy + 5, 2, FY - hy - 6); R(c, '#3c3e52', x - 7, FY - 1, 10, 1);
    // legs sitting
    R(c, L.pants, x - 3, hy, 8, 3); R(c, L.pants, x + 3, hy + 3, 3, FY - hy - 5); R(c, '#1b1824', x + 3, FY - 2, 5, 2);
    // desk
    R(c, '#a8723a', x + 7, hy - 2, 21, 3); R(c, '#7a4f25', x + 7, hy + 1, 21, 1);
    R(c, '#7a4f25', x + 8, hy + 2, 3, FY - hy - 2); R(c, '#7a4f25', x + 24, hy + 2, 3, FY - hy - 2);
    // monitor: stand, frame, animated screen
    R(c, '#8d93a3', x + 15, hy - 4, 4, 2); R(c, '#8d93a3', x + 14, hy - 3, 6, 1);
    R(c, '#2a2f45', x + 10, hy - 15, 14, 11); R(c, '#1c2036', x + 11, hy - 14, 12, 9);
    const lines = [[0, 8], [1, 6], [2, 9], [3, 5]];
    for (const [i, w] of lines) {
      const on = (Math.floor(beat / 2) + i) % 4 !== 0;
      R(c, i % 2 ? '#7fd6ff' : '#8ce99a', x + 12, hy - 13 + i * 2, on ? w : Math.max(2, w - 3), 1);
    }
    if (beat % 4 < 2) R(c, '#fff', x + 12 + 9, hy - 13 + 6, 1, 1);          // cursor
    R(c, '#d7dae8', x + 11, hy - 3, 7, 1);                                   // keyboard
    R(c, '#fff', x + 25, hy - 5, 3, 3); R(c, '#6b4a2b', x + 25, hy - 5, 3, 1); R(c, '#fff', x + 28, hy - 4, 1, 1);   // mug
    propFor(c, L.role, x + 20, hy - 2, beat);
    // worker
    torso(c, L, x, hy);
    R(c, L.suitD, x - 6, hy - 8, 2, 5);
    head(c, L, x, hy, { blink: beat % 23 === 0 });
    R(c, L.suit, x + 4, hy - 8, 2, 3);                                       // upper arm
    R(c, L.suit, x + 5, hy - 6, 6, 2);                                       // forearm to the keyboard
    R(c, L.skin, x + 10 + (beat % 2), hy - 5, 2, 2);                         // typing hand
  }

  function coffee(c, L, x, f, beat) {
    const sip = beat % 10 >= 7;
    const hy = standing(c, L, x, 0, 'idle', beat);
    // redraw the near arm bent, holding the mug
    R(c, L.suit, x + 4, hy - 8, 2, 3); R(c, L.suit, x + 5, hy - 6, 4, 2);
    const mx = sip ? x + 4 : x + 8, my = sip ? hy - 13 : hy - 10;
    R(c, L.skin, mx - 1, my + 2, 2, 2);
    R(c, '#fff', mx, my, 4, 5); R(c, '#e3e5f0', mx, my + 4, 4, 1); R(c, '#fff', mx + 4, my + 1, 1, 3); R(c, '#6b4a2b', mx, my, 4, 1);
    if (sip) head(c, L, x, hy, { happy: true });
    return { hy, mx, my, sip };
  }

  function sofaBase(c, L, x, hy, back) {
    const body = '#8a3f5a', dk = '#6a2f45', lt = '#a85a75';
    if (back) { R(c, dk, x - 13, hy - 8, 27, 13); R(c, shade(dk, 1.15), x - 12, hy - 7, 25, 2); return; }
    R(c, body, x - 13, hy + 1, 27, FY - hy - 1); R(c, lt, x - 13, hy + 1, 27, 2);
    R(c, dk, x - 15, hy - 4, 4, FY - hy + 4); R(c, dk, x + 12, hy - 4, 4, FY - hy + 4);
    R(c, '#3a3a4a', x - 14, FY - 1, 3, 1); R(c, '#3a3a4a', x + 12, FY - 1, 3, 1);
  }
  function sofaSleep(c, L, x, f, beat) {
    const hy = FY - 11;
    sofaBase(c, L, x, hy, true);
    torso(c, L, x, hy); R(c, L.suitD, x - 6, hy - 8, 2, 6);
    head(c, L, x, hy, { closed: true });
    R(c, L.suit, x + 4, hy - 7, 2, 5); R(c, L.skin, x + 4, hy - 2, 2, 2);
    sofaBase(c, L, x, hy, false);
    return hy;
  }
  function sofaRead(c, L, x, f, beat) {
    const hy = FY - 11;
    sofaBase(c, L, x, hy, true);
    torso(c, L, x, hy); R(c, L.suitD, x - 6, hy - 8, 2, 6);
    head(c, L, x, hy, { blink: beat % 23 === 0 });
    const flip = beat % 14 >= 12;
    R(c, '#f4f0e0', x + 3, hy - 8, 7, 7); R(c, '#4a6fd0', x + 3, hy - 8, 1, 7);          // book
    R(c, '#c9c4b0', x + 6, hy - 7, 3, 1); R(c, '#c9c4b0', x + 6, hy - 5, 3, 1);
    if (flip) { R(c, '#fff', x + 8, hy - 9, 2, 6); }
    R(c, L.skin, x + 3, hy - 3, 2, 2); R(c, L.suit, x + 2, hy - 6, 2, 4);
    sofaBase(c, L, x, hy, false);
    return hy;
  }

  function cheer(c, L, x, f, beat) {
    const ph = f % 4, j = [0, -3, -5, -3][ph], hy = FY - 8 + j;
    legsStand(c, L, x, hy, -1, 1);
    torso(c, L, x, hy);
    R(c, L.suitD, x - 7, hy - 16, 2, 8); R(c, L.skin, x - 7, hy - 18, 2, 2);
    R(c, L.suit, x + 5, hy - 16, 2, 8); R(c, L.skin, x + 5, hy - 18, 2, 2);
    head(c, L, x, hy, { happy: true, open: true });
    return hy;
  }

  // ---------------------------------------------------------------- outline + effects
  function outline(ctx) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data, out = new Uint8ClampedArray(d);
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 200;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 200) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) { out[i] = OUT[0]; out[i + 1] = OUT[1]; out[i + 2] = OUT[2]; out[i + 3] = 255; }
    }
    img.data.set(out); ctx.putImageData(img, 0, 0);
  }
  function bubble(c, x, y, glyph, f) {      // speech bubble; glyph: '!' | 'ok'
    R(c, '#1b1824', x - 7, y, 15, 14); R(c, '#1b1824', x - 6, y - 1, 13, 16);
    R(c, '#fff', x - 6, y + 1, 13, 12); R(c, '#fff', x - 5, y, 11, 14);
    R(c, '#1b1824', x - 1, y + 14, 4, 2); R(c, '#fff', x, y + 14, 2, 1);
    if (glyph === '!') { R(c, '#e5484d', x, y + 3, 3, 5); R(c, '#e5484d', x, y + 9, 3, 2); }
    else { R(c, '#30a46c', x - 3, y + 7, 2, 2); R(c, '#30a46c', x - 1, y + 8, 2, 2); R(c, '#30a46c', x + 1, y + 6, 2, 2); R(c, '#30a46c', x + 3, y + 4, 2, 2); }
  }
  function fx(c, state, info, f, beat) {
    if (state === 'coffee' && !info.sip) {
      R(c, 'rgba(255,255,255,0.85)', info.mx + 1 + (beat % 2), info.my - 3, 1, 2);
      R(c, 'rgba(255,255,255,0.6)', info.mx + 2 - (beat % 2), info.my - 6, 1, 2);
    }
    if (state === 'sofa') {
      const z = beat % 8, a = Math.min(1, 0.4 + z * 0.1), col = 'rgba(255,255,255,' + a + ')';
      const zx = CX + 8, zy = info.hy - 14 - Math.floor(z / 2);
      R(c, col, zx, zy, 3, 1); R(c, col, zx + 2, zy + 1, 1, 1); R(c, col, zx + 1, zy + 2, 1, 1); R(c, col, zx, zy + 3, 3, 1);
      if (z > 3) { R(c, col, zx + 5, zy - 5, 2, 1); R(c, col, zx + 6, zy - 4, 1, 1); R(c, col, zx + 5, zy - 3, 2, 1); }
    }
    if (state === 'alert') bubble(c, CX, 1 + (f % 2), '!', f);
    if (state === 'cheer') {
      const cols = ['#e5484d', '#f5a524', '#3b9cf2', '#30a46c', '#8b5cf6'];
      for (let i = 0; i < 9; i++) {
        const t = (beat * 2 + i * 5) % 22, px = CX - 14 + ((i * 13) % 29), py = 2 + t;
        R(c, cols[i % 5], px, py, 2, 2);
      }
      bubble(c, CX + 15, 3, 'ok', f);
    }
  }

  function draw(ctx, lk, state, frame, facing, beat) {
    beat = beat == null ? frame : beat;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (facing < 0) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    let info = {};
    if (state === 'working') working(ctx, lk, CX, frame, beat);
    else if (state === 'coffee') info = coffee(ctx, lk, CX, frame, beat);
    else if (state === 'sofa') info = { hy: sofaSleep(ctx, lk, CX, frame, beat) };
    else if (state === 'read') sofaRead(ctx, lk, CX, frame, beat);
    else if (state === 'cheer') cheer(ctx, lk, CX, frame, beat);
    else if (state === 'alert') standing(ctx, lk, CX, frame, 'wave', beat);
    else standing(ctx, lk, CX, frame, state === 'walk' ? 'walk' : 'idle', beat);
    outline(ctx);
    fx(ctx, state, info, frame, beat);
    ctx.restore();
  }

  root.Sprites = { W, H, CX, ROLES, look, draw, hash, shade };
  if (typeof module === 'object' && module.exports) module.exports = root.Sprites;
})(typeof self !== 'undefined' ? self : this);
