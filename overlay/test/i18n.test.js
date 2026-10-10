// Run: node test/i18n.test.js  (no dependencies)
const assert = require('assert');
const I18N = require('../i18n');
const Office = require('../renderer/office.js');
const ptBR = require('../i18n/pt-BR.json'), en = require('../i18n/en.json');

// both languages have exactly the same keys
assert.deepStrictEqual(Object.keys(ptBR).sort(), Object.keys(en).sort(), 'pt-BR and en must have the same keys');
// every {placeholder} appears in both
for (const k of Object.keys(ptBR)) {
  const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join();
  assert.strictEqual(ph(ptBR[k]), ph(en[k]), 'placeholders differ in ' + k);
}
const t = I18N.make({ 'pt-BR': ptBR, en }, 'en');
assert.strictEqual(t('approvals.approve'), 'Approve and save');
assert.strictEqual(I18N.make({ 'pt-BR': ptBR, en }, 'pt-BR')('approvals.approve'), 'Aprovar e salvar');
assert.strictEqual(I18N.pick('pt-PT'), 'pt-BR');
assert.strictEqual(I18N.pick('fr-FR'), 'en');
assert.strictEqual(t('approvals.n', { n: 3 }), '3 change(s)');
assert.strictEqual(t('no.such.key'), 'no.such.key');

// characters
const state = { agents: [{ id: 'a', name: 'Chefe', running: 0, loggedIn: true }, { id: 'out', loggedIn: false }],
  subagents: [{ id: 't1', title: 'x', status: 'running' }, { id: 't2', title: 'y', status: 'queued' }, { id: 't3', title: 'z', status: 'running' }] };
let pets = Office.buildPets(state, [{ id: 't3', title: 'z' }], false);
assert.deepStrictEqual(pets.map((p) => p.id + ':' + p.state), ['L:t3:alert', 'T:t1:working', 'A:a:idle'], 'alerts first, no duplicate for a task awaiting approval, logged-out Claudes hidden');
assert.strictEqual(Office.buildPets(null, [], true)[0].status, 'offline');
const many = { agents: [], subagents: Array.from({ length: 20 }, (_, i) => ({ id: 's' + i, status: 'running' })) };
assert.strictEqual(Office.buildPets(many, [], false).length, Office.MAX_PETS);
assert.strictEqual(Office.freeSlot([60, 210], 150, 60), 360);
assert.ok(['walk', 'coffee', 'sofa', 'read'].includes(Office.nextIdleMode('walk', () => 0.9)));
assert.deepStrictEqual(Office.persona('abc'), Office.persona('abc'), 'a persona is stable');
assert.ok(Office.ROLES.includes(Office.persona('t1').role));
assert.strictEqual(Office.buildPets(state, [], false).find((p) => p.id === 'T:t1').persona.name.length > 0, true);

// a team: every member is always on the bar, the chief first
const members = [{ id: 'chief', name: 'Chefe', title: 'Chefe' }, { id: 'ana', name: 'Ana', title: 'Docs' }, { id: 'bruno', name: 'Bruno', title: 'Prazos' }];
const st2 = { subagents: [{ id: 'r1', title: 'organizar', status: 'running', specialist: 'ana' }, { id: 'r2', title: 'solto', status: 'running' }, { id: 'r3', title: 'fantasma', status: 'running', specialist: 'ghost' }] };
let tp = Office.buildPets(st2, [{ id: 'l1', title: 'peca', specialist: 'bruno' }, { id: 'l2', title: 'resumo' }], false, members);
const by = Object.fromEntries(tp.map((p) => [p.id, p.state]));
assert.strictEqual(by['S:chief'], 'alert', 'a landing with no specialist belongs to the chief... (l2)');
assert.strictEqual(by['S:ana'], 'working');
assert.strictEqual(by['S:bruno'], 'alert');
assert.strictEqual(tp[0].id, 'S:chief', 'the chief stands first');
assert.ok(tp.some((p) => p.id === 'T:r3'), 'a job of someone no longer on the team still shows');
assert.strictEqual(tp.find((p) => p.id === 'S:chief').taskId, 'l2');
tp = Office.buildPets({ subagents: [] }, [], false, members);
assert.deepStrictEqual(tp.map((p) => p.state), ['idle', 'idle', 'idle'], 'an idle team is still on the bar');
assert.ok(Office.buildPets(state, [], false, []).some((p) => p.id === 'A:a'), 'without a team it falls back to the old characters');
console.log('ok');
