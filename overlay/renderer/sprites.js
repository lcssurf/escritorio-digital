// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// Pixel-art office workers, drawn with rectangles on a small canvas that CSS scales up (no image files).
// Who is who must be readable at a glance: the TEAM paints the uniform (and a badge with its pattern), the ROLE ("kit") adds
// something you can spot from across the room (headset, visor, pencil behind the ear, big round glasses, bow tie, scarf, courier
// cap, heart pin, crown, monocle), and the person adds hair, skin, build and glasses. A second set draws the same people as
// animals (cat, dog, rabbit, fox, owl, bear, panda, raccoon): same suits, same badges, same kits, another head.
// Pipeline per frame: body/props -> dark outline pass (so they read on any taskbar colour) -> effects (steam, zzz, bubbles).
(function (root) {
  const W = 56, H = 46, CX = 24, FY = 44; // canvas size, body centre column, ground row (exclusive)
  const OUT = [27, 24, 36];

  const SKINS = ['#f6d0a4', '#e8b685', '#c98f5c', '#8d5a3a', '#ffdcb8', '#a86b45', '#6b4129', '#fae0c8'];
  const HAIRS = ['#2a2230', '#5b3a29', '#9a5b33', '#d1a43a', '#c9c9d2', '#8a3030', '#3a4a7a', '#141418', '#b5651d', '#e8e6ee', '#6b4a2b'];
  const SUITS = ['#3e5483', '#383848', '#7a4568', '#2f7364', '#8a4545', '#58702f', '#2f6fa0'];
  const TIES = ['#e5484d', '#f5a524', '#3b9cf2', '#8b5cf6', '#30a46c'];
  const ROLES = ['agenda', 'docs', 'drafts', 'review', 'deadlines'];
  // one colour per team, far apart from each other; the chief wears charcoal and gold, the RH magenta
  const TEAM_COLORS = ['#2f6fa0', '#a83a3a', '#7a4fa8', '#2f8f6a', '#c98a1f', '#1f8f9a', '#4a5568', '#b0407f'];
  const CHIEF_SUIT = '#2f2f3a', RH_COLOR = '#d6407f';
  const KITS = ['none', 'headset', 'visor', 'pencil', 'roundglasses', 'bowtie', 'scarf', 'courier', 'heartpin', 'crown', 'monocle'];
  const SPECIES = ['cat', 'dog', 'rabbit', 'fox', 'panda', 'penguin', 'owl', 'raccoon'];
  // [fur, fur shade, muzzle/belly] per coat
  const COATS = {
    cat: [['#e39a4b', '#c8782f', '#f6d9b0'], ['#3b3b46', '#26262e', '#d9d9e2'], ['#9aa0ad', '#767c8a', '#e8eaf0'], ['#f4f1ea', '#d6d1c4', '#ffffff'], ['#8a6a4a', '#6a4e33', '#e5d3b5']],
    dog: [['#c9955c', '#a8743d', '#f1dcb8'], ['#7a5230', '#5a3a20', '#e6cfa8'], ['#3b3b46', '#26262e', '#c8c8d4'], ['#d9d2c3', '#b7ae9b', '#ffffff'], ['#8a8d96', '#6a6d76', '#e5e5ea']],
    rabbit: [['#f2efe9', '#d4cfc4', '#ffc1d0'], ['#b9a58a', '#9a8569', '#f2e7d3'], ['#8f8f98', '#6f6f78', '#f0f0f4']],
    fox: [['#e2742b', '#bf561a', '#fbe8d0'], ['#f2f2f6', '#d0d0da', '#ffffff']],
    panda: [['#f4f4f8', '#d7d7e0', '#2a2a32']],
    penguin: [['#2a2a3a', '#1b1b26', '#ffffff']],
    owl: [['#a07a52', '#7d5a38', '#f0e0c0'], ['#d9cdb5', '#b5a98f', '#fff4dc'], ['#6e6a78', '#504c5a', '#e0dce8']],
    raccoon: [['#8f929c', '#6e717b', '#e9e9ef']],
  };
  // 3x3 patterns for the chest badge of a team (1 = the team's dark colour on white)
  const PATTERNS = [['010', '111', '010'], ['101', '010', '101'], ['111', '101', '111'], ['110', '011', '110'], ['111', '000', '111'], ['100', '110', '111'], ['101', '101', '101'], ['011', '110', '011']];

  let MODE = 'people';   // 'people' | 'animals': set by the app from the person's choice

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mix(x) { x ^= x >>> 16; x = Math.imul(x, 2246822507); x ^= x >>> 13; x = Math.imul(x, 3266489909); x ^= x >>> 16; return x >>> 0; }   // spreads the bits: short ids do not cluster on a few animals
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  const STYLE_M = ['short', 'side', 'beard', 'buzz', 'curly', 'bald', 'mustache', 'afro'];
  const STYLE_F = ['long', 'bun', 'pony', 'bob', 'braid', 'wavy', 'curly', 'afro'];
  // seed: any string (stable look from its hash); spec: a team member {gender, look:{skin,hair,suit,style,glasses,prop,kit,build,species}}
  // and, when known, spec.viz = {index}: which team colour and badge pattern the team paints on its people (see Office.teamsOf)
  function look(seed, spec) {
    const h = hash(String(seed)), pick = (arr, n) => arr[(h >>> n) % arr.length];
    const o = (spec && spec.look) || {}, id = spec && spec.id;
    const vz = spec && spec.viz, viz = vz && vz.index != null ? { color: TEAM_COLORS[vz.index % TEAM_COLORS.length], icon: vz.index % PATTERNS.length } : null;
    const gender = (spec && spec.gender) || (((h >>> 24) & 1) ? 'f' : 'm');
    const skin0 = o.skin || pick(SKINS, 0), hair = o.hair || pick(HAIRS, 3);
    const teamSuit = id === 'chief' ? CHIEF_SUIT : id === 'rh' ? RH_COLOR : viz && viz.color;
    const suit = o.suit || teamSuit || pick(SUITS, 6);
    const styles = gender === 'f' ? STYLE_F : STYLE_M;
    const style = o.style && styles.includes(o.style) ? o.style : pick(styles, 12);
    // the role's mark: whatever was chosen, else the chief's crown, a lead's bow tie, the RH's heart pin, nothing for the rest
    const kit = o.kit != null ? o.kit : id === 'chief' ? 9 : id === 'rh' ? 8 : spec && spec.lead ? 5 : 0;
    let species = null, fur = skin0, furD, muz = null;
    if (MODE === 'animals') {
      species = o.species && SPECIES.includes(o.species) ? o.species : SPECIES[mix(hash(String(seed) + 's')) % SPECIES.length];
      const coats = COATS[species], c = coats[(h >>> 8) % coats.length];
      fur = c[0]; furD = c[1]; muz = c[2];
    }
    const skin = species === 'panda' ? '#2a2a32' : fur;
    return { gender, style, skin, skinD: shade(species === 'panda' ? '#2a2a32' : furD || skin, species && furD ? 1 : 0.86), hair, hairL: shade(hair, 1.3), suit, suitD: shade(suit, 0.76), suitL: shade(suit, 1.18),
             tie: pick(TIES, 9), blouse: shade(pick(TIES, 9), 1.35), glasses: o.glasses != null ? !!o.glasses : ((h >>> 15) % 4) === 0 && !species,
             role: o.prop != null ? o.prop : (h >>> 18) % ROLES.length, badge: id === 'chief' ? '#f5c542' : spec && spec.lead ? '#9fb4d9' : null,
             kit: kit | 0, build: o.build === 1 ? 1 : 0, species, fur, furD: furD || shade(fur, 0.8), furL: shade(fur, 1.15), muz: muz || '#fff',
             team: id === 'chief' ? '#c9a227' : viz && viz.color ? viz.color : suit, icon: viz && viz.icon != null ? viz.icon : -1, lead: !!(spec && spec.lead), chief: id === 'chief',
             pants: '#2b2b3a', pantsD: '#21212d' };
  }
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // ---------------------------------------------------------------- human head
  function hairBack(c, L, x, hy) {
    const s = L.style;
    if (s === 'long') { R(c, L.hair, x - 6, hy - 17, 3, 14); R(c, L.hairL, x - 6, hy - 17, 1, 14); R(c, L.hair, x + 5, hy - 17, 2, 9); }
    if (s === 'pony') { R(c, L.hair, x - 7, hy - 17, 3, 4); R(c, L.hair, x - 8, hy - 14, 2, 8); R(c, L.hairL, x - 8, hy - 14, 1, 7); }
    if (s === 'afro') { R(c, L.hair, x - 8, hy - 26, 17, 13); R(c, L.hairL, x - 6, hy - 26, 7, 1); R(c, L.hair, x - 7, hy - 14, 2, 2); }
    if (s === 'bob') { R(c, L.hair, x - 6, hy - 18, 4, 10); R(c, L.hairL, x - 6, hy - 18, 1, 10); R(c, L.hair, x + 5, hy - 17, 2, 6); }
    if (s === 'wavy') { R(c, L.hair, x - 6, hy - 17, 3, 14); R(c, L.hair, x - 7, hy - 13, 1, 2); R(c, L.hair, x - 7, hy - 8, 1, 2); R(c, L.hairL, x - 6, hy - 17, 1, 14); R(c, L.hair, x + 5, hy - 17, 2, 8); }
    if (s === 'braid') {
      R(c, L.hair, x - 6, hy - 17, 3, 6);
      for (let i = 0; i < 5; i++) R(c, i % 2 ? L.hairL : L.hair, x - 8 + (i % 2), hy - 12 + i * 2, 2, 2);
    }
    if (s === 'curly') { R(c, L.hair, x - 7, hy - 18, 3, 8); R(c, L.hair, x + 5, hy - 17, 2, 5); R(c, L.hairL, x - 7, hy - 16, 1, 2); }
  }
  function hairFront(c, L, x, hy) {
    const s = L.style;
    if (s === 'bald') { R(c, L.skin, x - 4, hy - 19, 10, 2); R(c, L.skinD, x - 4, hy - 19, 10, 1); R(c, shade(L.skin, 1.12), x - 1, hy - 18, 3, 1); return; }
    if (s === 'buzz') { R(c, L.hair, x - 4, hy - 19, 10, 2); R(c, L.hairL, x - 2, hy - 19, 5, 1); R(c, L.hair, x - 4, hy - 17, 2, 3); return; }
    if (s === 'afro') { R(c, L.hair, x - 5, hy - 20, 12, 3); R(c, L.hair, x - 3, hy - 17, 9, 1); R(c, L.hairL, x - 3, hy - 20, 6, 1); return; }
    if (s === 'curly') {
      R(c, L.hair, x - 5, hy - 20, 12, 3); R(c, L.hair, x - 5, hy - 21, 3, 1); R(c, L.hair, x - 1, hy - 22, 3, 2); R(c, L.hair, x + 3, hy - 22, 3, 2); R(c, L.hair, x + 6, hy - 21, 1, 2);
      R(c, L.hairL, x - 1, hy - 22, 3, 1); R(c, L.hair, x - 5, hy - 17, 3, 6); R(c, L.hair, x - 3, hy - 17, 9, 1); return;
    }
    R(c, L.hair, x - 5, hy - 20, 12, 4); R(c, L.hairL, x - 3, hy - 20, 6, 1);   // hair top
    R(c, L.hair, x - 5, hy - 17, 3, 7);                                          // back hair
    R(c, L.hair, x - 3, hy - 17, 9, 1);                                          // fringe
    if (s === 'bun') { R(c, L.hair, x - 4, hy - 24, 6, 4); R(c, L.hairL, x - 3, hy - 24, 3, 1); }
    if (s === 'side') { R(c, L.hair, x + 1, hy - 21, 6, 2); R(c, L.hairL, x + 2, hy - 21, 3, 1); R(c, L.skinD, x + 2, hy - 17, 1, 1); }
    if (s === 'beard') { R(c, L.hair, x - 3, hy - 13, 2, 3); R(c, L.hair, x - 3, hy - 10, 9, 1); R(c, L.hair, x + 5, hy - 13, 1, 3); }
    if (s === 'mustache') { R(c, L.hair, x + 1, hy - 12, 5, 1); R(c, L.hair, x + 5, hy - 11, 1, 1); }
    if (s === 'bob') { R(c, L.hair, x + 5, hy - 18, 2, 3); }
  }
  function eyes(c, L, x, hy, o, ex, ey) {
    const f = L.gender === 'f' && !L.species;
    if (o.closed || o.blink) { R(c, '#2a2230', ex, ey + 1, 2, 1); R(c, '#2a2230', ex + 3, ey + 1, 2, 1); }
    else if (o.happy) { R(c, '#2a2230', ex, ey, 1, 1); R(c, '#2a2230', ex + 1, ey + 1, 1, 1); R(c, '#2a2230', ex + 3, ey, 1, 1); R(c, '#2a2230', ex + 4, ey + 1, 1, 1); }
    else { R(c, '#fff', ex, ey, 2, 3); R(c, '#fff', ex + 3, ey, 2, 3); R(c, '#2a2230', ex + 1, ey, 1, 3); R(c, '#2a2230', ex + 4, ey, 1, 3); }
    if (f && !o.closed) { R(c, '#2a2230', ex, ey - 1, 2, 1); R(c, '#2a2230', ex + 3, ey - 1, 3, 1); }   // lashes
  }
  function head(c, L, x, hy, o) {
    o = o || {};
    const f = L.gender === 'f';
    hairBack(c, L, x, hy);
    R(c, L.skinD, x - 1, hy - 10, 3, 2);                                   // neck
    R(c, L.skin, x - 3, hy - 17, 9, 8);                                    // face
    R(c, L.skinD, x - 3, hy - 11, 9, 1);                                   // jaw shade
    hairFront(c, L, x, hy);
    eyes(c, L, x, hy, o, x + 1, hy - 14);
    if (L.glasses && L.kit !== 4) { const ex = x + 1; R(c, '#2a2230', ex - 1, hy - 15, 4, 1); R(c, '#2a2230', ex + 2, hy - 15, 4, 1); R(c, '#2a2230', ex - 1, hy - 12, 4, 1); R(c, '#2a2230', ex + 2, hy - 12, 4, 1); }
    R(c, f ? (o.open ? '#9a2f3f' : '#d0606a') : (o.open ? '#7a3535' : '#b86a6a'), x + 2, hy - 11, o.happy || o.open ? 3 : 2, 1);   // mouth
    R(c, '#f2a0a0', x, hy - 12, 1, 1);                                     // cheek
    headgear(c, L, x, hy, o);
  }

  // ---------------------------------------------------------------- what the role wears on the head
  function headgear(c, L, x, hy, o) {
    const K = '#2a2a38', tc = L.team;
    switch (L.kit) {
      case 1: R(c, K, x - 5, hy - 21, 11, 1); R(c, K, x - 6, hy - 20, 1, 6); R(c, tc, x - 7, hy - 16, 2, 4); R(c, K, x - 5, hy - 12, 1, 2); R(c, K, x - 4, hy - 10, 6, 1); R(c, '#e5484d', x + 2, hy - 11, 2, 2); break;   // headset: service
      case 2: R(c, '#2fae5a', x - 5, hy - 19, 12, 2); R(c, '#1f7a3d', x - 5, hy - 17, 12, 1); R(c, '#2fae5a', x + 6, hy - 18, 3, 1); R(c, K, x - 6, hy - 20, 14, 1); break;   // green visor: money
      case 3: R(c, '#f5c542', x - 5, hy - 18, 1, 7); R(c, '#e5484d', x - 5, hy - 19, 1, 1); R(c, K, x - 5, hy - 11, 1, 1); break;   // pencil behind the ear: drafting
      case 4: { const ex = x + 1, g = '#2a2230'; for (const dx of [0, 3]) { R(c, g, ex - 1 + dx, hy - 16, 4, 1); R(c, g, ex - 1 + dx, hy - 12, 4, 1); R(c, g, ex - 1 + dx, hy - 16, 1, 5); R(c, g, ex + 2 + dx, hy - 16, 1, 5); } R(c, g, ex + 2, hy - 14, 2, 1); break; }   // big round glasses: review
      case 7: R(c, '#2f6fa0', x - 5, hy - 22, 12, 4); R(c, '#244f73', x - 5, hy - 19, 12, 1); R(c, K, x + 5, hy - 19, 5, 1); R(c, '#f5c542', x, hy - 22, 2, 1); break;   // courier cap: filing
      case 8: R(c, '#ff5d8f', x + 2, hy - 23, 4, 3); R(c, '#ffd1e0', x + 3, hy - 22, 2, 1); R(c, '#ff5d8f', x + 3, hy - 24, 2, 1); break;   // heart pin: people
      case 9: R(c, '#f5c542', x - 4, hy - 23, 10, 2); R(c, '#f5c542', x - 4, hy - 25, 2, 3); R(c, '#f5c542', x - 1, hy - 26, 2, 4); R(c, '#f5c542', x + 3, hy - 25, 2, 3); R(c, '#e5484d', x - 1, hy - 22, 2, 1); break;   // crown: the chief
      case 10: R(c, '#f5c542', x + 3, hy - 16, 4, 1); R(c, '#f5c542', x + 3, hy - 12, 4, 1); R(c, '#f5c542', x + 3, hy - 16, 1, 5); R(c, '#f5c542', x + 6, hy - 16, 1, 5); R(c, '#f5c542', x + 7, hy - 12, 1, 6); break;   // monocle and chain: court
      default: break;
    }
  }
  function neckwear(c, L, x, hy) {
    if (L.kit === 5) { const b = L.team; R(c, b, x - 3, hy - 10, 3, 3); R(c, b, x + 1, hy - 10, 3, 3); R(c, shade(b, 0.6), x, hy - 10, 1, 3); R(c, shade(b, 1.3), x - 3, hy - 10, 3, 1); }   // bow tie: leads
    if (L.kit === 6) { const s = '#f08a24'; R(c, s, x - 4, hy - 10, 9, 2); R(c, shade(s, 1.25), x - 4, hy - 10, 9, 1); R(c, s, x + 2, hy - 8, 2, 6); R(c, shade(s, 0.7), x + 2, hy - 3, 2, 1); }   // scarf: documents
    if (L.kit === 8) { R(c, '#ff5d8f', x - 1, hy - 9, 1, 6); R(c, '#ff5d8f', x + 1, hy - 9, 1, 6); }   // lanyard: people
  }

  // ---------------------------------------------------------------- body parts
  function teamBadge(c, L, x, hy) {
    if (L.chief) { R(c, '#f5c542', x - 3, hy - 7, 3, 3); R(c, shade('#f5c542', 0.62), x - 3, hy - 4, 3, 1); R(c, shade('#f5c542', 1.35), x - 2, hy - 6, 1, 1); return; }
    if (L.icon < 0) { if (L.badge) { R(c, L.badge, x - 3, hy - 7, 3, 3); R(c, shade(L.badge, 0.62), x - 3, hy - 4, 3, 1); R(c, shade(L.badge, 1.35), x - 2, hy - 6, 1, 1); } return; }
    const p = PATTERNS[L.icon % PATTERNS.length], dark = shade(L.team, 0.75);
    R(c, '#f4f4f8', x - 4, hy - 8, 5, 5); R(c, L.team, x - 4, hy - 8, 5, 1); R(c, L.team, x - 4, hy - 4, 5, 1);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) if (p[r][q] === '1') R(c, dark, x - 3 + q, hy - 7 + r, 1, 1);
  }
  function torso(c, L, x, hy) {
    if (L.gender === 'f') {
      R(c, L.suit, x - 4, hy - 9, 9, 6); R(c, L.suit, x - 3, hy - 3, 7, 3);               // blazer, waist
      R(c, L.suitD, x - 4, hy - 9, 2, 6); R(c, L.suitD, x - 3, hy - 3, 1, 3); R(c, L.suitL, x + 3, hy - 9, 1, 6);
      R(c, L.blouse, x, hy - 9, 3, 3); R(c, '#fff', x + 1, hy - 9, 1, 2);                  // blouse V
      R(c, '#1b1824', x - 3, hy - 1, 7, 1);
    } else {
      R(c, L.suit, x - 4, hy - 9, 9, 9);
      R(c, L.suitD, x - 4, hy - 9, 2, 9);
      R(c, L.suitL, x + 3, hy - 9, 1, 9);
      R(c, '#f4f4f8', x, hy - 9, 3, 4);                                    // shirt
      R(c, L.tie, x + 1, hy - 8, 1, 6); R(c, shade(L.tie, 0.8), x + 1, hy - 3, 1, 1);
      R(c, '#1b1824', x - 4, hy - 1, 9, 1);                                // belt
    }
    if (L.build === 1) { R(c, L.suitD, x - 5, hy - 9, 1, 8); R(c, L.suitL, x + 5, hy - 9, 1, 8); }   // broad
    neckwear(c, L, x, hy);
    teamBadge(c, L, x, hy);
    if (L.chief) { R(c, '#f5c542', x - 5, hy - 9, 2, 1); R(c, '#f5c542', x + 4, hy - 9, 2, 1); }                          // gold epaulets
    else if (L.lead) { R(c, '#c9d3e8', x - 5, hy - 9, 2, 1); R(c, '#c9d3e8', x + 4, hy - 9, 2, 1); }                      // silver epaulets
  }
  function legsStand(c, L, x, hy, offFar, offNear) {
    const len = FY - 2 - hy;
    if (L.gender === 'f') {
      R(c, L.suitD, x - 4, hy, 9, 4); R(c, L.suit, x - 4, hy, 9, 1);                      // skirt
      R(c, L.skinD, x - 2 + offFar, hy + 4, 2, len - 4); R(c, '#1b1824', x - 3 + offFar, FY - 2, 4, 2);
      R(c, L.skin, x + 1 + offNear, hy + 4, 2, len - 4); R(c, '#1b1824', x + offNear, FY - 2, 4, 2);
      return;
    }
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
    else if (role === 3) { R(c, '#a8d8f0', x + 1, y - 6, 4, 4); R(c, '#2a2230', x, y - 7, 6, 1); R(c, '#2a2230', x, y - 2, 6, 1); R(c, '#2a2230', x, y - 7, 1, 5); R(c, '#2a2230', x + 5, y - 7, 1, 5); R(c, '#8a6a3a', x + 5, y - 1, 3, 1); }   // magnifier
    else { R(c, '#e5484d', x, y - 6, 6, 6); R(c, '#fff', x + 1, y - 5, 4, 4); R(c, '#2a2230', x + 3, y - 5, 1, 2 + (f % 2)); R(c, '#2a2230', x + 3, y - 3, 2, 1); }      // alarm clock
  }

  function deskScene(c, x, hy, beat, role) {   // desk, monitor with its animated screen, keyboard, mug and the role's prop
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
    propFor(c, role, x + 20, hy - 2, beat);
  }

  function working(c, L, x, f, beat) {
    const hy = FY - 11;
    // chair
    R(c, '#5b5d78', x - 8, hy - 9, 2, 12); R(c, '#4a4c64', x - 7, hy + 3, 10, 2);
    R(c, '#3c3e52', x - 3, hy + 5, 2, FY - hy - 6); R(c, '#3c3e52', x - 7, FY - 1, 10, 1);
    // legs sitting
    if (L.gender === 'f') { R(c, L.suitD, x - 4, hy, 9, 3); R(c, L.skin, x + 3, hy + 3, 2, FY - hy - 5); R(c, '#1b1824', x + 3, FY - 2, 5, 2); }
    else { R(c, L.pants, x - 3, hy, 8, 3); R(c, L.pants, x + 3, hy + 3, 3, FY - hy - 5); R(c, '#1b1824', x + 3, FY - 2, 5, 2); }
    deskScene(c, x, hy, beat, L.role);
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
    if (lk.species) {
      const A = root.AnimalSprites || (typeof require === 'function' ? require('./animals.js') : null);
      info = A.draw(ctx, lk, state, frame, beat, { R, shade, deskScene, sofaBase, FY, PATTERNS }) || {};
    } else if (state === 'working') working(ctx, lk, CX, frame, beat);
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

  const setMode = (m) => { MODE = m === 'animals' ? 'animals' : 'people'; };
  const getMode = () => MODE;
  root.Sprites = { W, H, CX, ROLES, SKINS, HAIRS, SUITS, STYLE_M, STYLE_F, KITS, SPECIES, TEAM_COLORS, CHIEF_SUIT, RH_COLOR, PATTERNS, look, draw, hash, shade, setMode, getMode };
  if (typeof module === 'object' && module.exports) module.exports = root.Sprites;
})(typeof self !== 'undefined' ? self : this);
