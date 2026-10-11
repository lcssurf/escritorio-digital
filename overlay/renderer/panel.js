// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
﻿// Panel: team, approvals, new job, settings. Plain language, nothing technical. All farm text goes in with textContent.
(function () {
  const S = window.Sprites, O = window.Office;
  const q = new URLSearchParams(location.search);
  const mock = q.has('mock');
  let office = window.office, dicts = null, cfg = { lang: q.get('lang') || 'pt-BR', sound: true, url: 'http://localhost:8080', hasToken: true };
  let tab = q.get('tab') || '', focusId = q.get('id') || '';
  let chatWith = 'chief'; const chatDraft = {};
  let viewing = null;
  let landings = [], farm = null, members = [], editing = null, offline = false, authErr = false, lastSig = '';
  const confirmDeny = new Set(), busy = new Set();
  const $ = (id) => document.getElementById(id);
  const tr = (k, v) => I18N.make(dicts, cfg.lang)(k, v);

  if (!office && mock) office = mockOffice();
  function mockOffice() {
    const now = Date.now() / 1000;
    const L = q.has('empty') ? [] : [
      { id: 'task-draft', title: 'Petição inicial (rascunho fictício)', commits: 2, files: ['A\tpeticao-inicial.md', 'M\tindice.md'], summary: 'Montei a minuta com os fatos e os pedidos. Marquei [CONFERIR] nos itens 2 e 5.\n\n[git] 2 commit(s) on farm/abc waiting for a person\'s approval; nothing landed yet' },
      { id: 'task-docs', title: 'Organizar documentos do caso Exemplo', commits: 1, files: ['A\tdocumentos/indice.md'], summary: 'Separei 14 arquivos por tipo.' }];
    const st = { now, agents: [{ id: 'clodfarm', name: 'Chefe', loggedIn: true, running: 1 }, { id: 'ana', name: 'Ana', loggedIn: true, running: 0 }],
      subagents: [{ id: 'task-run1', title: 'Conferir prazos da semana (fictício)', status: 'running' }, { id: 'task-run2', title: 'Resumo do caso Exemplo', status: 'running' }],
      recent: [{ id: 'task-draft', title: 'Petição inicial (rascunho fictício)' }],
      events: [{ at: now - 40, type: 'landing.awaiting', task: 'task-draft', msg: '' }, { at: now - 400, type: 'task.added', task: 'task-run1', msg: 'task-run1 Conferir prazos da semana (fictício)' }, { at: now - 5000, type: 'task.done', task: 'task-docs', msg: 'x Organizar documentos' }] };
    const M = [{ id: 'chief', name: 'Marina', title: 'Chefe do escritório', gender: 'f', instructions: 'Priorize prazos curtos.', look: { style: 'bun', suit: '#2f2f3a', glasses: true } },
      { id: 'ana', name: 'Ana', title: 'Documentos', gender: 'f', instructions: 'Organize documentos por tipo e caso.', look: { style: 'long', prop: 1 } },
      { id: 'bruno', name: 'Bruno', title: 'Prazos', gender: 'm', instructions: 'Vigie prazos.', look: { style: 'beard', prop: 4 } }];
    L.forEach((l) => { l.specialist = 'ana'; }); st.subagents.forEach((t, i) => { t.specialist = i ? 'bruno' : 'ana'; });
    const CH = [{ id: 1, role: 'user', text: 'Oi Ana, o que falta no caso Exemplo?', at: 1 }, { id: 2, role: 'assistant', text: 'Faltam a procuração assinada e um comprovante de residência atual. Quer que eu escreva a mensagem de cobrança?', at: 2, ok: true, reply_to: 1, waiting: true }];
    return {
      api: async (m, p, b) => p.startsWith('/api/claude-connectors') ? { ok: true, status: 200, data: { url: 'https://claude.ai', connectors: [{ id: 'claude_ai_Google_Drive', name: 'Google Drive', connected: true, allowed: b && b.allow ? b.allow.includes('claude_ai_Google_Drive') : false }, { id: 'claude_ai_Gmail', name: 'Gmail', connected: false, allowed: false }, { id: 'claude_ai_Google_Calendar', name: 'Google Calendar', connected: true, allowed: b && b.allow ? b.allow.includes('claude_ai_Google_Calendar') : false }] } } : /\/api\/landings\/[^/]+\/file/.test(p) ? { ok: true, status: 200, data: { path: 'requerimento.md', binary: false, truncated: false, text: '# Requerimento de salário-maternidade\n\n**Requerente:** Maria Exemplo da Silva (CPF {{preencher}})\n\n## Fatos\n- Gestante, 30ª semana [CONFERIR]\n- Trabalha na roça há 4 anos\n\n| Documento | Situação |\n|---|---|\n| RG | Recebido |\n| Procuração | **Falta** |\n\nRequer o benefício nos termos da Lei 8.213/91 [CONFERIR].' } } : p.startsWith('/api/chat/') ? { ok: true, status: 200, data: { messages: CH, pending: false } } : ({ ok: true, status: 200, data: p.startsWith('/api/landings') ? L : p.startsWith('/api/state') ? st : p.startsWith('/api/team') ? M : p.startsWith('/api/tasks/') ? { summary: 'Conferi 4 prazos. Um vence amanhã.' } : {} }),
      getConfig: async () => ({ ...cfg, onboarded: !q.has('tour') }),
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json?v=' + Date.now())).json(), en: await (await fetch('../i18n/en.json?v=' + Date.now())).json() }),
      setConfig: async (p) => ({ ...cfg, ...p }), autoToken: async () => true, on() {}, openFarm() {}, openExports() {}, openConnectors() {}, notify() {}, quit() {}, togglePets() {}, broadcast() {},
    };
  }

  // ------------------------------------------------------------------ tiny DOM helpers
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const ICONS = {
    team: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.2"/><path d="M20 19v-1.2a3 3 0 0 0-2.2-2.9"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6"/>',
    approvals: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.3 9.5"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  function icon(name) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = ICONS[name]; return s; }

  function sprite(seed, state, cls) {
    const cv = h('canvas', { width: S.W, height: S.H, class: cls || '' });
    S.draw(cv.getContext('2d'), S.look(seed), state, 3, 1, 3);
    return cv;
  }
  function ago(sec, nowSec) {
    const d = Math.max(0, (nowSec || Date.now() / 1000) - sec);
    if (d < 60) return tr('time.now');
    if (d < 3600) return tr('time.min', { n: Math.floor(d / 60) });
    return tr('time.h', { n: Math.floor(d / 3600) });
  }
  const cleanSummary = (s) => String(s || '').replace(/\n*\[git\][\s\S]*$/, '').trim();

  // ------------------------------------------------------------------ data
  async function refresh(force) {
    const [ld, st, tm] = await Promise.all([office.api('GET', '/api/landings'), office.api('GET', '/api/state'), office.api('GET', '/api/team')]);
    if (tm.ok && Array.isArray(tm.data)) members = tm.data;
    offline = !st.ok && st.status === 0;
    authErr = ld.status === 401 || ld.status === 403;
    landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    farm = st.ok ? st.data : null;
    const sig = JSON.stringify([landings.map((l) => l.id), farm && farm.agents, farm && farm.subagents, farm && (farm.events || []).slice(0, 3), members, offline, authErr, [...confirmDeny], [...busy]]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (!tab) tab = 'chat';
    if (tab === 'chat' || tab === 'settings' || editing) { renderChrome(); if (tab === 'chat') paintStrip(); return; } // never wipe what is being typed
    render();
  }
  const tasksById = () => {
    const m = new Map();
    for (const t of [...((farm && farm.subagents) || []), ...((farm && farm.recent) || []), ...landings]) m.set(t.id, t.title);
    return m;
  };

  // ------------------------------------------------------------------ chrome
  function renderChrome() {
    $('title').textContent = tr('app.name');
    const c = $('conn'); c.className = 'pill' + (offline ? ' off' : ''); c.lastChild.textContent = tr(offline ? 'conn.offline' : 'conn.online');
    $('close').setAttribute('aria-label', 'x');
    const lc = $('logo').getContext('2d'); S.draw(lc, S.look('clodfarm'), 'idle', 3, 1, 3);
    const running = ((farm && farm.subagents) || []).filter((s) => s.status === 'running').length;
    const team = ((farm && farm.agents) || []).filter((a) => a.loggedIn !== false).length;
    const tiles = $('tiles'); clear(tiles);
    tiles.append(
      h('div', { class: 'tile' + (landings.length ? ' hot' : '') }, h('b', {}, landings.length), h('span', {}, tr('sum.waiting'))),
      h('div', { class: 'tile' }, h('b', {}, running), h('span', {}, tr('sum.working'))),
      h('div', { class: 'tile' }, h('b', {}, team), h('span', {}, tr('sum.team'))));
    const nav = $('nav'); clear(nav);
    for (const [id, key] of [['chat', 'nav.chat'], ['team', 'nav.team'], ['approvals', 'nav.approvals'], ['settings', 'nav.settings']]) {
      const b = h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; focusId = ''; render(); }, 'aria-label': tr(key) }, icon(id), tr(key));
      if (id === 'approvals' && landings.length) b.append(h('span', { class: 'badge' }, landings.length));
      nav.append(b);
    }
    for (const id of ['chat', 'team', 'approvals', 'settings']) $('s-' + id).className = id === tab ? 'on' : '';
  }
  function banner() {
    if (cfg.hidden) return h('div', { class: 'banner' }, tr('banner.hidden'), ' ', h('button', { class: 'btn ghost', style: 'flex:none;padding:5px 10px;margin-left:6px', onclick: () => office.togglePets() }, tr('settings.show')));
    if (offline) return h('div', { class: 'banner' }, tr('error.offline', { url: cfg.url || '' }), ' ', h('button', { class: 'btn ghost', style: 'flex:none;padding:5px 10px;margin-left:6px', onclick: () => refresh(true) }, tr('error.retry')));
    if (authErr) return h('div', { class: 'banner' }, tr('error.auth'));
    return null;
  }
  function toast(text, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, text);
    document.body.append(t); setTimeout(() => t.remove(), 2600);
  }

  // ------------------------------------------------------------------ team
  const roleOf = (m) => m.title || (m.id === 'chief' ? tr('pet.chief') : '');
  const memberOf = (id) => members.find((m) => m.id === (id || 'chief')) || null;
  function memberStates() {   // what each member is doing right now, from the same logic as the characters on the bar
    const pets = O.buildPets(farm, landings, false, members), out = new Map();
    for (const p of pets) if (p.memberId) out.set(p.memberId, p);
    return out;
  }
  function avatar(member, state) {
    const cv = h('canvas', { width: S.W, height: S.H });
    S.draw(cv.getContext('2d'), S.look(member.id, member), state || 'idle', 3, 1, 3);
    return h('div', { class: 'avatar' }, cv);
  }
  function renderTeam() {
    const s = $('s-team'); clear(s);
    if (editing) return renderEditor(s);
    const b = banner(); if (b) s.append(b);
    s.append(h('h2', {}, tr('team.title')));
    const states = memberStates();
    if (members.length <= 1) s.append(h('div', { class: 'intro' }, tr('team.intro')));
    s.append(h('div', { class: 'addrow' }, h('button', { class: 'btn acc', onclick: () => startEdit(null) }, '+ ' + tr('team.new'))));
    if (members.length <= 2 && cfg.lang === 'pt-BR') s.append(packCard());
    if (members.length <= 2) s.append(h('div', { class: 'label' }, tr('team.templates')),
      h('div', { class: 'opts', style: 'margin-bottom:12px' }, (window.Templates[cfg.lang] || window.Templates.en).map((t) =>
        h('button', { onclick: () => startEdit(null, t) }, t.name + ' · ' + t.title))));
    const kids = (id) => members.filter((m) => m.id !== 'chief' && (m.parent || 'chief') === id && !(m.lead && id !== 'chief'));
    const memberCard = (m, nested) => {
      const p = states.get(m.id) || { status: 'idle', label: '' };
      const open = focusId === m.id;
      const card = h('div', { class: 'card' + (nested ? ' nested' : '') });
      card.append(h('div', { class: 'agent', role: 'button', tabindex: '0', onclick: () => { focusId = open ? '' : m.id; renderTeam(); } },
        avatar(m, 'idle'),
        h('div', { class: 'who' }, h('div', { class: 'name' }, m.name,
          m.id === 'chief' ? h('span', { class: 'badge-chief' }, tr('team.chief')) : m.lead ? h('span', { class: 'badge-lead' }, tr('team.lead')) : null,
          roleOf(m) && m.id !== 'chief' ? h('span', { class: 'role' }, ' · ' + roleOf(m)) : null),
          h('div', { class: 'task' }, p.label || tr(p.status === 'working' ? 'state.working' : p.status === 'alert' ? 'state.alert' : 'state.idle'))),
        h('span', { class: 'chip ' + p.status }, tr('state.' + p.status))));
      if (open) {
        const acts = [h('button', { class: 'btn acc', onclick: () => openChat(m.id) }, tr('team.chat')), h('button', { class: 'btn ghost', onclick: () => startEdit(m) }, tr('team.edit'))];
        if (m.lead) acts.unshift(h('button', { class: 'btn ghost', onclick: () => startEdit(null, null, { parent: m.id }) }, '+ ' + tr('team.addto')));
        card.append(h('div', { class: 'detail' }, m.instructions || ''), h('div', { class: 'actions' }, acts));
      }
      return card;
    };
    const chief = memberOf('chief');
    if (chief) s.append(memberCard(chief, false));
    for (const k of kids('chief').filter((m) => !m.lead)) s.append(memberCard(k, false));
    for (const l of members.filter((m) => m.id !== 'chief' && m.lead)) {
      s.append(memberCard(l, false));
      for (const k of kids(l.id)) s.append(memberCard(k, true));
    }
    s.append(h('h2', {}, tr('team.activity')));
    const titles = tasksById(), evs = (farm && farm.events) || [];
    const kinds = ['task.added', 'task.done', 'task.failed', 'landing.awaiting', 'landing.approved', 'landing.denied', 'landing.conflict'];
    const shown = evs.filter((e) => kinds.includes(e.type)).slice(0, 8);
    if (!shown.length) s.append(h('div', { class: 'note' }, tr('team.noactivity')));
    else s.append(h('ul', { class: 'feed' }, shown.map((e) => {
      const t = titles.get(e.task) || String(e.msg || '').replace(/^[0-9a-f]{12,}\s*:?\s*/, '').slice(0, 80);
      return h('li', {}, h('time', {}, ago(e.at, farm && farm.now)), h('span', { class: 't' }, tr('ev.' + e.type, { t })));
    })));
  }

  function packCard() {
    const pack = window.PackPrevidenciario;
    const btn = h('button', { class: 'btn acc', onclick: async () => {
      btn.disabled = true; btn.textContent = tr('team.pack.installing');
      let list = members.slice(), n = 0, failed = false;
      const find = (m) => list.find((x) => x.name === m.name && (x.title || '') === (m.title || ''));
      const send = async (body) => {
        const r = await office.api('POST', '/api/team', body);
        if (!r.ok) { toast(tr('edit.err', { why: (r.data && r.data.error) || r.status }), true); failed = true; return null; }
        list = r.data; return r.data;
      };
      const chief = list.find((x) => x.id === 'chief');
      if (chief && !chief.instructions) await send({ ...chief, instructions: pack.chief });
      const leadId = {};
      for (const l of pack.leads) {
        if (failed) break;
        const { team, key, ...body } = l;
        const have = find(l);
        if (!have) n++;
        if (!await send(have ? { ...have, ...body, id: have.id, lead: true, parent: 'chief' } : { ...body, lead: true, parent: 'chief' })) break;
        leadId[key] = find(l).id;
      }
      for (const m of pack.members) {
        if (failed) break;
        const { team, ...body } = m;
        const have = find(m);
        if (!have) n++;
        if (!await send(have ? { ...have, parent: leadId[team] || 'chief', lead: false, id: have.id } : { ...body, parent: leadId[team] || 'chief', lead: false })) break;
      }
      toast(tr('team.pack.done', { n }));
      await refresh(true);
    } }, tr('team.pack.install'));
    return h('div', { class: 'card' }, h('b', {}, tr('team.pack.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('team.pack.text')), btn);
  }

  // ------------------------------------------------------------------ conversation (the first tab: the chief by default)
  let chatTimer = null, chatSig = '', stripEl = null;
  function openChat(id) { chatWith = id || 'chief'; chatSig = ''; tab = 'chat'; render(); }
  function activeTeam() {   // who is working right now (so the lawyer sees who the chief called)
    const names = new Map();
    for (const t of ((farm && farm.subagents) || [])) {
      if (t.status !== 'running' && t.status !== 'waiting') continue;
      const m = memberOf(t.specialist);
      if (m && m.id !== chatWith) names.set(m.id, m);
    }
    return [...names.values()];
  }
  function paintStrip() {
    if (!stripEl) return;
    const act = activeTeam();
    clear(stripEl);
    if (!act.length) { stripEl.style.display = 'none'; return; }
    stripEl.style.display = 'flex';
    stripEl.append(h('span', { class: 'dim small' }, tr('chat.working')));
    for (const m of act) stripEl.append(h('span', { class: 'chipw' }, h('i'), m.name + (m.title ? ' · ' + m.title : '')));
  }
  function renderChatTab() { const s = $('s-chat'); clear(s); if (tab === 'chat') renderChat(s); }
  function renderChat(s) {
    let m = memberOf(chatWith);
    if (!m) { chatWith = 'chief'; m = memberOf('chief'); }
    if (!m) { s.append(h('div', { class: 'banner' }, tr('error.offline', { url: cfg.url || '' }))); return; }
    const st = memberStates().get(m.id) || { status: 'idle' };
    const isChief = m.id === 'chief';
    const list = h('div', { class: 'chat' });
    const typing = h('div', { class: 'bubble them typing', style: 'display:none' }, h('span'), h('span'), h('span'));
    const ta = h('textarea', { class: 'chatin', rows: '2', placeholder: tr('chat.placeholder', { name: m.name }), 'aria-label': tr('chat.placeholder', { name: m.name }) });
    ta.value = chatDraft[m.id] || '';
    ta.addEventListener('input', () => { chatDraft[m.id] = ta.value; });
    const send = h('button', { class: 'btn acc', style: 'flex:none;padding:10px 16px' }, tr('chat.send'));
    const doSend = async () => {
      const text = ta.value.trim(); if (!text) return;
      send.disabled = true;
      const r = await office.api('POST', '/api/chat/' + encodeURIComponent(m.id), { text });
      send.disabled = false;
      if (r.ok) { ta.value = ''; chatDraft[m.id] = ''; paint(r.data); } else toast(tr('chat.error', { why: (r.data && r.data.error) || r.error || r.status }), true);
      ta.focus();
    };
    send.addEventListener('click', doSend);
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); } });
    const hello = () => {
      const box = h('div', {}, h('div', { class: 'bubble them' }, tr(isChief ? 'chat.hello.chief' : 'chat.hello', { name: m.name, role: roleOf(m) })),
        h('div', { class: 'chips' }, ['docs', 'draft', 'deadlines', 'summary'].map((k) =>
          h('button', { onclick: () => { ta.value = tr('job.chip.' + k) + ' - '; chatDraft[m.id] = ta.value; ta.focus(); } }, tr('job.chip.' + k)))));
      return box;
    };
    const planCard = (msg) => {
      const pl = msg.plan, card = h('div', { class: 'plan' }, h('b', {}, tr('plan.title')),
        h('ol', {}, pl.steps.map((stp) => { const mem = memberOf(stp.who); return h('li', {}, h('span', { class: 'pw' }, mem ? mem.name + (mem.title ? ' · ' + mem.title : '') : stp.who), h('span', {}, stp.task)); })));
      if (pl.status === 'proposed') {
        const act = (kind) => async () => { const r = await office.api('POST', '/api/chat/' + encodeURIComponent(m.id) + '/plan/' + msg.id + '/' + kind, {}); if (r.ok) { chatSig = ''; paint(r.data); } else toast(tr('chat.error', { why: (r.data && r.data.error) || r.error || r.status }), true); };
        card.append(h('div', { class: 'ask' }, tr('plan.ask')), h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: act('cancel') }, tr('plan.no')), h('button', { class: 'btn ok', onclick: act('start') }, tr('plan.start'))));
      } else card.append(h('div', { class: 'ask dim' }, tr(pl.status === 'started' ? (pl.done ? 'plan.done' : 'plan.started') : 'plan.cancelled')));
      return card;
    };
    const paint = (view) => {
      const sig = JSON.stringify([view.messages.map((x) => [x.id, x.plan && x.plan.status, x.plan && x.plan.done]), view.pending]);
      if (sig === chatSig) return;
      chatSig = sig; clear(list);
      if (!view.messages.length) list.append(hello());
      for (const msg of view.messages) {
        if (msg.role === 'user') list.append(h('div', { class: 'bubble me' }, msg.text));
        else {
          const b = h('div', { class: 'bubble them' + (msg.ok === false ? ' bad' : '') }, msg.text);
          if (msg.plan && msg.plan.steps && msg.plan.steps.length) b.append(planCard(msg));
          if (msg.waiting) b.append(h('div', { class: 'waitrow' }, tr('chat.waiting'), ' ', h('button', { class: 'link', onclick: () => { tab = 'approvals'; render(); } }, tr('chat.review'))));
          list.append(b);
        }
      }
      typing.style.display = view.pending ? 'flex' : 'none';
      list.append(typing);
      list.scrollTop = list.scrollHeight;
    };
    const poll = async () => { const r = await office.api('GET', '/api/chat/' + encodeURIComponent(m.id)); if (r.ok && r.data) paint(r.data); paintStrip(); };
    if (chatTimer) clearInterval(chatTimer);
    chatTimer = setInterval(poll, 1500);
    poll();
    const opt = (x) => h('option', { value: x.id }, x.name + (x.id === 'chief' ? ' · ' + tr('pet.chief') : x.title ? ' · ' + x.title : ''));
    const picker = h('select', { class: 'picker', 'aria-label': tr('chat.talkto'), onchange: (ev) => openChat(ev.target.value) },
      opt(memberOf('chief') || m),
      h('optgroup', { label: tr('job.group.leads') }, members.filter((x) => x.lead && x.id !== 'chief').map(opt)),
      h('optgroup', { label: tr('job.group.specialists') }, members.filter((x) => !x.lead && x.id !== 'chief').map(opt)));
    picker.value = m.id;
    stripEl = h('div', { class: 'strip' });
    s.append(
      h('div', { class: 'agent', style: 'margin-bottom:6px;cursor:default' }, avatar(m, st.status === 'working' ? 'working' : 'idle'),
        h('div', { class: 'who' }, picker, h('div', { class: 'task', style: 'margin-top:2px;white-space:normal;line-height:1.3' }, tr(isChief ? 'chat.chiefhint' : 'chat.directhint', { name: m.name }))),
        h('span', { class: 'chip ' + st.status }, tr('state.' + st.status))),
      list, stripEl, h('div', { class: 'chatbar' }, ta, send));
    paintStrip();
    setTimeout(() => ta.focus(), 50);
  }

  // ------------------------------------------------------------------ team editor
  const PROPS = [0, 1, 2, 3, 4];
  function startEdit(m, tpl, extra) {
    const base = m ? JSON.parse(JSON.stringify(m)) : tpl ? { name: tpl.name, title: tpl.title, gender: tpl.gender, instructions: tpl.instructions, look: { ...tpl.look } }
      : { name: '', title: '', gender: 'f', instructions: '', look: { style: 'long', prop: 0, hair: '#5b3a29', skin: '#e8b685', suit: '#3e5483' } };
    base.look = base.look || {};
    if (extra) Object.assign(base, extra);
    if (!m) { base.lead = !!base.lead; base.parent = base.parent || 'chief'; base.pinned = !!base.pinned; }
    editing = { id: m ? m.id : null, data: base, confirm: false, saving: false };
    render();
  }
  function renderEditor(s) {
    const e = editing, d = e.data, isChief = e.id === 'chief';
    const look = () => S.look(e.id || 'novo', d);
    const preview = h('canvas', { width: S.W, height: S.H });
    S.draw(preview.getContext('2d'), look(), 'idle', 3, 1, 3);
    const stylesNow = () => (d.gender === 'f' ? S.STYLE_F : S.STYLE_M);
    const keepScroll = () => { const m = document.querySelector('main'), y = m.scrollTop; renderTeam(); m.scrollTop = y; };
    const swatches = (key, list) => h('div', { class: 'sw' }, list.map((c) =>
      h('button', { style: 'background:' + c, 'aria-label': c, class: (d.look[key] || look()[key]) === c ? 'on' : '', onclick: () => { d.look[key] = c; keepScroll(); } })));
    const field = (label, control, hint) => h('div', { class: 'field' }, h('label', {}, label), control, hint ? h('div', { class: 'note' }, hint) : null);
    const name = h('input', { type: 'text', value: d.name || '', maxlength: '40', oninput: (ev) => { d.name = ev.target.value; } });
    const title = h('input', { type: 'text', value: d.title || '', maxlength: '60', placeholder: tr('edit.rolehint'), oninput: (ev) => { d.title = ev.target.value; } });
    const cnt = h('div', { class: 'count' }, (d.instructions || '').length + ' / 6000');
    const instr = h('textarea', { maxlength: '6000', style: 'height:150px', oninput: (ev) => { d.instructions = ev.target.value; cnt.textContent = d.instructions.length + ' / 6000'; } });
    instr.value = d.instructions || '';
    const seg = h('div', { class: 'seg' }, [['f', 'gender.f'], ['m', 'gender.m']].map(([v, k]) =>
      h('button', { class: d.gender === v ? 'on' : '', onclick: () => { d.gender = v; if (!stylesNow().includes(d.look.style)) d.look.style = stylesNow()[0]; keepScroll(); } }, tr(k))));
    const styleOpts = h('div', { class: 'opts' }, stylesNow().map((st) => h('button', { class: (d.look.style || look().style) === st ? 'on' : '', onclick: () => { d.look.style = st; keepScroll(); } }, tr('style.' + st))));
    const kindSeg = h('div', { class: 'seg' }, [[false, 'kind.specialist'], [true, 'kind.lead']].map(([v, k]) =>
      h('button', { class: !!d.lead === v ? 'on' : '', onclick: () => { d.lead = v; if (v) d.parent = 'chief'; keepScroll(); } }, tr(k))));
    const leadsList = members.filter((m) => m.lead && m.id !== 'chief' && m.id !== e.id);
    const parentSel = h('select', { 'aria-label': tr('edit.reports'), onchange: (ev) => { d.parent = ev.target.value; } }, h('option', { value: 'chief' }, tr('edit.reports.chief')),
      leadsList.map((m) => h('option', { value: m.id }, m.name + (m.title ? ' · ' + m.title : ''))));
    parentSel.value = d.parent && (d.parent === 'chief' || leadsList.some((m) => m.id === d.parent)) ? d.parent : 'chief';
    const pinBox = h('input', { type: 'checkbox', onchange: (ev) => { d.pinned = ev.target.checked; } });
    pinBox.checked = !!d.pinned;
    const propOpts = h('div', { class: 'opts' }, PROPS.map((k) => h('button', { class: (d.look.prop != null ? d.look.prop : look().role) === k ? 'on' : '', onclick: () => { d.look.prop = k; keepScroll(); } }, tr('prop.' + k))));
    const glassBox = h('input', { type: 'checkbox', onchange: (ev) => { d.look.glasses = ev.target.checked; keepScroll(); } });
    glassBox.checked = d.look.glasses != null ? !!d.look.glasses : look().glasses;
    const glasses = h('label', { class: 'switch' }, glassBox, tr('edit.glasses'));
    const save = h('button', { class: 'btn acc', disabled: e.saving, onclick: async () => {
      if (!String(d.name || '').trim()) { toast(tr('edit.err', { why: tr('edit.name') }), true); return; }
      e.saving = true;
      const r = await office.api('POST', '/api/team', { ...d, id: e.id || undefined });
      e.saving = false;
      if (r.ok) { editing = null; toast(tr('edit.saved')); await refresh(true); }
      else toast(tr('edit.err', { why: (r.data && r.data.error) || r.error || r.status }), true);
    } }, tr('edit.save'));
    let del = null;
    if (!isChief && e.id) {
      del = e.confirm
        ? h('div', { class: 'confirm' }, h('p', {}, tr('edit.confirmdelete')), h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', onclick: () => { e.confirm = false; keepScroll(); } }, tr('edit.cancel')),
          h('button', { class: 'btn danger', onclick: async () => {
            const r = await office.api('POST', '/api/team/' + encodeURIComponent(e.id) + '/delete', {});
            if (r.ok) { editing = null; toast(tr('edit.removed')); await refresh(true); } else toast(tr('edit.err', { why: (r.data && r.data.error) || r.status }), true);
          } }, tr('edit.yes'))))
        : h('button', { class: 'btn danger', style: 'margin-top:12px', onclick: () => { e.confirm = true; keepScroll(); } }, tr('edit.delete'));
    }
    s.append(
      h('div', { class: 'backrow' }, h('button', { onclick: () => { editing = null; render(); } }, '‹ ' + tr('nav.team')),
        h('h2', { style: 'margin:0' }, tr(isChief ? 'edit.title.chief' : e.id ? 'edit.title.edit' : 'edit.title.new'))),
      h('div', { class: 'preview' }, preview),
      field(tr('edit.name'), name),
      isChief ? null : field(tr('edit.role'), title),
      field(tr('edit.gender'), seg),
      isChief ? null : field(tr('edit.kind'), kindSeg, tr('edit.kindhint')),
      isChief || d.lead ? null : field(tr('edit.reports'), parentSel),
      isChief || d.lead ? null : h('div', { class: 'field' }, h('label', { class: 'switch' }, pinBox, tr('edit.pinned')), h('div', { class: 'note' }, tr('edit.pinnedhint'))),
      h('h2', {}, tr('edit.look')),
      field(tr('edit.hairstyle'), styleOpts),
      field(tr('edit.haircolor'), swatches('hair', S.HAIRS)),
      field(tr('edit.skin'), swatches('skin', S.SKINS)),
      field(tr('edit.suit'), swatches('suit', S.SUITS)),
      h('div', { class: 'field' }, glasses),
      isChief ? null : field(tr('edit.prop'), propOpts),
      field(tr('edit.instr'), h('div', {}, instr, cnt), tr(isChief ? 'edit.chiefhint' : 'edit.instrhint')),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { editing = null; render(); } }, tr('edit.cancel')), save), del, h('div', { class: 'pad' }));
  }


  // ------------------------------------------------------------------ reading a document (markdown-lite, built with the DOM only)
  function inlineDoc(str) {
    const frag = document.createDocumentFragment(), re = /(\*\*[^*]+\*\*|\[CONFERIR\]|\{\{[^}]+\}\})/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) frag.append(str.slice(last, m.index));
      const t = m[0];
      if (t === '[CONFERIR]') frag.append(h('span', { class: 'mark' }, 'CONFERIR'));
      else if (t.startsWith('{{')) frag.append(h('span', { class: 'mark fill' }, t.slice(2, -2)));
      else frag.append(h('strong', {}, t.slice(2, -2)));
      last = m.index + t.length;
    }
    if (last < str.length) frag.append(str.slice(last));
    return frag;
  }
  function renderDoc(text) {
    const box = h('div', { class: 'doc' });
    for (const raw of String(text).split('\n')) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) box.append(h('div', { class: 'sp' }));
      else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) box.append(h('div', { class: 'dh dh' + m[1].length }, inlineDoc(m[2])));
      else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) box.append(h('div', { class: 'li' }, '• ', inlineDoc(m[1])));
      else if (/^\s*\|/.test(line)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        box.append(h('div', { class: 'tr' }, line.trim().split('|').slice(1, -1).map((c) => h('span', {}, inlineDoc(c.trim())))));
      } else box.append(h('div', { class: 'p' }, inlineDoc(line)));
    }
    return box;
  }
  async function openFile(l, f) {
    viewing = { landing: l.id, path: f.name, state: 'loading' };
    renderApprovals();
    const r = await office.api('GET', '/api/landings/' + encodeURIComponent(l.id) + '/file?path=' + encodeURIComponent(f.name));
    if (!viewing || viewing.landing !== l.id || viewing.path !== f.name) return;
    viewing = r.ok ? { landing: l.id, path: f.name, state: 'ok', data: r.data } : { landing: l.id, path: f.name, state: 'err' };
    renderApprovals();
  }
  function viewer(l) {
    if (!viewing || viewing.landing !== l.id) return null;
    const head = h('div', { class: 'vhead' }, h('b', {}, viewing.path.split('/').pop()), h('button', { class: 'link', onclick: () => { viewing = null; renderApprovals(); } }, tr('review.close')));
    if (viewing.state === 'loading') return h('div', { class: 'viewer' }, head, h('div', { class: 'dim small' }, tr('review.loading')));
    if (viewing.state === 'err') return h('div', { class: 'viewer' }, head, h('div', { class: 'dim small' }, tr('review.error')));
    const d = viewing.data;
    if (d.binary) return h('div', { class: 'viewer' }, head, h('div', { class: 'dim small' }, tr('review.binary')));
    return h('div', { class: 'viewer' }, head, renderDoc(d.text), d.truncated ? h('div', { class: 'dim small' }, tr('review.truncated')) : null);
  }

  // ------------------------------------------------------------------ first-run tour and the "what do the characters mean" sheet
  function modal(content) {
    closeModal();
    const m = h('div', { class: 'modal', id: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
    document.body.append(m);
    return m;
  }
  function closeModal() { const m = $('modal'); if (m) m.remove(); }
  function spriteRow(items) {
    return h('div', { class: 'srow' }, items.map(([spec, state, label]) => {
      const cv = h('canvas', { width: S.W, height: S.H });
      S.draw(cv.getContext('2d'), S.look(spec.id || 'x', spec), state, 3, 1, 3);
      return h('div', { class: 'sitem' }, cv, h('span', {}, label));
    }));
  }
  function showTour(step) {
    step = step || 0;
    const slides = [
      { art: () => spriteRow([[{ id: 'chief', gender: 'f', look: { style: 'bun', suit: '#2f2f3a', glasses: true } }, 'idle', ''], [{ id: 'l1', lead: true, gender: 'm', look: { style: 'side' } }, 'working', ''], [{ id: 's1', gender: 'f', look: { style: 'long', prop: 1 } }, 'working', ''], [{ id: 's2', gender: 'm', look: { style: 'beard', prop: 4 } }, 'coffee', '']]) },
      { art: () => h('div', { class: 'mini' }, h('div', { class: 'bubble me' }, tr('onb.2.me')), h('div', { class: 'bubble them' }, tr('onb.2.them'),
        h('div', { class: 'plan' }, h('b', {}, tr('plan.title')), h('div', { class: 'dim small' }, 'Helena · ' + tr('role.docs'))))) },
      { art: () => spriteRow([[{ id: 'alert1', gender: 'f' }, 'alert', ''], [{ id: 'chief', gender: 'f', look: { style: 'bun' } }, 'cheer', '']]) },
    ];
    const sl = slides[step], last = step === slides.length - 1;
    const dots = h('div', { class: 'dots' }, slides.map((_, i) => h('i', { class: i === step ? 'on' : '' })));
    const finish = async () => { cfg.onboarded = true; await office.setConfig({ onboarded: true }); closeModal(); if (tab !== 'chat') { tab = 'chat'; } render(); };
    modal(h('div', { class: 'sheet' }, sl.art(), h('h3', {}, tr('onb.' + (step + 1) + '.title')), h('p', {}, tr('onb.' + (step + 1) + '.text')), dots,
      h('div', { class: 'actions' }, last ? null : h('button', { class: 'btn ghost', onclick: finish }, tr('onb.skip')),
        h('button', { class: 'btn acc', onclick: () => (last ? finish() : showTour(step + 1)) }, tr(last ? 'onb.start' : 'onb.next')))));
  }
  function showHelp() {
    modal(h('div', { class: 'sheet' }, h('h3', {}, tr('help.title')),
      spriteRow([[{ id: 'h1', gender: 'f', look: { prop: 1 } }, 'working', tr('help.working')], [{ id: 'h2', gender: 'm' }, 'alert', tr('help.alert')], [{ id: 'h3', gender: 'f' }, 'coffee', tr('help.idle')], [{ id: 'chief', gender: 'f', look: { style: 'bun' } }, 'idle', tr('help.badge')]]),
      h('p', { class: 'dim' }, tr('help.click')),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { closeModal(); showTour(0); } }, tr('onb.again')), h('button', { class: 'btn acc', onclick: closeModal }, tr('help.close')))));
  }

  // ------------------------------------------------------------------ approvals
  function renderApprovals() {
    const s = $('s-approvals'); clear(s);
    const b = banner(); if (b) s.append(b);
    s.append(h('h2', {}, tr('approvals.title')));
    if (!landings.length) {
      const art = sprite('clodfarm', 'sofa', 'art'); art.className = 'art';
      s.append(h('div', { class: 'empty' }, art, h('b', {}, tr('approvals.empty.title')), tr('approvals.empty.text')));
      return;
    }
    for (const l of landings) {
      const mm = memberOf(l.specialist), p = mm ? { name: mm.name } : O.persona(l.id), role = mm ? roleOf(mm) : tr('role.' + O.persona(l.id).role);
      const files = (l.files || []).map((f) => { const [k, ...rest] = f.split('\t'); return { k: /^[AMD]/.test(k) ? k[0] : 'M', name: rest.join('\t') || f }; });
      const busyNow = busy.has(l.id);
      const card = h('div', { class: 'card review' },
        h('h3', {}, l.title || l.id),
        h('div', { class: 'by' }, tr('approvals.by', { name: p.name, role: role || tr('pet.chief') })),
        h('div', { class: 'label' }, tr('approvals.what')),
        h('div', { class: 'said' }, cleanSummary(l.summary) || tr('team.noresult')),
        files.length ? [h('div', { class: 'label' }, tr('approvals.changes')),
          h('ul', { class: 'files' }, files.map((f) => h('li', { class: 'fileli' }, h('span', { class: 'tagf ' + f.k }, tr('file.' + f.k)),
            h('span', { class: 'fname' }, f.name.split('/').pop()), f.k === 'D' ? null : h('button', { class: 'link', onclick: () => openFile(l, f) }, tr('review.open'))))),
          viewer(l)] : null,
        h('div', { class: 'after' }, tr('approvals.after')));
      if (confirmDeny.has(l.id)) {
        card.append(h('div', { class: 'confirm' }, h('p', {}, tr('approvals.confirmdeny')), h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', onclick: () => { confirmDeny.delete(l.id); renderApprovals(); } }, tr('approvals.cancel')),
          h('button', { class: 'btn danger', disabled: busyNow, onclick: () => decide(l, 'deny') }, tr('approvals.yesdeny')))));
      } else {
        card.append(h('div', { class: 'actions' },
          h('button', { class: 'btn danger', disabled: busyNow, onclick: () => { confirmDeny.add(l.id); renderApprovals(); } }, tr('approvals.deny')),
          h('button', { class: 'btn ok', disabled: busyNow, onclick: () => decide(l, 'approve') }, tr('approvals.approve'))));
      }
      s.append(card);
    }
  }
  async function decide(l, kind) {
    busy.add(l.id); renderApprovals();
    const r = await office.api('POST', '/api/landings/' + encodeURIComponent(l.id) + '/' + kind, {});
    busy.delete(l.id); confirmDeny.delete(l.id);
    if (r.ok) {
      toast(tr(kind === 'approve' ? 'approvals.saved' : 'approvals.denied'));
      viewing = null;
      if (kind === 'approve' && office.broadcast) office.broadcast({ type: 'approved', id: l.id, specialist: l.specialist || 'chief' });
    } else toast(tr('approvals.failed', { why: (r.data && r.data.error) || r.error || r.status }), true);
    await refresh(true);
  }

  // ------------------------------------------------------------------ connectors of the person's Claude account
  function connectorsCard() {
    const list = h('div', {}, h('div', { class: 'dim small' }, tr('review.loading')));
    let current = [];
    const post = async (allow) => {
      const r = await office.api('POST', '/api/claude-connectors', { allow });
      if (r.ok && r.data) { current = r.data.connectors; paint(); } else toast(tr('conn.error'), true);
    };
    const paint = () => {
      clear(list);
      if (!current.length) { list.append(h('div', { class: 'note' }, tr('conn.empty'))); return; }
      for (const c of current) {
        const box = h('input', { type: 'checkbox', disabled: !c.connected, onchange: () => post(current.map((x) => (x.id === c.id ? (box.checked ? x.id : null) : (x.allowed ? x.id : null))).filter(Boolean)) });
        box.checked = !!c.allowed;
        list.append(h('div', { class: 'connrow' },
          h('div', { class: 'cn' }, h('b', {}, c.name), h('span', { class: 'chip ' + (c.connected ? 'working' : 'idle') }, tr(c.connected ? 'conn.connected' : 'conn.needauth'))),
          h('label', { class: 'switch' }, box, tr('conn.allow'))));
      }
    };
    const load = async (refresh) => {
      const r = await office.api('GET', '/api/claude-connectors' + (refresh ? '?refresh=1' : ''));
      if (r.ok && r.data) { current = r.data.connectors; paint(); } else { clear(list); list.append(h('div', { class: 'note' }, tr('conn.error'))); }
    };
    load(false);
    const steps = h('ol', { class: 'steps' }, [1, 2, 3, 4].map((n) => h('li', {}, tr('conn.s' + n))));
    return h('div', { class: 'card' }, h('b', {}, tr('conn.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('conn.text')), list,
      h('div', { class: 'actions' }, h('button', { class: 'btn acc', onclick: () => office.openConnectors() }, tr('conn.open')), h('button', { class: 'btn ghost', onclick: () => load(true) }, tr('conn.refresh'))),
      h('details', { class: 'how' }, h('summary', {}, tr('conn.how')), steps), h('div', { class: 'note' }, tr('conn.privacy')));
  }

  // ------------------------------------------------------------------ settings
  function renderSettings() {
    const s = $('s-settings'); clear(s);
    const seg = h('div', { class: 'seg' }, [['pt-BR', 'Português'], ['en', 'English']].map(([v, label]) =>
      h('button', { class: cfg.lang === v ? 'on' : '', onclick: async () => { cfg = { ...cfg, ...(await office.setConfig({ lang: v })) }; render(); } }, label)));
    const notifyBox = h('input', { type: 'checkbox', onchange: async (e) => { cfg = { ...cfg, ...(await office.setConfig({ notify: e.target.checked })) }; } }); notifyBox.checked = cfg.notify !== false;
    const sound = h('input', { type: 'checkbox', onchange: async (e) => { cfg = { ...cfg, ...(await office.setConfig({ sound: e.target.checked })) }; } }); sound.checked = !!cfg.sound;
    const url = h('input', { type: 'text', value: cfg.url || '', 'aria-label': tr('settings.url'), onchange: async (e) => { cfg = { ...cfg, ...(await office.setConfig({ url: e.target.value.trim() })) }; toast(tr('settings.saved')); refresh(true); } });
    const keyPill = h('span', { class: 'pill' + (cfg.hasToken ? '' : ' off') }, h('i'), tr(cfg.hasToken ? 'settings.keyok' : 'settings.keymissing'));
    const fetchKey = h('button', { class: 'btn ghost', onclick: async () => { const ok = await office.autoToken(); toast(tr(ok ? 'settings.tokenok' : 'settings.tokenfail'), !ok); if (ok) { cfg.hasToken = true; refresh(true); } } }, tr('settings.autotoken'));
    const yo = Number(cfg.yoffset || 0);
    const yoVal = h('b', {}, yo === 0 ? tr('settings.auto') : (yo > 0 ? '+' : '') + yo + ' px');
    const nudge = (d) => async () => { cfg = { ...cfg, ...(await office.setConfig({ yoffset: d === 0 ? 0 : Number(cfg.yoffset || 0) + d })) }; renderSettings(); };
    const heightRow = h('div', { class: 'keyrow' },
      h('button', { class: 'btn ghost', 'aria-label': '-', onclick: nudge(1) }, '▼'), yoVal,
      h('button', { class: 'btn ghost', 'aria-label': '+', onclick: nudge(-1) }, '▲'),
      h('button', { class: 'btn ghost', onclick: nudge(0) }, tr('settings.auto')));
    s.append(h('h2', {}, tr('nav.settings')),
      connectorsCard(),
      h('div', { class: 'card' }, h('b', {}, tr('settings.exports')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('settings.exportshint')),
        h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn ghost', onclick: () => office.openExports() }, tr('settings.openexports')))),
      h('div', { class: 'field' }, h('label', {}, tr('settings.language')), seg),
      h('div', { class: 'field' }, h('label', { class: 'switch' }, notifyBox, tr('settings.notify'))),
      h('div', { class: 'field' }, h('label', { class: 'switch' }, sound, tr('settings.sound'))),
      h('div', { class: 'note' }, tr('settings.hotkey')),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => showTour(0) }, tr('onb.again')),
        h('button', { class: 'btn ghost', onclick: () => office.togglePets() }, tr(cfg.hidden ? 'settings.show' : 'settings.hide'))),
      h('details', { class: 'how adv' }, h('summary', {}, tr('settings.advanced')),
        h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, tr('settings.key')), h('div', { class: 'keyrow' }, keyPill, fetchKey)),
        h('div', { class: 'field' }, h('label', {}, tr('settings.url')), url),
        h('div', { class: 'field' }, h('label', {}, tr('settings.height')), heightRow, h('div', { class: 'note' }, tr('settings.heightHint'))),
        h('div', { class: 'stack' },
          h('button', { class: 'btn ghost', onclick: () => office.openFarm() }, tr('settings.openfarm')),
          h('button', { class: 'btn danger', onclick: () => office.quit() }, tr('settings.exit')),
          h('div', { class: 'note' }, tr('settings.trayhint')))));
  }

  function render() {
    if (tab !== 'chat' && chatTimer) { clearInterval(chatTimer); chatTimer = null; }
    renderChrome(); renderChatTab(); renderTeam(); renderApprovals(); renderSettings();
  }

  // where a request to open the panel lands: approvals when asked, the conversation for a character, else the tab named
  function route(o) {
    if (o.tab === 'approvals') tab = 'approvals';
    else if (o.kind === 'member' && o.id) { chatWith = o.id; tab = 'chat'; chatSig = ''; }
    else if (o.tab === 'chat') { chatWith = o.id || 'chief'; tab = 'chat'; chatSig = ''; }
    else if (o.tab) tab = o.tab;
    focusId = tab === 'team' ? (o.id || '') : '';
  }
  $('close').addEventListener('click', () => window.close());
  $('help').addEventListener('click', showHelp);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  async function init() {
    cfg = { ...cfg, ...(await office.getConfig()) };
    dicts = await office.dicts();
    document.documentElement.lang = cfg.lang;
    office.on('config', (c) => { cfg = { ...cfg, ...c }; document.documentElement.lang = cfg.lang; render(); });
    office.on('focus', (o) => { route(o); refresh(true); render(); });
    if (q.get('kind') === 'member' || tab === 'chat') route({ tab, id: focusId, kind: q.get('kind') });
    await refresh(true);
    render();
    if (cfg.onboarded === false) showTour(0);
    setInterval(() => refresh(false), 3000);
  }
  init();
})();
