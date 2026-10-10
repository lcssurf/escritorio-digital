// Panel: team, approvals, new job, settings. Plain language, nothing technical. All farm text goes in with textContent.
(function () {
  const S = window.Sprites, O = window.Office;
  const q = new URLSearchParams(location.search);
  const mock = q.has('mock');
  let office = window.office, dicts = null, cfg = { lang: q.get('lang') || 'pt-BR', sound: true, url: 'http://localhost:8080', hasToken: true };
  let tab = q.get('tab') || '', focusId = q.get('id') || '';
  let landings = [], farm = null, offline = false, authErr = false, lastSig = '';
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
    return {
      api: async (m, p) => ({ ok: true, status: 200, data: p.startsWith('/api/landings') ? L : p.startsWith('/api/state') ? st : p.startsWith('/api/tasks/') ? { summary: 'Conferi 4 prazos. Um vence amanhã.' } : {} }),
      getConfig: async () => cfg,
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json')).json(), en: await (await fetch('../i18n/en.json')).json() }),
      setConfig: async (p) => ({ ...cfg, ...p }), autoToken: async () => true, on() {}, openFarm() {}, quit() {}, togglePets() {}, broadcast() {},
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
    new: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
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
    const [ld, st] = await Promise.all([office.api('GET', '/api/landings'), office.api('GET', '/api/state')]);
    offline = !st.ok && st.status === 0;
    authErr = ld.status === 401 || ld.status === 403;
    landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    farm = st.ok ? st.data : null;
    const sig = JSON.stringify([landings.map((l) => l.id), farm && farm.agents, farm && farm.subagents, farm && (farm.events || []).slice(0, 3), offline, authErr, [...confirmDeny], [...busy]]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (!tab) tab = landings.length ? 'approvals' : 'team';
    if (tab === 'new' || tab === 'settings') { renderChrome(); return; } // never wipe what is being typed
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
    for (const [id, key] of [['team', 'nav.team'], ['approvals', 'nav.approvals'], ['new', 'nav.new'], ['settings', 'nav.settings']]) {
      const b = h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; focusId = ''; render(); }, 'aria-label': tr(key) }, icon(id), tr(key));
      if (id === 'approvals' && landings.length) b.append(h('span', { class: 'badge' }, landings.length));
      nav.append(b);
    }
    for (const id of ['team', 'approvals', 'new', 'settings']) $('s-' + id).className = id === tab ? 'on' : '';
  }
  function banner() {
    if (offline) return h('div', { class: 'banner' }, tr('error.offline', { url: cfg.url || '' }));
    if (authErr) return h('div', { class: 'banner' }, tr('error.auth'));
    return null;
  }
  function toast(text, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, text);
    document.body.append(t); setTimeout(() => t.remove(), 2600);
  }

  // ------------------------------------------------------------------ team
  function agentRows() {
    const rows = [];
    const waiting = new Set(landings.map((l) => l.id));
    for (const l of landings) rows.push({ id: l.id, seed: l.id, persona: O.persona(l.id), status: 'alert', task: l.title, taskId: l.id });
    for (const s of ((farm && farm.subagents) || [])) if (s.status === 'running' && !waiting.has(s.id)) rows.push({ id: s.id, seed: s.id, persona: O.persona(s.id), status: 'working', task: s.title, taskId: s.id });
    for (const a of ((farm && farm.agents) || [])) if (a.loggedIn !== false) {
      const busy = Number(a.running || 0) > 0;
      rows.push({ id: a.id, seed: a.id, persona: { name: a.name || a.id, role: 'chief' }, status: busy ? 'working' : 'idle', task: '', chief: true });
    }
    return rows;
  }
  function renderTeam() {
    const s = $('s-team'); clear(s);
    const b = banner(); if (b) s.append(b);
    s.append(h('h2', {}, tr('team.title')));
    const rows = agentRows();
    if (!rows.length) s.append(h('div', { class: 'empty' }, tr('team.empty')));
    for (const r of rows) {
      const role = r.persona.role === 'chief' ? tr('pet.chief') : tr('role.' + r.persona.role);
      const card = h('div', { class: 'card' });
      const open = focusId === r.id;
      const head = h('div', { class: 'agent', role: 'button', tabindex: '0', onclick: () => { focusId = open ? '' : r.id; renderTeam(); if (!open && r.taskId) loadDetail(r, card); } },
        h('div', { class: 'avatar' }, sprite(r.seed, r.status === 'working' ? 'idle' : 'idle')),
        h('div', { class: 'who' }, h('div', { class: 'name' }, r.persona.name, ' ', h('span', { class: 'role' }, r.persona.role === 'chief' ? '' : '· ' + role)),
          h('div', { class: 'task' }, r.task || tr(r.status === 'idle' ? 'state.idle' : 'state.working'))),
        h('span', { class: 'chip ' + r.status }, tr('state.' + r.status)));
      card.append(head);
      if (open) { card.append(h('div', { class: 'detail', id: 'd-' + r.id }, r.taskId ? '…' : tr('pet.chief'))); if (r.taskId) loadDetail(r, card); }
      s.append(card);
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
  async function loadDetail(r, card) {
    const r2 = await office.api('GET', '/api/tasks/' + encodeURIComponent(r.taskId));
    const el = card.querySelector('.detail'); if (!el) return;
    const text = r2.ok && r2.data ? cleanSummary(r2.data.summary || r2.data.result) : '';
    el.textContent = text || tr('team.noresult');
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
      const p = O.persona(l.id), role = tr('role.' + p.role);
      const files = (l.files || []).map((f) => { const [k, ...rest] = f.split('\t'); return { k: /^[AMD]/.test(k) ? k[0] : 'M', name: rest.join('\t') || f }; });
      const busyNow = busy.has(l.id);
      const card = h('div', { class: 'card review' },
        h('h3', {}, l.title || l.id),
        h('div', { class: 'by' }, tr('approvals.by', { name: p.name, role })),
        h('div', { class: 'label' }, tr('approvals.what')),
        h('div', { class: 'said' }, cleanSummary(l.summary) || tr('team.noresult')),
        files.length ? [h('div', { class: 'label' }, tr('approvals.changes')),
          h('ul', { class: 'files' }, files.map((f) => h('li', {}, h('span', { class: 'tagf ' + f.k }, tr('file.' + f.k)), h('span', {}, f.name))))] : null,
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
      toast(tr(kind === 'approve' ? 'approvals.done' : 'approvals.denied'));
      if (kind === 'approve' && office.broadcast) office.broadcast({ type: 'approved', id: l.id });
    } else toast(tr('approvals.failed', { why: (r.data && r.data.error) || r.error || r.status }), true);
    await refresh(true);
  }

  // ------------------------------------------------------------------ new job
  function renderNew() {
    const s = $('s-new'); clear(s);
    const b = banner(); if (b) s.append(b);
    s.append(h('h2', {}, tr('job.title')), h('div', { class: 'sub' }, tr('job.sub')));
    const ta = h('textarea', { placeholder: tr('job.placeholder'), 'aria-label': tr('job.title') });
    const chips = h('div', { class: 'chips' }, ['docs', 'draft', 'deadlines', 'summary'].map((k) =>
      h('button', { onclick: () => { ta.value = tr('job.chip.' + k) + ' - '; ta.focus(); } }, tr('job.chip.' + k))));
    const go = h('button', { class: 'btn acc', onclick: async () => {
      const text = ta.value.trim(); if (!text) { ta.focus(); return; }
      go.disabled = true;
      const r = await office.api('POST', '/api/tasks/new', { title: text.split('\n')[0].slice(0, 120), prompt: text });
      go.disabled = false;
      if (r.ok) { ta.value = ''; toast(tr('job.sent')); refresh(true); } else toast((r.data && r.data.error) || r.error || String(r.status), true);
    } }, tr('job.send'));
    s.append(ta, chips, h('div', { class: 'actions', style: 'margin-top:0' }, go), h('div', { class: 'note' }, tr('job.safety')));
  }

  // ------------------------------------------------------------------ settings
  function renderSettings() {
    const s = $('s-settings'); clear(s);
    const seg = h('div', { class: 'seg' }, [['pt-BR', 'Português'], ['en', 'English']].map(([v, label]) =>
      h('button', { class: cfg.lang === v ? 'on' : '', onclick: async () => { cfg = { ...cfg, ...(await office.setConfig({ lang: v })) }; render(); } }, label)));
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
      h('div', { class: 'field' }, h('label', {}, tr('settings.language')), seg),
      h('div', { class: 'field' }, h('label', { class: 'switch' }, sound, tr('settings.sound'))),
      h('div', { class: 'field' }, h('label', {}, tr('settings.key')), h('div', { class: 'keyrow' }, keyPill, fetchKey)),
      h('div', { class: 'field' }, h('label', {}, tr('settings.url')), url),
      h('div', { class: 'field' }, h('label', {}, tr('settings.height')), heightRow, h('div', { class: 'note' }, tr('settings.heightHint'))),
      h('div', { class: 'stack' },
        h('button', { class: 'btn ghost', onclick: () => office.openFarm() }, tr('settings.openfarm')),
        h('button', { class: 'btn ghost', onclick: () => office.togglePets() }, tr(cfg.hidden ? 'settings.show' : 'settings.hide')),
        h('button', { class: 'btn danger', onclick: () => office.quit() }, tr('settings.exit')),
        h('div', { class: 'note' }, tr('settings.trayhint'))));
  }

  function render() {
    renderChrome(); renderTeam(); renderApprovals(); renderNew(); renderSettings();
  }

  $('close').addEventListener('click', () => window.close());
  async function init() {
    cfg = { ...cfg, ...(await office.getConfig()) };
    dicts = await office.dicts();
    document.documentElement.lang = cfg.lang;
    office.on('config', (c) => { cfg = { ...cfg, ...c }; document.documentElement.lang = cfg.lang; render(); });
    office.on('focus', (o) => { tab = o.tab || tab; focusId = o.id || ''; refresh(true); });
    await refresh(true);
    setInterval(() => refresh(false), 3000);
  }
  init();
})();
