// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// The characters: who is who must be readable (team colour, role accessory), both sets (people, animals) must draw in every
// state without errors, and the team colours must really be different.
const assert = require('assert');
const S = require('../renderer/sprites.js'), O = require('../renderer/office.js');

// a canvas that records what is drawn (the tests run in Node, without a browser)
function fakeCtx() {
  const log = [];
  return {
    log, fillStyle: '', clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    fillRect(x, y, w, h) { log.push([this.fillStyle, x, y, w, h]); },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }, putImageData() {},
  };
}
const draws = (lk, state, f) => { const c = fakeCtx(); S.draw(c, lk, state || 'idle', f || 1, 1, f || 1); return c.log; };

// ---- a team: coordinators open colours, the people under them wear them
const M = [
  { id: 'chief', name: 'Marina', lead: true }, { id: 'rh', name: 'Teresa', parent: 'chief' },
  { id: 'l1', name: 'A', lead: true, parent: 'chief' }, { id: 'l2', name: 'B', lead: true, parent: 'chief' }, { id: 'l3', name: 'C', lead: true, parent: 'chief' },
  { id: 's1', name: 'D', parent: 'l1' }, { id: 's2', name: 'E', parent: 'l1' }, { id: 's3', name: 'F', parent: 'l2' }, { id: 's4', name: 'G', parent: 'chief' },
];
const T = O.teamsOf(M);
assert.ok(!T.has('chief') && !T.has('rh'), 'the chief and the RH have their own look');
assert.strictEqual(T.get('s1').index, T.get('l1').index, 'the people of a coordinator wear its colour');
assert.strictEqual(T.get('s2').index, T.get('l1').index);
assert.strictEqual(new Set(['l1', 'l2', 'l3'].map((id) => T.get(id).index)).size, 3, 'each team has its own colour');
assert.notStrictEqual(T.get('s3').index, T.get('s1').index);
assert.strictEqual(T.get('s4').index, 6, 'whoever reports to the chief wears the neutral slate');
const many = [{ id: 'chief', lead: true }, ...Array.from({ length: 7 }, (_, i) => ({ id: 'l' + i, lead: true, parent: 'chief' }))];
const mt = O.teamsOf(many);
assert.strictEqual(new Set(many.slice(1).map((l) => mt.get(l.id).index)).size, 7, 'seven teams, seven different colours');
assert.ok(!many.slice(1).some((l) => mt.get(l.id).index === 6), 'the neutral slate is never a team colour');

// ---- what the look says
S.setMode('people');
const look = (id, spec) => S.look(id, { id, ...spec });
const a = look('s1', { gender: 'f', parent: 'l1', viz: T.get('s1') }), b = look('s3', { gender: 'f', parent: 'l2', viz: T.get('s3') });
assert.notStrictEqual(a.suit, b.suit, 'two teams, two uniforms');
assert.strictEqual(a.suit, S.TEAM_COLORS[T.get('s1').index]);
assert.strictEqual(look('chief', { gender: 'f', lead: true }).suit, S.CHIEF_SUIT, 'the chief wears charcoal');
assert.strictEqual(look('chief', { lead: true }).kit, 9, 'with a crown');
assert.strictEqual(look('rh', {}).kit, 8, 'the RH wears the heart pin');
assert.strictEqual(look('l1', { lead: true }).kit, 5, 'a coordinator wears a bow tie');
assert.strictEqual(look('x', { look: { kit: 4 } }).kit, 4, 'a chosen accessory wins');
assert.strictEqual(look('x', { look: { suit: '#123456' } }).suit, '#123456', 'a chosen colour wins over the team');
assert.strictEqual(JSON.stringify(look('same', {})), JSON.stringify(look('same', {})), 'a look is stable');
assert.ok(S.STYLE_M.includes(look('m1', { gender: 'm' }).style) && S.STYLE_F.includes(look('f1', { gender: 'f' }).style));
assert.ok(S.STYLE_M.length >= 8 && S.STYLE_F.length >= 8 && S.KITS.length === 11 && S.SPECIES.length === 8);

// ---- the same person is drawn differently by team, by role and by set
const sig = (lk, st) => JSON.stringify(draws(lk, st || 'idle', 1));
assert.notStrictEqual(sig(a), sig(b), 'two teams do not look alike');
assert.notStrictEqual(sig(look('p', { look: { kit: 1 } })), sig(look('p', { look: { kit: 4 } })), 'two roles do not look alike');
assert.notStrictEqual(sig(look('p', { look: { kit: 0 } })), sig(look('p', { look: { kit: 7 } })));
assert.notStrictEqual(sig(look('p', { look: { build: 0 } })), sig(look('p', { look: { build: 1 } })), 'a broad build shows');
for (const g of [['m', S.STYLE_M], ['f', S.STYLE_F]]) {
  const seen = new Set(g[1].map((st) => sig(look('p', { gender: g[0], look: { style: st, hair: '#5b3a29', skin: '#e8b685' } }))));
  assert.strictEqual(seen.size, g[1].length, 'every hairstyle of the ' + g[0] + ' set looks different');
}

// ---- every state, every kit, every build, in both sets: nothing throws and something is drawn
const STATES = ['walk', 'idle', 'coffee', 'sofa', 'read', 'working', 'alert', 'cheer'];
for (const mode of ['people', 'animals']) {
  S.setMode(mode);
  assert.strictEqual(S.getMode(), mode);
  for (const kit of S.KITS.keys()) for (const g of ['m', 'f']) for (const st of STATES) {
    const lk = look('k' + kit + g, { gender: g, look: { kit, build: kit % 2 }, viz: { index: kit % 8 } });
    assert.ok(draws(lk, st, 3).length > 20, mode + ' ' + st + ' draws something');
  }
}
S.setMode('animals');
const species = new Set();
for (let i = 0; i < 200; i++) species.add(look('seed' + i, {}).species);
assert.strictEqual(species.size, 8, 'all eight animals appear');
for (const sp of S.SPECIES) {
  const lk = look('z', { look: { species: sp } });
  assert.strictEqual(lk.species, sp);
  for (const st of STATES) assert.ok(draws(lk, st, 2).length > 20, sp + ' ' + st);
}
assert.strictEqual(look('z', { look: { species: 'dragon' } }).species !== 'dragon', true, 'an unknown animal is replaced');
assert.notStrictEqual(sig(look('p', { look: { species: 'cat' } })), sig(look('p', { look: { species: 'dog' } })), 'a cat is not a dog');
// the same person keeps the uniform, the badge and the accessory in the other set
const person = (S.setMode('people'), look('t1', { gender: 'f', look: { kit: 4 }, viz: { index: 2 } }));
const animal = (S.setMode('animals'), look('t1', { gender: 'f', look: { kit: 4 }, viz: { index: 2 } }));
assert.strictEqual(person.suit, animal.suit); assert.strictEqual(person.kit, animal.kit); assert.strictEqual(person.team, animal.team); assert.strictEqual(person.icon, animal.icon);
assert.ok(animal.species && !person.species);
S.setMode('people');
console.log('sprites ok');
