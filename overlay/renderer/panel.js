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
  let viewing = null, prog = null, progOpen = '', progDetail = null, showRaw = false, revs = {}, revTimer = null;
  let landings = [], farm = null, members = [], editing = null, offline = false, authErr = false, lastSig = '';
  let hiringData = { pending: [], recent: [] };
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
    if (q.has('firstrun')) M.splice(1);
    M.push({ id: 'rh', name: 'Teresa', title: 'Recursos Humanos', gender: 'f', lead: false, parent: 'chief', instructions: 'Você é o RH do escritório: monta e cuida da equipe.', look: { style: 'long', prop: 1, glasses: true } });
    L.forEach((l) => { l.specialist = 'ana'; }); st.subagents.forEach((t, i) => { t.specialist = i ? 'bruno' : 'ana'; });
    const REV = { messages: [], pending: false };
    const mockReview = (m, p, b) => {
      if (/\/revise$/.test(p) && m === 'GET') return { ok: true, status: 200, data: REV };
      if (/\/revise$/.test(p)) {
        REV.messages.push({ id: 1, role: 'user', text: b.instruction, path: b.path }, { id: 2, role: 'assistant', reply_to: 1, ok: true, text: 'Encurtei os fatos e deixei só o essencial.',
          proposal: { path: b.path, text: '# Requerimento de salário-maternidade\n\n**Requerente:** Maria Exemplo da Silva (CPF {{preencher}})\n\n## Fatos\n- Gestante, 30ª semana [CONFERIR]\n\n| Documento | Situação |\n|---|---|\n| RG | Recebido |\n| Procuração | **Falta** |\n\nRequer o benefício [CONFERIR].' } });
        return { ok: true, status: 200, data: REV };
      }
      return { ok: true, status: 200, data: { path: b.path, text: b.text, truncated: false, binary: false, changed: true } };
    };
    const NOW = Date.now() / 1000;
    const HIRE = { id: 'h1a2b3c4d', status: 'pending', message: 'Montei uma equipe pequena para um escritório previdenciário.', ignored: 0, items: [
      { action: 'hire', ref: 'coord-docs', reason: '', test: 'Peça: organize os documentos de um caso fictício.', fields: { name: 'Beatriz', title: 'Coordenação de documentos', lead: true, parent: 'chief', gender: 'f', instructions: 'Você coordena documentos e peças. A ordem é: documentos organizados primeiro, depois a minuta e, por fim, a revisão. Tudo é rascunho.' } },
      { action: 'hire', ref: '', reason: '', test: 'Peça: confira a pasta de um cliente fictício.', fields: { name: 'Gabi', title: 'Documentos', lead: false, parent: 'coord-docs', gender: 'f', instructions: 'Você recebe os arquivos em clientes/<nome>/entrada/, confere, renomeia e arquiva, e lista o que falta.' } },
      { action: 'edit', id: 'ana', name: 'Ana', reason: 'As instruções estavam vagas sobre onde gravar.', fields: { instructions: 'Você acompanha andamentos... (texto novo completo)' } }] };
    const ALERTS = q.has('alerts') ? [{ kind: 'login' }, { kind: 'limit' }] : [];
    const PROG = { now: NOW, alerts: ALERTS, pace: { limited: true, code: 'week', workers: 1, max: 3, speed: 'balanced', speeds: ['balanced', 'fast', 'max'], week_used: 0.18, week_allowed: 0.14 },
      jobs: [{ id: 'jobA1', title: 'Plano: Analisar a viabilidade do caso fictício da dona Maria', status: 'waiting', specialist: 'chief', created: NOW - 400, started: NOW - 390, finished: null, landing: null,
        nodes: [{ id: 'jobA1', title: 'Plano', status: 'waiting', specialist: 'chief', started: NOW - 390, depth: 0, name: 'Marina', title_role: 'Chefe do escritório' },
          { id: 'k1', title: 'Documentos', status: 'done', specialist: 'ana', started: NOW - 380, finished: NOW - 290, depth: 1, name: 'Ana', title_role: 'Documentos' },
          { id: 'k2', title: 'Prazos', status: 'running', specialist: 'bruno', started: NOW - 280, depth: 1, name: 'Bruno', title_role: 'Prazos' },
          { id: 'k3', title: 'Viabilidade', status: 'queued', specialist: 'ana', started: null, depth: 1, name: 'Ana', title_role: 'Documentos' }],
        steps: [{ at: NOW - 300, task: 'jobA1', cat: 'call', arg: 'Documentos: Maria (fictício)', who: 'ana', text: 'Bash: clodfarm spawn ...' }, { at: NOW - 200, task: 'k2', cat: 'read', arg: 'clientes/maria-exemplo/inventario.md', text: 'Read: x' },
          { at: NOW - 120, task: 'k2', cat: 'compute', arg: '', text: 'Bash: python3 -' }, { at: NOW - 40, task: 'k2', cat: 'write', arg: 'saidas/prazos/maria.md', text: 'Write: saidas/prazos/maria.md' }, { at: NOW - 12, task: 'k2', cat: 'say', arg: 'Montei a lista de prazos; falta conferir a data provável do parto.', text: 'x' }] }],
      recent: [] };
    const CH = [{ id: 1, role: 'user', text: 'Oi Ana, o que falta no caso Exemplo?', at: 1 }, { id: 2, role: 'assistant', text: 'Faltam a procuração assinada e um comprovante de residência atual. Quer que eu escreva a mensagem de cobrança?', at: 2, ok: true, reply_to: 1, waiting: true }];
    return {
      api: async (m, p, b) => p.startsWith('/api/hiring/import') ? { ok: true, status: 200, data: { id: 'x' } } : p.startsWith('/api/hiring') ? { ok: true, status: 200, data: { recent: [], pending: q.has('hiring') ? [HIRE] : [] } } : /\/api\/landings\/[^/]+\/(revise|save)$/.test(p) ? mockReview(m, p, b) : p.startsWith('/api/progress') ? { ok: true, status: 200, data: p.indexOf('/api/progress/') === 0 ? { now: NOW, pace: PROG.pace, job: PROG.jobs[0] } : PROG } : p.startsWith('/api/speed') ? { ok: true, status: 200, data: { speed: b && b.mode } } : p.startsWith('/api/claude-connectors') ? { ok: true, status: 200, data: { url: 'https://claude.ai', connectors: [{ id: 'claude_ai_Google_Drive', name: 'Google Drive', connected: true, allowed: b && b.allow ? b.allow.includes('claude_ai_Google_Drive') : false }, { id: 'claude_ai_Gmail', name: 'Gmail', connected: false, allowed: false }, { id: 'claude_ai_Google_Calendar', name: 'Google Calendar', connected: true, allowed: b && b.allow ? b.allow.includes('claude_ai_Google_Calendar') : false }] } } : /\/api\/landings\/[^/]+\/file/.test(p) ? { ok: true, status: 200, data: { path: 'requerimento.md', binary: false, truncated: false, text: '# Requerimento de salário-maternidade\n\n**Requerente:** Maria Exemplo da Silva (CPF {{preencher}})\n\n## Fatos\n- Gestante, 30ª semana [CONFERIR]\n- Trabalha na roça há 4 anos\n\n| Documento | Situação |\n|---|---|\n| RG | Recebido |\n| Procuração | **Falta** |\n\nRequer o benefício nos termos da Lei 8.213/91 [CONFERIR].' } } : p.startsWith('/api/chat/') ? { ok: true, status: 200, data: { messages: CH, pending: false } } : ({ ok: true, status: 200, data: p.startsWith('/api/landings') ? L : p.startsWith('/api/state') ? st : p.startsWith('/api/team') ? M : p.startsWith('/api/tasks/') ? { summary: 'Conferi 4 prazos. Um vence amanhã.' } : {} }),
      getConfig: async () => ({ ...cfg, characters: q.get('characters') || 'people', petScale: Number(q.get('scale')) || 3, onboarded: !q.has('tour'), legalAccepted: !q.has('legal'), version: '1.0.3', exportFormats: ['docx'], update: q.has('update') ? { version: '1.1.0', notes: 'Novidades de teste', url: 'https://github.com/lcssurf/escritorio-digital/releases/latest' } : null }),
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json?v=' + Date.now())).json(), en: await (await fetch('../i18n/en.json?v=' + Date.now())).json() }),
      setConfig: async (p) => ({ ...cfg, ...p }), autoToken: async () => true, on() {}, openFarm() {}, openExports() {}, openConnectors() {}, notify() {}, setWide(w) { document.body.classList.toggle('wide', !!w); },
      exportDoc: async (r) => ({ ok: true, path: 'C:\\Documentos\\Escritório Digital\\' + r.title + '.' + r.format }), exportApproved: async () => ({ ok: true, made: 2 }), saveBackup: async () => ({ ok: true, people: 3 }), restoreBackup: async () => ({ ok: true, restored: 3 }), checkUpdate: async () => ({ ok: true, current: '1.0.3', latest: '1.0.3', update: null }), runUpdate: async () => ({ ok: true }), openRelease() {}, quit() {}, togglePets() {}, broadcast() {},
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
    progress: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
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
    if (d < 10) return tr('time.now');
    if (d < 60) return tr('time.sec', { n: Math.floor(d) });
    if (d < 3600) return tr('time.min', { n: Math.floor(d / 60) });
    return tr('time.h', { n: Math.floor(d / 3600) });
  }
  const cleanSummary = (s) => String(s || '').replace(/\n*\[git\][\s\S]*$/, '').trim();

  // ------------------------------------------------------------------ data
  async function refresh(force) {
    const [ld, st, tm, pg, hr] = await Promise.all([office.api('GET', '/api/landings'), office.api('GET', '/api/state'), office.api('GET', '/api/team'), office.api('GET', '/api/progress'), office.api('GET', '/api/hiring')]);
    if (hr.ok && hr.data && Array.isArray(hr.data.pending)) hiringData = hr.data;
    if (tm.ok && Array.isArray(tm.data)) { const tz = O.teamsOf(tm.data); members = tm.data.map((m) => ({ ...m, viz: tz.get(m.id) || null })); }
    if (pg.ok && pg.data) prog = pg.data;
    if (progOpen && prog && prog.jobs.concat(prog.recent || []).some((j) => j.id === progOpen)) loadDetail(progOpen);
    offline = !st.ok && st.status === 0;
    authErr = ld.status === 401 || ld.status === 403;
    landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    farm = st.ok ? st.data : null;
    const sig = JSON.stringify([landings.map((l) => l.id), farm && farm.agents, farm && farm.subagents, farm && (farm.events || []).slice(0, 3), members, offline, authErr, hiringData.pending.map((p) => p.id), prog && [prog.pace, prog.jobs.map((j) => [j.id, j.status, j.nodes.map((n) => n.status), (j.steps[j.steps.length - 1] || {}).at]), Math.floor(((prog.now) || 0) / 10)], progDetail && (progDetail.job.steps.slice(-1)[0] || {}).at, [...confirmDeny], [...busy]]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (!tab) tab = 'chat';
    if (tab === 'progress') { renderChrome(); renderProgress(); return; }
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
    const nt = $('notices'); clear(nt); for (const n of notices()) nt.append(n);
    const tiles = $('tiles'); clear(tiles);
    tiles.append(
      h('div', { class: 'tile' + (landings.length ? ' hot' : '') }, h('b', {}, landings.length), h('span', {}, tr('sum.waiting'))),
      h('div', { class: 'tile' }, h('b', {}, running), h('span', {}, tr('sum.working'))),
      h('div', { class: 'tile' }, h('b', {}, team), h('span', {}, tr('sum.team'))));
    const nav = $('nav'); clear(nav);
    for (const [id, key] of [['chat', 'nav.chat'], ['progress', 'nav.progress'], ['team', 'nav.team'], ['approvals', 'nav.approvals'], ['settings', 'nav.settings']]) {
      const b = h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; focusId = ''; render(); }, 'aria-label': tr(key) }, icon(id), tr(key));
      if (id === 'approvals' && landings.length) b.append(h('span', { class: 'badge' }, landings.length));
      if (id === 'progress' && prog && prog.jobs.length) b.append(h('span', { class: 'badge info' }, prog.jobs.length));
      if (id === 'team' && hiringData.pending.length) b.append(h('span', { class: 'badge' }, hiringData.pending.length));
      nav.append(b);
    }
    for (const id of ['chat', 'progress', 'team', 'approvals', 'settings']) $('s-' + id).className = id === tab ? 'on' : '';
  }
  // a notice that needs the person: a new version, the Claude account signed out, or the plan's limit
  function notices() {
    const out = [];
    const u = cfg.update;
    if (u && !offline) out.push(h('div', { class: 'banner upd' }, h('b', {}, tr('update.banner', { v: u.version })),
      h('div', { class: 'actions', style: 'margin-top:8px' },
        h('button', { class: 'btn acc', onclick: async () => { const r = await office.runUpdate(); if (r && r.ok) toast(tr('update.running')); } }, tr('update.now')),
        h('button', { class: 'btn ghost', onclick: () => office.openRelease() }, tr('update.notes')),
        h('button', { class: 'btn ghost', onclick: async () => { cfg = { ...cfg, ...(await office.setConfig({ updateSkipped: 'v' + u.version })) }; cfg.update = null; render(); } }, tr('update.skip')))));
    const al = (prog && prog.alerts) || [];
    if (al.some((a) => a.kind === 'login') && !offline) out.push(h('div', { class: 'banner alert' }, h('b', {}, tr('alert.login')),
      h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn acc', onclick: showLoginHelp }, tr('alert.login.how')))));
    if (al.some((a) => a.kind === 'limit') && !offline) out.push(h('div', { class: 'banner pace' }, h('b', {}, tr('alert.limit')),
      tab === 'progress' ? null : h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: () => { tab = 'progress'; render(); } }, tr('alert.limit.see')))));
    return out;
  }
  function showLoginHelp() {
    const cmd = 'docker exec -it clodfarm clodfarm login';
    modal(h('div', { class: 'sheet' }, h('h3', {}, tr('alert.login.title')),
      h('ol', { class: 'steps' }, [1, 2, 3, 4].map((n) => h('li', {}, tr('alert.login.s' + n)))),
      h('pre', { class: 'cmd' }, cmd),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => { try { navigator.clipboard.writeText(cmd); toast(tr('alert.copied')); } catch (_) { /* the command is on screen */ } } }, tr('alert.copy')),
        h('button', { class: 'btn acc', onclick: closeModal }, tr('help.close')))));
  }
  function banner() {
    const list = [];
    if (cfg.hidden) list.unshift(h('div', { class: 'banner' }, tr('banner.hidden'), ' ', h('button', { class: 'btn ghost', style: 'flex:none;padding:5px 10px;margin-left:6px', onclick: () => office.togglePets() }, tr('settings.show'))));
    else if (offline) list.unshift(h('div', { class: 'banner' }, tr('error.offline', { url: cfg.url || '' }), ' ', h('button', { class: 'btn ghost', style: 'flex:none;padding:5px 10px;margin-left:6px', onclick: () => refresh(true) }, tr('error.retry'))));
    else if (authErr) list.unshift(h('div', { class: 'banner' }, tr('error.auth')));
    return list.length ? h('div', { class: 'banners' }, list) : null;
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
    s.append(rhSection());
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

  // ------------------------------------------------------------------ the RH: proposals to hire, change or let go, and imports
  const picks = new Map();   // proposal id -> the indexes the lawyer keeps ticked
  const ACTION_KEY = { hire: 'rh.prop.hire', edit: 'rh.prop.edit', dismiss: 'rh.prop.dismiss' };
  function bossName(it, p) {
    const f = it.fields || {};
    const b = f.parent || 'chief';
    const viaRef = p.items.find((x) => x.ref && x.ref === b);
    const m = memberOf(b);
    return viaRef ? viaRef.fields.name : (m ? m.name : b);
  }
  function proposalCard(p) {
    if (!picks.has(p.id)) picks.set(p.id, new Set(p.items.map((_, i) => i)));
    const on = picks.get(p.id);
    const card = h('div', { class: 'card prop' }, h('b', {}, tr('rh.prop.title')));
    if (p.message) card.append(h('div', { class: 'note', style: 'margin:4px 0' }, p.message));
    card.append(h('div', { class: 'note warn' }, tr('rh.prop.warn')));
    p.items.forEach((it, i) => {
      const f = it.fields || {};
      const name = it.action === 'hire' ? f.name : (it.name || it.id);
      const box = h('input', { type: 'checkbox', onchange: () => { if (box.checked) on.add(i); else on.delete(i); approve.disabled = !on.size; } });
      box.checked = on.has(i);
      const row = h('div', { class: 'propitem' },
        h('label', { class: 'switch' }, box,
          h('span', { class: 'chip ' + (it.action === 'dismiss' ? 'alert' : it.action === 'edit' ? 'idle' : 'working') }, tr(ACTION_KEY[it.action])),
          h('span', { class: 'pname' }, h('b', {}, name), it.action === 'hire' && f.title ? h('span', { class: 'role' }, ' · ' + f.title) : null,
            it.action === 'hire' && f.lead ? h('span', { class: 'badge-lead' }, tr('rh.prop.lead')) : null)));
      if (it.action === 'hire') row.append(h('div', { class: 'dim small' }, tr('rh.prop.reports', { boss: bossName(it, p) })));
      if (it.reason) row.append(h('div', { class: 'dim small' }, tr('rh.prop.why', { why: it.reason })));
      if (it.test) row.append(h('div', { class: 'dim small' }, tr('rh.prop.test', { t: it.test })));
      if (f.instructions) row.append(h('details', { class: 'how' }, h('summary', {}, tr('rh.prop.instr')), h('div', { class: 'detail' }, f.instructions)));
      card.append(row);
    });
    if (p.ignored) card.append(h('div', { class: 'note' }, tr('rh.prop.ignored', { n: p.ignored })));
    const approve = h('button', { class: 'btn ok', onclick: async () => {
      approve.disabled = true;
      const r = await office.api('POST', '/api/hiring/' + encodeURIComponent(p.id) + '/approve', { items: [...on].sort((a, b) => a - b) });
      if (r.ok) { const last = (r.data.recent || []).slice(-1)[0] || {}; toast(tr('rh.prop.done', { n: (last.results || []).length })); picks.delete(p.id); }
      else { toast(tr('rh.prop.fail', { why: (r.data && r.data.error) || r.error || r.status }), true); approve.disabled = false; }
      await refresh(true);
    } }, tr('rh.prop.approve'));
    const deny = h('button', { class: 'btn ghost', onclick: async () => {
      const r = await office.api('POST', '/api/hiring/' + encodeURIComponent(p.id) + '/deny', {});
      if (r.ok) { toast(tr('rh.prop.denied')); picks.delete(p.id); }
      await refresh(true);
    } }, tr('rh.prop.deny'));
    card.append(h('div', { class: 'actions' }, deny, approve));
    return card;
  }
  async function startWithRh() {
    const r = await office.api('POST', '/api/chat/rh', { text: tr('rh.first') });
    if (!r.ok) toast(tr('edit.err', { why: (r.data && r.data.error) || r.status }), true);
    openChat('rh');
  }
  function importCard() {
    const ta = h('textarea', { class: 'chatin', rows: '5', placeholder: tr('rh.import.paste'), style: 'height:110px' });
    const note = h('input', { type: 'text', placeholder: tr('rh.import.note'), maxlength: '300' });
    let fname = '';
    const file = h('input', { type: 'file', accept: '.md,.markdown,.txt,.text', style: 'display:none', onchange: async () => {
      const f = file.files && file.files[0]; if (!f) return;
      if (f.size > 200000) { toast(tr('rh.import.big'), true); return; }
      fname = f.name; ta.value = await f.text();
    } });
    const send = h('button', { class: 'btn acc', onclick: async () => {
      if (!ta.value.trim()) return;
      send.disabled = true;
      const r = await office.api('POST', '/api/hiring/import', { text: ta.value, name: fname, note: note.value });
      send.disabled = false;
      if (r.ok) { toast(tr('rh.import.sent')); ta.value = ''; note.value = ''; fname = ''; } else toast(tr('rh.import.err', { why: (r.data && r.data.error) || r.error || r.status }), true);
    } }, tr('rh.import.send'));
    return h('details', { class: 'how card' }, h('summary', {}, tr('rh.import.title')),
      h('div', { class: 'note', style: 'margin:6px 0 8px' }, tr('rh.import.text')),
      ta, h('div', { class: 'actions', style: 'margin-top:6px' }, h('button', { class: 'btn ghost', onclick: () => file.click() }, tr('rh.import.file')), file),
      note, h('div', { class: 'actions' }, send));
  }
  function rhSection() {
    const box = h('div', {});
    for (const p of (hiringData.pending || [])) box.append(proposalCard(p));
    if (memberOf('rh')) box.append(h('div', { class: 'card' }, h('b', {}, tr('rh.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('rh.text')),
      h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn acc', onclick: () => openChat('rh') }, tr('rh.talk')))), importCard());
    return box;
  }
  function firstRunCard() {
    return h('div', { class: 'card' }, h('b', {}, tr('rh.firstrun.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('rh.firstrun.text')),
      h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn acc', onclick: startWithRh }, tr('rh.start'))));
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
    stripEl.append(h('span', { class: 'dim small' }, tr('chat.working')), h('button', { class: 'link', onclick: () => { tab = 'progress'; render(); } }, tr('prog.see')));
    for (const m of act) stripEl.append(h('span', { class: 'chipw' }, h('i'), m.name + (m.title ? ' · ' + m.title : '')));
  }
  function renderChatTab() { const s = $('s-chat'); clear(s); if (tab === 'chat') { renderChat(s); if (members.length <= 2 && memberOf('rh') && chatWith === 'chief') s.prepend(firstRunCard()); } }
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
    const vizNow = () => { const tz = O.teamsOf(members.filter((m) => m.id !== e.id).concat([{ ...d, id: e.id || 'novo' }])); return tz.get(e.id || 'novo') || null; };
    const look = () => S.look(e.id || 'novo', { ...d, id: e.id || d.id, viz: vizNow() });
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
    const kitOpts = h('div', { class: 'opts' }, S.KITS.map((k, i) => h('button', { class: (d.look.kit != null ? d.look.kit : look().kit) === i ? 'on' : '', onclick: () => { d.look.kit = i; keepScroll(); } }, tr('kit.' + k))));
    const buildSeg = h('div', { class: 'seg' }, [0, 1].map((b) => h('button', { class: (d.look.build || 0) === b ? 'on' : '', onclick: () => { d.look.build = b; keepScroll(); } }, tr('build.' + b))));
    const speciesOpts = h('div', { class: 'opts' }, [null, ...S.SPECIES].map((sp) => h('button', { class: (d.look.species || null) === sp ? 'on' : '', onclick: () => { if (sp) d.look.species = sp; else delete d.look.species; keepScroll(); } }, tr(sp ? 'species.' + sp : 'species.auto'))));
    const teamSuit = h('button', { class: 'btn ghost', style: 'margin-top:6px;padding:5px 10px', onclick: () => { delete d.look.suit; keepScroll(); } }, tr('edit.teamcolor'));
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
      field(tr('edit.suit'), h('div', {}, swatches('suit', S.SUITS.concat(S.TEAM_COLORS)), teamSuit), tr('edit.suithint')),
      isChief ? null : field(tr('edit.kit'), kitOpts, tr('edit.kithint')),
      field(tr('edit.build'), buildSeg),
      cfg.characters === 'animals' ? field(tr('edit.species'), speciesOpts) : null,
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
  // ------------------------------------------------------------------ the reader: documents of work that waits for approval
  // The window opens to the side: the list stays on the left, the document is read, edited or adjusted on the right.
  const MAIN_DOC = /(^|\/)saidas\/(pecas|requerimentos|peticoes|contratos|recursos)\//i;
  const INPUT_DOC = /(^|\/)(entrada|entradas|modelos)\//i;
  const fileRank = (p) => (MAIN_DOC.test(p) ? 'main' : INPUT_DOC.test(p) ? 'inputs' : 'support');
  function folderOf(p) {
    const m = /(^|\/)saidas\/([a-z0-9-]+)\//i.exec(p);
    if (!m) return '';
    const key = 'folder.' + m[2].toLowerCase();
    const label = tr(key);
    return label === key ? m[2] : label;
  }
  function friendly(p) {
    const base = p.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : p;
  }
  function groupFiles(files) {
    const g = { main: [], support: [], inputs: [] };
    for (const f of files) g[fileRank(f.name)].push(f);
    return g;
  }
  function fileList(l, files) {
    const g = groupFiles(files), box = h('div', { class: 'flist' });
    const sections = g.main.length
      ? [['approvals.group.main', g.main], ['approvals.group.support', g.support], ['approvals.group.inputs', g.inputs]]
      : [['approvals.group.docs', g.support], ['approvals.group.inputs', g.inputs]];
    for (const [key, list] of sections) {
      if (!list.length) continue;
      box.append(h('div', { class: 'label' }, tr(key) + ' (' + list.length + ')'));
      box.append(h('ul', { class: 'files' }, list.map((f) => {
        const on = viewing && viewing.landing === l.id && viewing.path === f.name;
        const open = () => (f.k === 'D' ? null : openFile(l, f));
        return h('li', { class: 'fileli' + (on ? ' on' : ''), onclick: open, role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') open(); } },
          h('span', { class: 'tagf ' + f.k }, tr('file.' + f.k)),
          h('span', { class: 'fname', title: f.name }, friendly(f.name), folderOf(f.name) ? h('span', { class: 'fold' }, folderOf(f.name)) : null),
          f.k === 'D' ? null : h('span', { class: 'link' }, tr('review.open')));
      })));
    }
    return box;
  }

  async function openFile(l, f) {
    if (viewing && viewing.dirty && !(viewing.landing === l.id && viewing.path === f.name)) { toast(tr('reader.unsaved'), true); return; }
    office.setWide(true); document.body.classList.add('wide');
    viewing = { landing: l.id, path: f.name, state: 'loading', mode: 'read', draft: '', dirty: false, preview: null };
    renderApprovals(); renderReader();
    const r = await office.api('GET', '/api/landings/' + encodeURIComponent(l.id) + '/file?path=' + encodeURIComponent(f.name));
    if (!viewing || viewing.landing !== l.id || viewing.path !== f.name) return;
    if (r.ok) { viewing.state = 'ok'; viewing.data = r.data; viewing.draft = r.data.text || ''; } else viewing.state = 'err';
    renderReader(); loadRevs(l.id);
  }
  function closeReader(force) {
    if (viewing && viewing.dirty && !force) { toast(tr('reader.unsaved'), true); return; }
    viewing = null; if (revTimer) { clearInterval(revTimer); revTimer = null; }
    document.body.classList.remove('wide'); office.setWide(false);
    renderApprovals(); renderReader();
  }

  // a small line diff: what a proposed adjustment changes
  function diffLines(a, b) {
    const x = a.split('\n'), y = b.split('\n');
    if (x.length * y.length > 4e6) return null;
    const n = x.length, m = y.length, w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push(['same', x[i]]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push(['del', x[i++]]); else out.push(['add', y[j++]]);
    }
    while (i < n) out.push(['del', x[i++]]);
    while (j < m) out.push(['add', y[j++]]);
    return out;
  }
  function renderDiff(oldText, newText) {
    const ops = diffLines(oldText, newText), box = h('div', { class: 'diff' });
    if (!ops) { box.append(renderDoc(newText)); return box; }
    if (!ops.some((o) => o[0] !== 'same')) { box.append(h('div', { class: 'dim' }, tr('reader.nochange'))); return box; }
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length > 6) { box.append(h('div', { class: 'dl same' }, run[0]), h('div', { class: 'dl skip' }, tr('reader.same', { n: run.length - 2 })), h('div', { class: 'dl same' }, run[run.length - 1])); } else for (const t of run) box.append(h('div', { class: 'dl same' }, t || ' '));
      run = [];
    };
    for (const [k, t] of ops) { if (k === 'same') run.push(t); else { flush(); box.append(h('div', { class: 'dl ' + k }, h('span', { class: 'sign' }, k === 'add' ? '+' : '−'), t || ' ')); } }
    flush();
    return box;
  }

  async function loadRevs(id) {
    const r = await office.api('GET', '/api/landings/' + encodeURIComponent(id) + '/revise');
    if (r.ok && r.data) { revs[id] = r.data; if (viewing && viewing.landing === id) renderThread(); }
    if (r.ok && r.data && r.data.pending) { if (!revTimer) revTimer = setInterval(() => (viewing ? loadRevs(viewing.landing) : null), 2000); } else if (revTimer) { clearInterval(revTimer); revTimer = null; }
  }
  const authorOf = (l) => memberOf(l && l.specialist) || memberOf('chief');
  function landingOf(id) { return landings.find((x) => x.id === id); }

  async function saveDoc(text, okMsg) {
    const v = viewing; if (!v) return;
    const r = await office.api('POST', '/api/landings/' + encodeURIComponent(v.landing) + '/save', { path: v.path, text });
    if (!viewing || viewing !== v) return;
    if (r.ok) { v.data = r.data; v.draft = r.data.text || ''; v.dirty = false; v.preview = null; v.warned = false; toast(tr(okMsg)); renderReader(); refresh(true); }
    else toast(tr('approvals.failed', { why: (r.data && r.data.error) || r.error || r.status }), true);
  }
  function applyProposal(msg) {
    const orig = viewing && viewing.data ? viewing.data.text || '' : '';
    let text = msg.proposal.text;
    if (orig.endsWith('\n') && !text.endsWith('\n')) text += '\n';
    saveDoc(text, 'reader.applied');
  }
  function renderThread() {
    const box = $('rd-thread'); if (!box || !viewing) return;
    clear(box);
    const l = landingOf(viewing.landing), who = authorOf(l), view = revs[viewing.landing] || { messages: [], pending: false };
    const mine = view.messages.filter((m) => m.path === viewing.path || (m.role === 'assistant' && view.messages.some((u) => u.id === m.reply_to && u.path === viewing.path)));
    for (const m of mine) {
      if (m.role === 'user') { box.append(h('div', { class: 'bubble me' }, m.text)); continue; }
      const b = h('div', { class: 'bubble them' + (m.ok === false ? ' bad' : '') }, m.text);
      if (m.proposal) {
        const applied = viewing.data && viewing.data.text === m.proposal.text;
        b.append(h('div', { class: 'actions', style: 'margin-top:8px' },
          h('button', { class: 'btn ghost', onclick: () => { viewing.preview = m; viewing.mode = 'read'; renderReader(); } }, tr('reader.preview')),
          applied ? h('span', { class: 'chip working' }, tr('reader.applied')) : h('button', { class: 'btn ok', onclick: () => applyProposal(m) }, tr('reader.apply'))));
      }
      box.append(b);
    }
    if (view.pending) box.append(h('div', { class: 'bubble them typing' }, h('span'), h('span'), h('span')), h('div', { class: 'dim small' }, tr('reader.asking', { name: who ? who.name : '' })));
    box.scrollTop = box.scrollHeight;
  }
  const FORMATS = ['docx', 'pdf', 'html', 'rtf', 'txt'];
  function exportMenu(v) {
    const sel = h('select', { class: 'exp', 'aria-label': tr('export.btn'), disabled: v.state !== 'ok' || (v.data && v.data.binary), onchange: async () => {
      const format = sel.value; sel.value = '';
      const text = v.mode === 'edit' && v.draft != null ? v.draft : ((v.preview && v.preview.text) || (v.data && v.data.text) || '');
      const r = await office.exportDoc({ title: friendly(v.path), text, format });
      if (r && r.ok) toast(tr('export.saved', { path: r.path })); else if (r && !r.canceled) toast(tr('export.failed', { why: (r && r.error) || '' }), true);
    } }, h('option', { value: '' }, tr('export.btn')), FORMATS.map((f) => h('option', { value: f }, tr('export.fmt.' + f))));
    sel.value = '';
    return sel;
  }
  function renderReader() {
    const r = $('reader'); if (!r) return;
    clear(r);
    if (!viewing) return;
    const v = viewing, l = landingOf(v.landing), who = authorOf(l);
    r.append(h('div', { class: 'rd-head' },
      h('div', { class: 'rd-title' }, h('b', {}, friendly(v.path)), folderOf(v.path) ? h('span', { class: 'fold' }, folderOf(v.path)) : null, v.dirty ? h('span', { class: 'chip idle' }, tr('reader.unsavedtag')) : null),
      exportMenu(v),
      h('div', { class: 'seg rd-seg' }, ['read', 'edit'].map((m) => h('button', { class: v.mode === m && !v.preview ? 'on' : '', disabled: v.state !== 'ok' || (v.data && v.data.binary), onclick: () => { if (v.preview && m === 'edit') { toast(tr('reader.dismissfirst'), true); return; } v.mode = m; v.preview = null; renderReader(); } }, tr('reader.' + m)))),
      h('button', { class: 'rd-x', 'aria-label': tr('review.close'), onclick: () => closeReader(false) }, '×')));
    const body = h('div', { class: 'rd-body' });
    if (v.state === 'loading') body.append(h('div', { class: 'dim' }, tr('review.loading')));
    else if (v.state === 'err') body.append(h('div', { class: 'dim' }, tr('review.error')));
    else if (v.data && v.data.binary) body.append(h('div', { class: 'dim' }, tr('review.binary')));
    else if (v.preview) {
      body.append(h('div', { class: 'banner pace' }, h('b', {}, tr('reader.proposal')), h('div', {}, v.preview.text)),
        renderDiff(v.data.text || '', v.preview.proposal.text),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { v.preview = null; renderReader(); } }, tr('reader.dismiss')), h('button', { class: 'btn ok', onclick: () => applyProposal(v.preview) }, tr('reader.apply'))));
    } else if (v.mode === 'edit') {
      const ta = h('textarea', { class: 'editor', spellcheck: 'true', lang: 'pt-BR', 'aria-label': tr('reader.editing') });
      ta.value = v.draft;
      ta.addEventListener('input', () => { v.draft = ta.value; const dirty = ta.value !== (v.data.text || ''); if (dirty !== v.dirty) { v.dirty = dirty; const t = r.querySelector('.rd-title'); if (t) { const old = t.querySelector('.chip'); if (old) old.remove(); if (dirty) t.append(h('span', { class: 'chip idle' }, tr('reader.unsavedtag'))); } sv.disabled = !dirty; } });
      ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (v.dirty) saveDoc(v.draft, 'reader.saved'); } });
      const sv = h('button', { class: 'btn ok', disabled: !v.dirty, onclick: () => saveDoc(v.draft, 'reader.saved') }, tr('reader.save'));
      body.append(ta, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', disabled: !v.dirty, onclick: () => { v.draft = v.data.text || ''; v.dirty = false; renderReader(); } }, tr('reader.discard')), sv));
      setTimeout(() => ta.focus(), 30);
    } else {
      body.append(h('div', { class: 'paper' }, renderDoc(v.data.text || '')));
      if (v.data.truncated) body.append(h('div', { class: 'dim small' }, tr('review.truncated')));
    }
    r.append(body);
    const ask = h('textarea', { class: 'chatin', rows: '2', id: 'rd-ask', placeholder: tr('reader.ask.ph') });
    const send = h('button', { class: 'btn acc', style: 'flex:none;padding:10px 16px', onclick: async () => {
      const text = ask.value.trim(); if (!text) return;
      if (v.dirty) { toast(tr('reader.unsaved'), true); return; }
      send.disabled = true;
      const res = await office.api('POST', '/api/landings/' + encodeURIComponent(v.landing) + '/revise', { path: v.path, instruction: text });
      send.disabled = false;
      if (res.ok) { ask.value = ''; revs[v.landing] = res.data; renderThread(); loadRevs(v.landing); } else toast((res.data && res.data.error) || String(res.status), true);
    } }, tr('reader.ask.send'));
    ask.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });
    r.append(h('div', { class: 'rd-foot' }, h('div', { class: 'label' }, tr('reader.ask', { name: who ? who.name : '' })), h('div', { class: 'thread', id: 'rd-thread' }), h('div', { class: 'chatbar' }, ask, send)));
    renderThread();
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
  // The first thing a new person sees: what this program is and is not, and whose responsibility things are. Shown once.
  function showLegal(then) {
    const ok = async () => { cfg.legalAccepted = true; await office.setConfig({ legalAccepted: true }); closeModal(); if (then) then(); };
    modal(h('div', { class: 'sheet legal' }, h('h3', {}, tr('legal.title')),
      h('ul', { class: 'legal-list' }, [1, 2, 3, 4].map((n) => h('li', {}, tr('legal.p' + n)))),
      h('div', { class: 'actions' }, h('button', { class: 'btn acc', onclick: ok }, tr('legal.ok')))));
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

  // ------------------------------------------------------------------ progress: what is going on inside the jobs
  const elapsed = (from, to) => {
    if (!from) return '';
    const s = Math.max(0, Math.round((to || (farm && farm.now) || Date.now() / 1000) - from));
    return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + (s % 60 ? (s % 60) + ' s' : '') : Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
  };
  const sinceWhen = (at) => ago(at, prog && prog.now);
  function nodeName(n) { return n.name ? n.name + (n.title_role ? ' · ' + n.title_role : '') : tr('prog.someone'); }
  function stepText(st, nodes) {
    const n = (nodes || []).find((x) => x.id === st.task), who = n && n.name ? n.name + ': ' : '';
    const arg = String(st.arg || '').trim();
    const cap = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);
    let text;
    switch (st.cat) {
      case 'read': text = arg ? tr('step.read', { arg: cap(arg, 60) }) : tr('step.read.none'); break;
      case 'write': text = arg ? tr('step.write', { arg: cap(arg, 60) }) : tr('step.write.none'); break;
      case 'edit': text = tr('step.edit', { arg: cap(arg, 60) }); break;
      case 'search': text = tr('step.search', { arg: cap(arg, 50) }); break;
      case 'web': text = tr('step.web', { arg: cap(arg, 50) }); break;
      case 'call': { const m = memberOf(st.who); text = tr('step.call', { who: m ? m.name : (st.who || tr('prog.someone')), arg: cap(arg, 70) }); break; }
      case 'check': text = tr('step.check'); break;
      case 'save': text = tr('step.save'); break;
      case 'merge': text = tr('step.merge'); break;
      case 'compute': text = tr('step.compute'); break;
      case 'think': text = tr('step.think'); break;
      case 'say': text = tr('step.say', { arg: cap(arg, 160) }); break;
      case 'run': text = tr('step.run'); break;
      default: text = tr('step.tool', { arg: cap(arg, 40) });
    }
    return who + text;
  }
  const STEP_ICON = { read: '📖', write: '✍️', edit: '✏️', search: '🔎', web: '🌐', call: '📣', check: '👀', save: '💾', merge: '🧩', compute: '🧮', think: '💭', say: '💬', run: '⚙️', tool: '🔧' };
  const STATUS_CHIP = { running: 'working', waiting: 'working', queued: 'idle', done: 'offline', failed: 'alert' };

  function paceBanner(pace, jobs) {
    if (!pace || !pace.limited) return null;
    const waiting = jobs.some((j) => j.nodes.some((n) => n.status === 'queued'));
    if (!waiting && pace.code !== 'stopped') return null;
    const pct = (x) => (x == null ? '?' : Math.round(x * 100));
    const key = pace.code === 'week' ? 'pace.week' : pace.code === 'five' ? 'pace.five' : pace.code === 'stopped' ? 'pace.stopped' : 'pace.other';
    return h('div', { class: 'banner pace' }, h('b', {}, tr('pace.title')), h('div', {}, tr(key, { workers: pace.workers, max: pace.max, used: pct(pace.code === 'five' ? pace.five_used : pace.week_used), allowed: pct(pace.code === 'five' ? pace.five_allowed : pace.week_allowed) })));
  }
  function speedPicker(pace) {
    if (!pace) return null;
    const cur = pace.speed || 'balanced';
    const seg = h('div', { class: 'seg' }, ['balanced', 'fast', 'max'].map((m) => h('button', { class: cur === m ? 'on' : '', onclick: async () => {
      const r = await office.api('POST', '/api/speed', { mode: m });
      if (r.ok) { toast(tr('speed.saved')); await refresh(true); } else toast((r.data && r.data.error) || String(r.status), true);
    } }, tr('speed.' + m))));
    return h('div', { class: 'card' }, h('b', {}, tr('speed.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('speed.text')), seg, h('div', { class: 'note' }, tr('speed.' + cur + '.hint')));
  }

  function jobCard(j, recent) {
    const open = progOpen === j.id;
    const nodes = j.nodes || [], done = nodes.filter((n) => n.status === 'done').length;
    const active = nodes.filter((n) => n.status === 'running' || n.status === 'waiting').length;
    const queued = nodes.filter((n) => n.status === 'queued').length;
    const status = j.status === 'queued' ? 'queued' : j.status === 'done' || j.landing ? 'done' : j.status === 'failed' ? 'failed' : 'running';
    const head = h('div', { class: 'jobhead', role: 'button', tabindex: '0', onclick: () => { progOpen = open ? '' : j.id; if (!open) loadDetail(j.id); renderProgress(); } },
      h('div', { class: 'jt' }, h('b', {}, j.title || j.id), h('div', { class: 'dim small' }, (j.status === 'done' ? tr('prog.finished', { t: elapsed(j.started || j.created, j.finished) }) : tr('prog.running', { t: elapsed(j.started || j.created) })) +
        (nodes.length > 1 ? ' · ' + tr('prog.team', { done, total: nodes.length - 1 > 0 ? nodes.length - 1 : 0 }) : ''))),
      h('span', { class: 'chip ' + (STATUS_CHIP[status] || 'idle') }, tr('prog.status.' + status)));
    const card = h('div', { class: 'card' + (recent ? ' recent' : '') }, head);
    // who is doing what
    card.append(h('ul', { class: 'tree' }, nodes.map((n) => h('li', { style: 'margin-left:' + n.depth * 16 + 'px' },
      h('span', { class: 'sdot ' + n.status }, ''), h('span', { class: 'tn' }, nodeName(n)),
      h('span', { class: 'dim small tt' }, n.status === 'queued' ? tr('prog.node.queued') : n.status === 'done' ? tr('prog.node.done', { t: elapsed(n.started, n.finished) }) : tr('prog.node.running', { t: elapsed(n.started) }))))));
    // the newest steps
    const full = open && progDetail && progDetail.job && progDetail.job.id === j.id ? progDetail.job.steps : null;
    const list = (full || j.steps || []).slice().reverse();
    const shown = open ? list : list.slice(0, 3);
    if (shown.length) card.append(h('ul', { class: 'steps2' }, shown.map((st) => h('li', {}, h('span', { class: 'si' }, STEP_ICON[st.cat] || '•'),
      h('span', { class: 'sx' }, stepText(st, nodes), open && showRaw && st.text ? h('div', { class: 'raw' }, st.text) : null), h('time', {}, sinceWhen(st.at))))));
    else card.append(h('div', { class: 'note' }, tr('prog.nosteps')));
    if (open) card.append(h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { showRaw = !showRaw; renderProgress(); } }, tr(showRaw ? 'prog.hideraw' : 'prog.showraw'))));
    else if ((j.steps || []).length > 3) card.append(h('button', { class: 'link', onclick: () => { progOpen = j.id; loadDetail(j.id); renderProgress(); } }, tr('prog.more', { n: (j.steps || []).length - 3 })));
    return card;
  }
  async function loadDetail(id) {
    const r = await office.api('GET', '/api/progress/' + encodeURIComponent(id) + '?limit=120');
    if (r.ok && r.data) { progDetail = r.data; if (tab === 'progress') renderProgress(); }
  }
  function renderProgress() {
    const s = $('s-progress'), main = document.querySelector('main'), y = main ? main.scrollTop : 0;
    clear(s);
    const b = banner(); if (b) s.append(b);
    s.append(h('h2', {}, tr('prog.title')));
    if (!prog) { s.append(h('div', { class: 'note' }, tr('review.loading'))); return; }
    const running = prog.jobs.reduce((n, j) => n + j.nodes.filter((x) => x.status === 'running').length, 0);
    if (running > 1) s.append(h('div', { class: 'chipw', style: 'margin-bottom:10px' }, h('i'), tr('prog.parallel', { n: running })));
    const pb = paceBanner(prog.pace, prog.jobs); if (pb) s.append(pb);
    if (!prog.jobs.length) {
      const art = sprite('clodfarm', 'sofa', 'art'); art.className = 'art';
      s.append(h('div', { class: 'empty' }, art, h('b', {}, tr('prog.empty.title')), tr('prog.empty.text')));
    }
    for (const j of prog.jobs) s.append(jobCard(j, false));
    if (prog.recent && prog.recent.length) { s.append(h('h2', {}, tr('prog.recent'))); for (const j of prog.recent) s.append(jobCard(j, true)); }
    const sp = speedPicker(prog.pace); if (sp) s.append(sp);
    if (main) main.scrollTop = y;
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
        files.length ? [h('div', { class: 'label' }, tr('approvals.changes')), fileList(l, files)] : null,
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
  async function readConvertible(l) {
    const out = [];
    for (const line of (l.files || []).slice(0, 30)) {
      if (line.startsWith('D')) continue;
      const p = line.split('\t').pop();
      if (!/\.(md|markdown|txt)$/i.test(p)) continue;
      const r = await office.api('GET', '/api/landings/' + encodeURIComponent(l.id) + '/file?path=' + encodeURIComponent(p));
      if (r.ok && r.data && !r.data.binary && !r.data.truncated && typeof r.data.text === 'string') out.push({ path: p, text: r.data.text });
    }
    return out;
  }
  async function makeExtraFormats(id, files) {
    const ex = await office.api('GET', '/api/landings/' + encodeURIComponent(id) + '/exported');
    if (!ex.ok || !ex.data || !ex.data.folder) return;
    const done = new Set(ex.data.files || []);
    const res = await office.exportApproved({ folder: ex.data.folder, files: files.filter((f) => done.has(f.path)) });
    if (res && res.ok && res.made) toast(tr('export.made', { n: res.made }));
    else if (res && !res.ok) toast(tr('export.failed', { why: res.error || '' }), true);
  }
  async function decide(l, kind) {
    if (viewing && viewing.landing === l.id && viewing.dirty) { toast(tr('reader.approve.blocked'), true); return; }
    busy.add(l.id); renderApprovals();
    // the text of the documents must be read BEFORE the approval: afterwards the work is no longer waiting
    const wanted = kind === 'approve' && (cfg.exportFormats || []).length ? await readConvertible(l) : [];
    const r = await office.api('POST', '/api/landings/' + encodeURIComponent(l.id) + '/' + kind, {});
    busy.delete(l.id); confirmDeny.delete(l.id);
    if (r.ok) {
      toast(tr(kind === 'approve' ? 'approvals.saved' : 'approvals.denied'));
      if (wanted.length) makeExtraFormats(l.id, wanted);
      if (viewing && viewing.landing === l.id) closeReader(true);
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

  // ------------------------------------------------------------------ backup, version, legal
  function backupCard() {
    const say = (r, okKey, vars) => { if (r && r.ok) toast(tr(okKey, vars || {})); else if (r && !r.canceled) toast(tr('backup.failed', { why: (r && r.error) || '' }), true); };
    return h('div', { class: 'card' }, h('b', {}, tr('backup.title')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('backup.text')),
      h('div', { class: 'actions', style: 'margin-top:0' },
        h('button', { class: 'btn ghost', onclick: async () => { const r = await office.saveBackup(); say(r, 'backup.saved', { n: r && r.people }); } }, tr('backup.save')),
        h('button', { class: 'btn ghost', onclick: async () => { const r = await office.restoreBackup(); say(r, 'backup.restored', { n: r && r.restored }); if (r && r.ok) refresh(true); } }, tr('backup.restore'))));
  }
  function versionCard() {
    const line = h('div', { class: 'note' }, cfg.version ? tr('update.version', { v: cfg.version }) : '');
    const auto = h('input', { type: 'checkbox', onchange: async (e) => { cfg = { ...cfg, ...(await office.setConfig({ updateCheck: e.target.checked })) }; } }); auto.checked = cfg.updateCheck !== false;
    return h('div', { class: 'card' }, h('b', {}, tr('update.card')), line,
      h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: async () => {
        const r = await office.checkUpdate();
        if (!r || !r.ok) toast(tr('update.checkfail'), true); else if (r.update) { cfg.update = r.update; render(); } else toast(tr('update.uptodate'));
      } }, tr('update.check'))),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', { class: 'switch' }, auto, tr('update.auto'))), h('div', { class: 'note' }, tr('update.privacy')));
  }
  function sizeCard() {
    const cur = [2, 3, 4, 5].includes(cfg.petScale) ? cfg.petScale : 3;
    const seg = h('div', { class: 'seg' }, [[2, 'size.small'], [3, 'size.medium'], [4, 'size.large'], [5, 'size.huge']].map(([v, k]) => h('button', { class: cur === v ? 'on' : '', onclick: async () => { cfg = { ...cfg, ...(await office.setConfig({ petScale: v })) }; render(); } }, tr(k))));
    return h('div', { class: 'card' }, h('b', {}, tr('settings.size')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('size.hint')), seg);
  }
  function charactersCard() {
    const seg = h('div', { class: 'seg' }, ['people', 'animals'].map((v) => h('button', { class: (cfg.characters || 'people') === v ? 'on' : '', onclick: async () => { cfg = { ...cfg, ...(await office.setConfig({ characters: v })) }; S.setMode(cfg.characters); render(); } }, tr('characters.' + v))));
    return h('div', { class: 'card' }, h('b', {}, tr('settings.characters')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('characters.hint')), seg);
  }
  function legalCard() {
    return h('details', { class: 'how card' }, h('summary', {}, tr('legal.title')), h('ul', { class: 'legal-list' }, [1, 2, 3, 4].map((n) => h('li', {}, tr('legal.p' + n)))));
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
      speedPicker(prog && prog.pace),
      charactersCard(),
      sizeCard(),
      connectorsCard(),
      h('div', { class: 'card' }, h('b', {}, tr('settings.exports')), h('div', { class: 'note', style: 'margin:4px 0 10px' }, tr('settings.exportshint')),
        h('div', { class: 'note', style: 'margin:0 0 6px' }, h('b', {}, tr('export.set.title')), ' ', tr('export.set.text')),
        h('div', { class: 'fmts' }, FORMATS.map((f) => { const b = h('input', { type: 'checkbox', onchange: async () => { const cur = new Set(cfg.exportFormats || []); if (b.checked) cur.add(f); else cur.delete(f); cfg = { ...cfg, ...(await office.setConfig({ exportFormats: [...cur] })) }; } }); b.checked = (cfg.exportFormats || []).includes(f); return h('label', { class: 'switch' }, b, tr('export.fmt.' + f)); })),
        h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: () => office.openExports() }, tr('settings.openexports')))),
      backupCard(), versionCard(), legalCard(),
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
    renderChrome(); renderChatTab(); renderProgress(); renderTeam(); renderApprovals(); renderSettings(); renderReader();
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
    document.documentElement.lang = cfg.lang; S.setMode(cfg.characters);
    office.on('config', (c) => { cfg = { ...cfg, ...c }; document.documentElement.lang = cfg.lang; S.setMode(cfg.characters); render(); });
    office.on('focus', (o) => { route(o); refresh(true); render(); });
    if (q.get('kind') === 'member' || tab === 'chat') route({ tab, id: focusId, kind: q.get('kind') });
    await refresh(true);
    render();
    if (!cfg.legalAccepted) showLegal(() => { if (cfg.onboarded === false) showTour(0); });
    else if (cfg.onboarded === false) showTour(0);
    setInterval(() => refresh(false), 3000);
  }
  init();
})();
