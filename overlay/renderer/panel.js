// Panel: details of one character, human approvals, new jobs, settings. All text goes in with textContent.
(function () {
  const q = new URLSearchParams(location.search);
  const mock = q.has('mock');
  let office = window.office, dicts = null, cfg = { lang: q.get('lang') || 'pt-BR' };
  let tab = q.get('tab') || 'approvals', focusId = q.get('id') || '', landings = [], farm = null, authErr = false, offline = false;
  const $ = (id) => document.getElementById(id);
  const tr = (k, v) => I18N.make(dicts, cfg.lang)(k, v);

  if (!office && mock) {
    const l = [{ id: 'l1', title: 'Petição inicial (rascunho fictício)', commits: 2, files: ['A\tpeticao-inicial.md', 'M\tindice.md'], summary: 'Minuta pronta; conferir [CONFERIR] nos itens 2 e 5.' }];
    office = {
      api: async (m, p) => ({ ok: true, status: 200, data: p.startsWith('/api/landings') ? l : p.startsWith('/api/state') ? { agents: [{ id: 'clodfarm', name: 'Chefe', running: 1 }], subagents: [{ id: 't1', title: 'Organizar documentos (fictício)', status: 'running' }] } : p.startsWith('/api/tasks/') ? { id: 't1', title: 'Organizar documentos (fictício)', status: 'running', summary: '' } : {} }),
      getConfig: async () => ({ lang: cfg.lang, url: 'http://localhost:8080', sound: false, hasToken: true }),
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json')).json(), en: await (await fetch('../i18n/en.json')).json() }),
      setConfig: async (p) => ({ ...cfg, ...p }), autoToken: async () => true, on() {}, openFarm() {}, quit() {},
    };
  }

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const kid of kids) e.append(kid && kid.nodeType ? kid : document.createTextNode(kid == null ? '' : String(kid)));
    return e;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  async function refresh() {
    const [ld, st] = await Promise.all([office.api('GET', '/api/landings'), office.api('GET', '/api/state')]);
    offline = !st.ok && st.status === 0 && !ld.ok;
    authErr = ld.status === 401 || ld.status === 403;
    landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    farm = st.ok ? st.data : null;
    if (tab === 'agent' || tab === 'approvals') render(); else renderTabs(); // don't wipe what is being typed
  }

  function renderTabs() {
    const nav = $('tabs'); clear(nav);
    for (const [id, key] of [['agent', 'panel.agent'], ['approvals', 'panel.approvals'], ['job', 'panel.newjob'], ['settings', 'panel.settings']]) {
      const b = el('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; render(); } }, tr(key));
      if (id === 'approvals' && landings.length) b.append(el('span', { class: 'badge' }, landings.length));
      nav.append(b);
    }
    for (const id of ['agent', 'approvals', 'job', 'settings']) $('s-' + id).className = id === tab ? 'on' : '';
  }

  function banner(parent) {
    if (offline) parent.append(el('div', { class: 'hint' }, tr('error.offline', { url: cfg.url || '' })));
    else if (authErr) parent.append(el('div', { class: 'hint' }, tr('error.auth')));
  }

  function renderAgent() {
    const s = $('s-agent'); clear(s); banner(s);
    const sub = ((farm && farm.subagents) || []).find((x) => x.id === focusId);
    const ag = ((farm && farm.agents) || []).find((x) => x.id === focusId);
    const land = landings.find((x) => x.id === focusId);
    const card = el('div', { class: 'card' });
    if (sub || land) {
      const t = sub || land;
      card.append(el('h4', {}, t.title || t.id), el('div', { class: 'dim small' }, tr('panel.task') + ' ' + t.id),
        el('div', {}, tr('panel.status') + ': ' + (land ? tr('state.alert') : tr('state.working'))));
    } else if (ag) {
      card.append(el('h4', {}, ag.name || ag.id), el('div', { class: 'dim small' }, tr('pet.chief')),
        el('div', {}, tr('panel.status') + ': ' + (Number(ag.running) > 0 ? tr('state.working') : tr('state.idle'))));
    } else card.append(el('div', { class: 'dim' }, tr('panel.nothing')));
    s.append(card);
    if (sub) office.api('GET', '/api/tasks/' + encodeURIComponent(sub.id)).then((r) => {
      if (r.ok && r.data) card.append(el('h4', { style: 'margin-top:8px' }, tr('panel.lastresult')), el('pre', { class: 'small dim' }, r.data.summary || r.data.result || tr('panel.noresult')));
    });
  }

  function renderApprovals() {
    const s = $('s-approvals'); clear(s); banner(s);
    s.append(el('div', { class: 'hint' }, tr('approval.hint')));
    if (!landings.length) s.append(el('div', { class: 'dim' }, tr('panel.nothing')));
    const msg = el('div', { class: 'msg' });
    for (const l of landings) {
      const ok = el('button', { class: 'btn ok' }, tr('approval.approve')), no = el('button', { class: 'btn bad' }, tr('approval.deny'));
      const act = (kind) => async () => {
        ok.disabled = no.disabled = true;
        const r = await office.api('POST', '/api/landings/' + encodeURIComponent(l.id) + '/' + kind, {});
        if (r.ok) { msg.className = 'msg good'; msg.textContent = tr(kind === 'approve' ? 'approval.done' : 'approval.denied'); await refresh(); }
        else { msg.className = 'msg err'; msg.textContent = tr('approval.failed', { why: (r.data && r.data.error) || r.error || r.status }); ok.disabled = no.disabled = false; }
      };
      ok.addEventListener('click', act('approve')); no.addEventListener('click', act('deny'));
      s.append(el('div', { class: 'card' + (l.id === focusId ? ' focus' : '') }, el('h4', {}, l.title || l.id),
        el('div', { class: 'dim small' }, tr('panel.commits', { n: l.commits || 0 })),
        l.summary ? el('pre', { class: 'small dim' }, l.summary) : '',
        el('div', { class: 'small dim', style: 'margin-top:6px' }, tr('panel.files')),
        el('div', { class: 'files' }, (l.files || []).join('\n') || '-'), el('div', { class: 'row' }, ok, no)));
    }
    s.append(msg);
  }

  function renderJob() {
    const s = $('s-job'); clear(s); banner(s);
    const ta = el('textarea', { placeholder: tr('job.placeholder') }), msg = el('div', { class: 'msg' });
    const go = el('button', { class: 'btn acc', onclick: async () => {
      const title = ta.value.trim(); if (!title) return;
      go.disabled = true;
      const r = await office.api('POST', '/api/tasks/new', { title: title.split('\n')[0].slice(0, 120), prompt: title });
      go.disabled = false;
      if (r.ok) { ta.value = ''; msg.className = 'msg good'; msg.textContent = tr('job.sent'); }
      else { msg.className = 'msg err'; msg.textContent = (r.data && r.data.error) || r.error || String(r.status); }
    } }, tr('job.send'));
    s.append(el('label', {}, tr('job.title')), ta, el('div', { class: 'row' }, go), msg);
  }

  function renderSettings() {
    const s = $('s-settings'); clear(s);
    const lang = el('select', {}, el('option', { value: 'pt-BR' }, 'Português (Brasil)'), el('option', { value: 'en' }, 'English'));
    lang.value = cfg.lang;
    const url = el('input', { value: cfg.url || '' }), msg = el('div', { class: 'msg' });
    const sound = el('input', { type: 'checkbox', style: 'width:auto' }); sound.checked = !!cfg.sound;
    const save = el('button', { class: 'btn acc', onclick: async () => {
      cfg = { ...cfg, ...(await office.setConfig({ lang: lang.value, url: url.value.trim(), sound: sound.checked })) };
      msg.className = 'msg good'; msg.textContent = tr('settings.saved'); render();
    } }, tr('settings.save'));
    const tok = el('button', { class: 'btn ghost', onclick: async () => {
      const ok = await office.autoToken(); msg.className = 'msg ' + (ok ? 'good' : 'err'); msg.textContent = tr(ok ? 'settings.tokenok' : 'settings.tokenfail'); if (ok) refresh();
    } }, tr('settings.autotoken'));
    s.append(el('label', {}, tr('settings.language')), lang, el('label', {}, tr('settings.url')), url,
      el('label', {}, el('span', {}, ''), sound, ' ' + tr('settings.sound')),
      el('div', { class: 'row' }, save), el('div', { class: 'row' }, tok),
      el('div', { class: 'row' }, el('button', { class: 'btn ghost', onclick: () => office.openFarm() }, tr('settings.openfarm'))),
      el('div', { class: 'row' }, el('button', { class: 'btn bad', onclick: () => office.quit() }, tr('settings.quit'))), msg);
  }

  function render() {
    $('title').textContent = tr('app.name');
    renderTabs(); renderAgent(); renderApprovals(); renderJob(); renderSettings();
  }

  $('close').addEventListener('click', () => window.close());
  async function init() {
    cfg = { ...cfg, ...(await office.getConfig()) };
    dicts = await office.dicts();
    office.on('config', (c) => { cfg = { ...cfg, ...c }; render(); });
    office.on('focus', (o) => { tab = o.tab || tab; focusId = o.id || ''; refresh(); });
    await refresh();
    setInterval(refresh, 4000);
  }
  init();
})();
