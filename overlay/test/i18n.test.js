// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
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

// a team: the chief and the orchestrators always stand on the bar; specialists show up when they are called
const members = [{ id: 'chief', name: 'Chefe', title: 'Chefe', lead: true }, { id: 'ana', name: 'Ana', title: 'Docs' }, { id: 'bruno', name: 'Bruno', title: 'Prazos' }];
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
assert.deepStrictEqual(tp.map((p) => p.id + ':' + p.state), ['S:chief:idle'], 'an idle team: only the orchestrators are on the bar');
tp = Office.buildPets({ subagents: [{ id: 'r9', title: 'x', status: 'running', specialist: 'ana' }] }, [], false, members);
assert.deepStrictEqual(tp.map((p) => p.id), ['S:chief', 'S:ana'], 'a specialist appears when called');
tp = Office.buildPets({ subagents: [] }, [], false, members, new Set(['ana']));
assert.deepStrictEqual(tp.map((p) => p.id), ['S:chief', 'S:ana'], 'and lingers a moment after finishing');
tp = Office.buildPets({ subagents: [{ id: 'w1', title: 'coordena', status: 'waiting', specialist: 'chief' }] }, [], false, members);
assert.strictEqual(tp[0].state, 'working', 'an orchestrator waiting for its team is working');
tp = Office.buildPets({ subagents: [] }, [], false, [...members.slice(0, 2), { id: 'fixo', name: 'Fixo', pinned: true }, { id: 'lider', name: 'Lia', lead: true }]);
assert.deepStrictEqual(tp.map((p) => p.id), ['S:chief', 'S:lider', 'S:fixo'], 'chief, then orchestrators, then pinned');
assert.ok(Office.buildPets(state, [], false, []).some((p) => p.id === 'A:a'), 'without a team it falls back to the old characters');

// the catalog the RH offers (clodfarm/catalog): 21 valid models, every rule the server enforces already holds
const fs = require('fs'), path = require('path');
const Cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'clodfarm', 'catalog', 'previdenciario.json'), 'utf8'));
const Sprites = require('../renderer/sprites.js');
const leads = Cat.entries.filter((e) => e.kind === 'lead'), specs = Cat.entries.filter((e) => e.kind === 'specialist');
assert.strictEqual(specs.length, 16);
assert.strictEqual(leads.length, 5, 'five coordinators');
const leadKeys = new Set(leads.map((l) => l.team));
for (const m of specs) assert.ok(leadKeys.has(m.team), 'every specialist belongs to a team: ' + m.name);
for (const l of leads) assert.ok(specs.some((m) => m.team === l.team), 'every coordinator has a team: ' + l.name);
assert.strictEqual(new Set(Cat.entries.map((m) => m.name)).size, 21, 'names are unique');
assert.strictEqual(new Set(Cat.entries.map((m) => m.id)).size, 21, 'ids are unique');
for (const m of Cat.entries) {
  assert.ok(/^[a-z0-9][a-z0-9-]{0,30}$/.test(m.id), 'id: ' + m.id);
  assert.ok(m.name.length >= 1 && m.name.length <= 40 && m.title.length <= 60, 'name/title limits: ' + m.name);
  assert.ok(m.instructions.length > 80 && m.instructions.length <= 6000, 'instructions size: ' + m.name);
  assert.ok(['m', 'f'].includes(m.gender));
  assert.ok((m.gender === 'f' ? Sprites.STYLE_F : Sprites.STYLE_M).includes(m.look.style), 'hair style fits the gender: ' + m.name);
  assert.ok(m.look.prop == null || (m.look.prop >= 0 && m.look.prop <= 4));
  for (const k of ['hair', 'skin']) assert.ok(/^#[0-9a-fA-F]{6}$/.test(m.look[k]), k + ' colour: ' + m.name);
  assert.ok(!m.look.suit, 'the team paints the uniform, a model does not set one: ' + m.name);
  assert.ok(Number.isInteger(m.look.kit) && m.look.kit >= 0 && m.look.kit < Sprites.KITS.length, 'a valid role accessory: ' + m.name);
  assert.ok(!/senha|login/i.test(m.instructions) || /nunca|não|nao/i.test(m.instructions), 'no model is told to log in: ' + m.name);
}
assert.ok(specs.filter((m) => m.gender === 'f').length >= 6 && specs.filter((m) => m.gender === 'm').length >= 6, 'a mixed team');
assert.ok(Cat.chief.length <= 6000);
console.log('ok');
