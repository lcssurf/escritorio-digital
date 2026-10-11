// Overlay renderer: characters on the taskbar. Polls the farm through the main process (the key never touches this page).
(function () {
  const S = window.Sprites, O = window.Office;
  const SCALE = 3, PW = S.W * SCALE, SPEED = 28; // px per second when walking
  const stage = document.getElementById('stage');
  const params = new URLSearchParams(location.search);
  const mock = params.has('mock');
  let office = window.office, dicts = null, cfg = { lang: 'pt-BR', sound: true };
  const pets = new Map(); // id -> pet
  let offline = false, through = true, lastAlertIds = new Set(), started = false, crowd = 5;
  const lastActive = new Map();   // member id -> when it last worked or waited for approval
  const LINGER = 15000, SAY_MS = 14000;
  let sinceChat = Date.now() / 1000;   // only answers that arrive from now on
  const sayLater = new Map();          // member id -> answer waiting for that character to appear on the bar

  if (!office && mock) office = mockOffice();

  function mockOffice() {
    const state = { agents: [{ id: 'clodfarm', name: 'Chefe', loggedIn: true, running: 1 }, { id: 'ana', name: 'Ana', loggedIn: true, running: 0 }, { id: 'rui', name: 'Rui', loggedIn: true, running: 0 }],
      subagents: [{ id: 'task-docs', title: 'Organizar documentos do caso Exemplo', status: 'running' }, { id: 'task-draft', title: 'Minuta da inicial (fictícia)', status: 'running' }] };
    const members = [{ id: 'chief', name: 'Marina', title: 'Chefe do escritório', gender: 'f', look: { style: 'bun', suit: '#2f2f3a', glasses: true } },
      { id: 'ana', name: 'Ana', title: 'Documentos', gender: 'f', look: { style: 'long', prop: 1 } }, { id: 'bruno', name: 'Bruno', title: 'Prazos', gender: 'm', look: { style: 'beard', prop: 4 } },
      { id: 'davi', name: 'Davi', title: 'Peças', gender: 'm', look: { style: 'side', prop: 2 } }, { id: 'elisa', name: 'Elisa', title: 'Revisão', gender: 'f', look: { style: 'pony', prop: 3 } }];
    state.subagents = [{ id: 'r1', title: 'Organizar documentos do caso Exemplo', status: 'running', specialist: 'ana' }];
    const landings = [{ id: 'l1', title: 'Petição inicial (rascunho)', commits: 2, at: Date.now() / 1000, specialist: 'davi', files: ['A	peticao.md'] }];
    return {
      api: async (m, p) => ({ ok: true, status: 200, data: p.startsWith('/api/state') ? state : p.startsWith('/api/landings') ? landings : p.startsWith('/api/team') ? members : {} }),
      getConfig: async () => ({ lang: params.get('lang') || 'pt-BR', sound: false }),
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json?v=' + Date.now())).json(), en: await (await fetch('../i18n/en.json?v=' + Date.now())).json() }),
      clickThrough() {}, openPanel(o) { console.log('openPanel', JSON.stringify(o)); }, on() {},
    };
  }

  const tr = (key, vars) => I18N.make(dicts, cfg.lang)(key, vars);

  function ensurePet(spec) {
    let p = pets.get(spec.id);
    if (p) return p;
    const el = document.createElement('div');
    el.className = 'pet pop';
    const cv = document.createElement('canvas');
    cv.width = S.W; cv.height = S.H;
    const tag = document.createElement('div');
    tag.className = 'tag';
    const say = document.createElement('div');
    say.className = 'say';
    el.append(cv, tag, say);
    stage.append(el);
    const taken = [...pets.values()].map((q) => q.x);
    p = { id: spec.id, el, cv, ctx: cv.getContext('2d'), tag, say, sayUntil: 0, look: S.look(spec.id, spec.member), lookKey: JSON.stringify(spec.member || null), x: O.freeSlot(taken, Math.max(105, Math.min(170, Math.floor((innerWidth - 140) / Math.max(5, crowd)))), 70),
          facing: 1, state: 'walk', mode: 'walk', modeUntil: 0, drawn: '', tagKey: '' };
    bindPet(p);
    pets.set(spec.id, p);
    setTimeout(() => el.classList.remove('pop'), 600);
    return p;
  }

  function applySpecs(specs) {
    const now = performance.now();
    crowd = specs.length;   // a big team gets closer slots so everyone fits on the bar
    const ids = new Set(specs.map((s) => s.id));
    for (const [id, p] of pets) if (!ids.has(id) && !(p.cheerUntil > now)) { pets.delete(id); p.el.classList.add('leave'); setTimeout(() => p.el.remove(), 450); }
    for (const s of specs) {
      const p = ensurePet(s);
      if (p.cheerUntil > now) continue;
      Object.assign(p, { kind: s.kind, taskId: s.taskId, agentId: s.agentId, memberId: s.memberId, status: s.status, label: s.label, persona: s.persona, want: s.state, count: s.count });
      const lk = JSON.stringify(s.member || null);
      if (lk !== p.lookKey) { p.lookKey = lk; p.look = S.look(s.id, s.member); p.drawn = ''; }   // the team member was edited
      p.el.classList.toggle('alert', s.state === 'alert');
    }
    const alerts = new Set(specs.filter((s) => s.state === 'alert').map((s) => s.id));
    if (started && cfg.sound && [...alerts].some((id) => !lastAlertIds.has(id))) beep();
    lastAlertIds = alerts; started = true;
  }

  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = 784; g.gain.value = 0.05;
      o.connect(g); g.connect(ac.destination); o.start();
      o.frequency.setValueAtTime(1175, ac.currentTime + 0.12); o.stop(ac.currentTime + 0.3);
    } catch (_) { /* no audio: fine */ }
  }

  function bindPet(p) {
    let down = null;
    p.el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, px: p.x, moved: false }; p.el.setPointerCapture(e.pointerId); });
    p.el.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - down.x) > 4) down.moved = true;
      if (down.moved) { p.dragging = true; p.el.classList.add('dragging'); p.x = Math.max(0, Math.min(innerWidth - PW, down.px + e.clientX - down.x)); }
    });
    p.el.addEventListener('pointerup', () => {
      const d = down; down = null; p.dragging = false; p.el.classList.remove('dragging');
      if (d && !d.moved) office.openPanel({ id: p.memberId || p.taskId || p.agentId || '', kind: p.kind, tab: p.want === 'alert' ? 'approvals' : 'team', x: window.screenX + p.x + PW / 2 });
    });
  }

  function setThrough(v) { if (v !== through) { through = v; office.clickThrough(v); } }
  window.addEventListener('pointermove', (e) => setThrough(!(e.target && e.target.closest && e.target.closest('.pet'))));
  document.addEventListener('pointerleave', () => setThrough(true));

  function pickState(p, now) {
    if (p.cheerUntil > now) return 'cheer';
    if (p.want === 'alert' || p.want === 'working' || p.want === 'sofa') return p.want;
    if (now > p.modeUntil) { // idle: wander, grab a coffee, read, nap
      p.mode = O.nextIdleMode(p.mode, Math.random);
      p.modeUntil = now + (p.mode === 'walk' ? 6000 + Math.random() * 6000 : 9000 + Math.random() * 12000);
      p.dir = Math.random() < 0.5 ? -1 : 1;
    }
    return p.mode;
  }

  function who(p) {
    const ps = p.persona || { name: '', role: '' };
    if (ps.role === 'member' || ps.role === 'chief') return { name: ps.name || tr('pet.chief'), role: ps.title || (ps.role === 'chief' ? tr('pet.chief') : '') };
    return { name: ps.name, role: ps.role ? tr('role.' + ps.role) : '' };
  }
  function renderTag(p) {
    const key = [cfg.lang, p.status, p.label, p.count, p.persona && p.persona.name, p.persona && p.persona.title, p.state].join('|');
    if (key === p.tagKey) return;
    p.tagKey = key;
    const w = who(p), tag = p.tag;
    tag.textContent = '';
    const dot = document.createElement('span'); dot.className = 'dot ' + (p.status || 'idle');
    const l1 = document.createElement('div'); l1.className = 'l1';
    l1.append(dot, document.createTextNode(w.name + (w.role ? ' · ' + w.role : '')));
    const l2 = document.createElement('div'); l2.className = 'l2';
    l2.textContent = p.status === 'alert' ? tr('tag.review') + (p.count > 1 ? ' (' + p.count + ')' : '') : p.status === 'working' && p.label ? p.label : tr('state.' + (p.status || 'idle'));
    tag.append(l1, l2);
  }

  let last = performance.now();
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
    const beat = Math.floor(nowMs / 220);
    for (const p of pets.values()) {
      const st = pickState(p, nowMs);
      if (st === 'walk' && !p.dragging) {
        p.x += (p.dir || 1) * SPEED * dt; p.facing = p.dir || 1;
        if (p.x < 0) { p.x = 0; p.dir = 1; } if (p.x > innerWidth - PW) { p.x = innerWidth - PW; p.dir = -1; }
      }
      p.state = st;
      p.el.style.left = Math.round(p.x) + 'px';
      const fr = st === 'walk' ? Math.floor(nowMs / 170) : beat;
      const key = st + '|' + fr + '|' + p.facing;
      if (key !== p.drawn) { S.draw(p.ctx, p.look, st, fr, p.facing, beat); p.drawn = key; }
      renderTag(p);
      const saying = p.sayUntil > nowMs;
      p.el.classList.toggle('saying', saying);
      if (!saying && p.say.textContent) p.say.textContent = '';
    }
    requestAnimationFrame(frame);
  }

  async function poll() {
    const [st, ld, tm, cl] = await Promise.all([office.api('GET', '/api/state'), office.api('GET', '/api/landings'), office.api('GET', '/api/team'), office.api('GET', '/api/chat-latest?since=' + sinceChat)]);
    offline = !st.ok && st.status === 0;
    const landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    const members = tm.ok && Array.isArray(tm.data) ? tm.data : null;
    const now = performance.now();
    for (const r of (cl.ok && Array.isArray(cl.data) ? cl.data : [])) {   // a team member answered: a speech bubble over them
      sinceChat = Math.max(sinceChat, r.at);
      sayLater.set(r.member, r.text); lastActive.set(r.member, now);
    }
    const keep = new Set([...lastActive].filter(([, t]) => now - t < LINGER).map(([id]) => id));
    const list = O.buildPets(st.ok ? st.data : null, landings, offline, members, keep);
    for (const p of list) if (p.memberId && (p.state === 'working' || p.state === 'alert')) lastActive.set(p.memberId, now);
    applySpecs(list);
    for (const [id, text] of [...sayLater]) {
      const p = pets.get('S:' + id);
      if (!p) continue;   // not on the bar yet: shown as soon as they appear
      p.say.textContent = text.length > 180 ? text.slice(0, 177) + '...' : text;
      p.sayUntil = performance.now() + SAY_MS; sayLater.delete(id);
    }
  }

  async function init() {
    cfg = await office.getConfig();
    dicts = await office.dicts();
    office.on('config', (c) => { cfg = c; });
    office.on('event', (e) => { // the panel tells us what the person decided: celebrate an approval
      const p = e && e.type === 'approved' && (pets.get('L:' + e.id) || pets.get('S:' + (e.specialist || 'chief')));
      if (p) { p.cheerUntil = performance.now() + 3600; p.el.classList.remove('alert'); p.status = 'working'; }
    });
    document.title = tr('app.name');
    await poll();
    setInterval(poll, 3000);
    requestAnimationFrame(frame);
    if (mock && params.get('cheer')) setTimeout(() => { const p = pets.get('S:davi'); if (p) p.cheerUntil = performance.now() + 60000; }, 300);
  }
  init();
})();
