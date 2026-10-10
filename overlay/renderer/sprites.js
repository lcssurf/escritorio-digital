// Pixel-art office workers, drawn with rectangles on a tiny canvas (48x40) that CSS scales up.
// No image files: every look is a few colours, so every agent can be different. Nothing here is copied from any game.
(function (root) {
  const W = 48, H = 40, CX = 20, FY = 38; // canvas size, body centre column, ground row

  const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const HAIRS = ['#1f1f1f', '#5b3a29', '#a0522d', '#c9a227', '#cfcfcf', '#7a2e2e'];
  const SUITS = ['#3b4a6b', '#2f2f3a', '#6b3b5c', '#2f6b5a', '#7a3b3b', '#4a5a2f', '#2b5f8a'];
  const TIES = ['#e03131', '#f08c00', '#1c7ed6', '#7048e8', '#37b24d'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function look(seed) {
    const h = hash(String(seed));
    const pick = (arr, n) => arr[(h >>> n) % arr.length];
    return { skin: pick(SKINS, 0), hair: pick(HAIRS, 3), suit: pick(SUITS, 6), tie: pick(TIES, 9),
             pants: '#23232e', long: ((h >>> 12) % 3) === 0, glasses: ((h >>> 15) % 4) === 0 };
  }
  function dark(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // head + torso, hip row = hy (facing right)
  function upper(c, L, x, hy, opts) {
    const o = opts || {};
    if (L.long) R(c, L.hair, x - 4, hy - 13, 2, 9, L.hair);
    R(c, L.suit, x - 3, hy - 8, 7, 8, L.suit);                 // jacket
    R(c, '#f4f4f4', x + 1, hy - 8, 2, 3, '#f4f4f4');           // shirt
    R(c, L.tie, x + 1, hy - 6, 1, 4, L.tie);
    R(c, L.skin, x - 3, hy - 13, 6, 5, L.skin);                // face
    R(c, L.hair, x - 3, hy - 16, 7, 3, L.hair);                // hair top
    R(c, L.hair, x - 4, hy - 15, 2, 4, L.hair);                // hair back
    if (L.glasses) R(c, '#223', x + 0, hy - 12, 4, 2, '#223');
    if (!o.eyesClosed) R(c, '#1c1c24', x + 1, hy - 11, 1, 1, '#1c1c24');
    else R(c, '#1c1c24', x + 1, hy - 11, 2, 1, '#1c1c24');
    R(c, dark(L.suit, 0.75), x - 4, hy - 7, 1, 6, dark(L.suit, 0.75)); // far arm
  }

  function standing(c, L, x, frame, walking) {
    const bob = walking && frame % 2 ? -1 : 0;
    const hy = FY - 7;
    // legs
    const a = walking ? (frame % 2 ? 1 : -1) : 0;
    R(c, L.pants, x - 3 + a, hy + bob, 3, 6, L.pants);
    R(c, L.pants, x + 1 - a, hy + bob, 3, 6, L.pants);
    R(c, '#111', x - 3 + a, FY - 1, 4, 1, '#111');
    R(c, '#111', x + 1 - a, FY - 1, 4, 1, '#111');
    upper(c, L, x, hy + bob);
    R(c, L.suit, x + 4, hy - 7 + bob, 1, 6, L.suit);            // near arm
    R(c, L.skin, x + 4, hy - 1 + bob, 1, 1, L.skin);
  }

  function working(c, L, x, frame) {
    const hy = FY - 9;
    // chair
    R(c, '#5a5a6a', x - 6, hy - 6, 2, 9);
    R(c, '#4a4a58', x - 5, hy + 2, 8, 1);
    R(c, '#4a4a58', x - 2, hy + 3, 1, FY - hy - 3);
    R(c, '#4a4a58', x - 5, FY, 8, 1);
    // legs sitting
    R(c, L.pants, x - 3, hy, 7, 2, L.pants);
    R(c, L.pants, x + 2, hy + 2, 2, FY - hy - 3, L.pants);
    R(c, '#111', x + 2, FY - 1, 3, 1);
    // desk
    R(c, '#8b5a2b', x + 5, hy - 1, 17, 2);
    R(c, '#6e451f', x + 6, hy + 1, 2, FY - hy - 1);
    R(c, '#6e451f', x + 19, hy + 1, 2, FY - hy - 1);
    // laptop: base + lit screen (faces the worker)
    R(c, '#b8bcc8', x + 10, hy - 2, 7, 1);
    R(c, '#8d93a3', x + 16, hy - 9, 1, 7);
    R(c, frame % 4 < 2 ? '#7fd6ff' : '#4aa8ff', x + 15, hy - 8, 1, 5);
    R(c, '#f5f5f5', x + 19, hy - 4, 2, 3);                      // mug on the desk
    R(c, '#5b3a29', x + 19, hy - 4, 2, 1);
    upper(c, L, x, hy);
    R(c, L.suit, x + 1, hy - 5, 6, 2, L.suit);                  // arms to the keyboard
    R(c, L.skin, x + 7 + (frame % 2), hy - 3, 2, 1, L.skin);    // typing hand
  }

  function coffee(c, L, x, frame) {
    standing(c, L, x, 0, false);
    const hy = FY - 7;
    const sip = frame % 8 >= 6;
    R(c, L.suit, x + 4, hy - 6, 3, 2, L.suit);                  // forearm
    const my = sip ? hy - 12 : hy - 9, mx = sip ? x + 4 : x + 7;
    R(c, '#f5f5f5', mx, my, 3, 4);
    R(c, '#f5f5f5', mx + 3, my + 1, 1, 2);
    R(c, '#5b3a29', mx, my, 3, 1);
    if (!sip) {
      R(c, 'rgba(255,255,255,0.85)', mx + 1 + (frame % 2), my - 3, 1, 1);
      R(c, 'rgba(255,255,255,0.6)', mx + 1 + ((frame + 1) % 2), my - 5, 1, 1);
    }
  }

  function sofa(c, L, x, frame, label) {
    const hy = FY - 9;
    const body = '#8e3b46', dk = '#6d2c35';
    R(c, dk, x - 9, hy - 6, 20, 10);                            // back
    upper(c, L, x, hy, { eyesClosed: true });
    R(c, body, x - 9, hy + 1, 20, FY - hy - 1);                 // seat front hides the legs
    R(c, dk, x - 11, hy - 3, 3, FY - hy + 3);                   // arms
    R(c, dk, x + 9, hy - 3, 3, FY - hy + 3);
    R(c, '#3a3a45', x - 10, FY, 2, 1);
    R(c, '#3a3a45', x + 10, FY, 2, 1);
    const z = frame % 6;                                        // floating zzz
    const zc = 'rgba(255,255,255,0.9)';
    R(c, zc, x + 6 + (z > 1 ? 1 : 0), hy - 14 - Math.floor(z / 2), 2, 1);
    if (z > 2) R(c, zc, x + 9, hy - 18 - Math.floor(z / 3), 2, 1);
  }

  function alert(c, L, x, frame) {
    standing(c, L, x, 0, false);
    const hy = FY - 7, up = frame % 2;
    R(c, L.suit, x + 4, hy - 14 - up, 1, 7, L.suit);            // arm waving
    R(c, L.skin, x + 4, hy - 15 - up, 1, 1, L.skin);
    // speech bubble with "!"
    const by = 2 + up;
    R(c, '#222', x - 5, by, 11, 12);
    R(c, '#fff', x - 4, by + 1, 9, 10);
    R(c, '#222', x - 1, by + 12, 3, 2);
    R(c, '#fff', x, by + 12, 1, 1);
    R(c, '#e03131', x, by + 3, 2, 4);
    R(c, '#e03131', x, by + 8, 2, 2);
  }

  const STATES = { walk: 1, coffee: 1, sofa: 1, working: 1, alert: 1 };
  function draw(ctx, lk, state, frame, facing) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (facing < 0) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    const x = CX;
    if (state === 'working') working(ctx, lk, x, frame);
    else if (state === 'coffee') coffee(ctx, lk, x, frame);
    else if (state === 'sofa') sofa(ctx, lk, x, frame);
    else if (state === 'alert') alert(ctx, lk, x, frame);
    else standing(ctx, lk, x, frame, state === 'walk');
    ctx.restore();
  }

  root.Sprites = { W, H, CX, look, draw, hash, STATES };
  if (typeof module === 'object' && module.exports) module.exports = root.Sprites;
})(typeof self !== 'undefined' ? self : this);
