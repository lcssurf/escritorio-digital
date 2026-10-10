// Overlay renderer: characters on the taskbar. Polls the farm through the main process (the key never touches this page).
(function () {
  const S = window.Sprites, O = window.Office;
  const SCALE = 3, PW = S.W * SCALE, SPEED = 26; // px per second when walking
  const stage = document.getElementById('stage');
  const mock = new URLSearchParams(location.search).has('mock');
  let office = window.office, dicts = null, cfg = { lang: 'pt-BR', sound: true };
  let t = (k) => k;
  const pets = new Map(); // id -> pet
  let offline = false, through = true, lastAlertIds = new Set(), started = false;

  if (!office && mock) office = mockOffice();

  function mockOffice() {
    const now = Date.now() / 1000;
    const state = { agents: [{ id: 'clodfarm', name: 'Chefe', loggedIn: true, running: 1 }, { id: 'ana', name: 'Ana (Revisão)', loggedIn: true, running: 0 }, { id: 'rui', name: 'Rui (Prazos)', loggedIn: true, running: 0 }],
      subagents: [{ id: 't1', title: 'Organizar documentos do caso Exemplo', status: 'running' }, { id: 't2', title: 'Minuta da inicial (fictícia)', status: 'running' }] };
    const landings = [{ id: 'l1', title: 'Petição inicial (rascunho)', commits: 2, at: now, files: ['A\tpeticao.md'] }];
    return {
      api: async (m, p) => ({ ok: true, status: 200, data: p.startsWith('/api/state') ? state : p.startsWith('/api/landings') ? landings : {} }),
      getConfig: async () => ({ lang: new URLSearchParams(location.search).get('lang') || 'pt-BR', sound: false }),
      dicts: async () => ({ 'pt-BR': await (await fetch('../i18n/pt-BR.json')).json(), en: await (await fetch('../i18n/en.json')).json() }),
      clickThrough() {}, openPanel(o) { console.log('openPanel', o); }, on() {},
    };
  }

  function tr(key, vars) { return I18N.make(dicts, cfg.lang)(key, vars); }
  function statusText(p) { return tr('state.' + (p.status || 'idle')); }

  function ensurePet(spec) {
    let p = pets.get(spec.id);
    if (!p) {
      const el = document.createElement('div');
      el.className = 'pet';
      const cv = document.createElement('canvas');
      cv.width = S.W; cv.height = S.H;
      const tag = document.createElement('div');
      tag.className = 'tag';
      el.append(cv, tag);
      stage.append(el);
      const taken = [...pets.values()].map((q) => q.x);
      p = { id: spec.id, el, cv, ctx: cv.getContext('2d'), tag, look: S.look(spec.id), x: O.freeSlot(taken, 150, 60),
            facing: 1, state: 'walk', mode: 'walk', modeUntil: 0, drawn: '' };
      bindPet(p);
      pets.set(spec.id, p);
    }
    return p;
  }

  function applySpecs(specs) {
    const ids = new Set(specs.map((s) => s.id));
    for (const [id, p] of pets) if (!ids.has(id)) { p.el.remove(); pets.delete(id); }
    for (const s of specs) {
      const p = ensurePet(s);
      Object.assign(p, { kind: s.kind, taskId: s.taskId, agentId: s.agentId, status: s.status, label: s.label, want: s.state });
      p.el.classList.toggle('alert', s.state === 'alert');
    }
    const alerts = new Set(specs.filter((s) => s.state === 'alert').map((s) => s.id));
    if ([...alerts].some((id) => !lastAlertIds.has(id)) && started && cfg.sound) beep();
    lastAlertIds = alerts; started = true;
  }

  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.04;
      o.connect(g); g.connect(ac.destination); o.start();
      o.frequency.setValueAtTime(1175, ac.currentTime + 0.1); o.stop(ac.currentTime + 0.22);
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
    p.el.addEventListener('pointerup', (e) => {
      const d = down; down = null; p.dragging = false; p.el.classList.remove('dragging');
      if (d && !d.moved) office.openPanel({ id: p.taskId || p.agentId || '', kind: p.kind, tab: p.kind === 'landing' ? 'approvals' : 'agent', x: window.screenX + p.x + PW / 2 });
    });
  }

  function setThrough(v) { if (v !== through) { through = v; office.clickThrough(v); } }
  window.addEventListener('pointermove', (e) => setThrough(!(e.target && e.target.closest && e.target.closest('.pet'))));
  document.addEventListener('pointerleave', () => setThrough(true));

  function pickState(p, now) {
    if (p.want === 'alert') return 'alert';
    if (p.want === 'working') return 'working';
    if (p.want === 'sofa') return 'sofa';
    if (now > p.modeUntil) { // idle: wander, grab a coffee, nap on the sofa
      p.mode = O.nextIdleMode(p.mode, Math.random);
      p.modeUntil = now + (p.mode === 'walk' ? 6000 + Math.random() * 6000 : 8000 + Math.random() * 12000);
      p.dir = Math.random() < 0.5 ? -1 : 1;
    }
    return p.mode;
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
      const fr = st === 'walk' ? Math.floor(nowMs / 260) : beat;
      const key = st + '|' + (st === 'walk' ? fr % 2 : fr % 24) + '|' + p.facing;
      if (key !== p.drawn) { S.draw(p.ctx, p.look, st, fr, p.facing); p.drawn = key; }
      p.tag.textContent = '';
      const dot = document.createElement('span'); dot.className = 'dot ' + (p.status || 'idle');
      p.tag.append(dot, document.createTextNode(p.label ? p.label + ' · ' + statusText(p) : statusText(p)));
    }
    requestAnimationFrame(frame);
  }

  async function poll() {
    const [st, ld] = await Promise.all([office.api('GET', '/api/state'), office.api('GET', '/api/landings')]);
    offline = !st.ok && st.status === 0;
    const landings = ld.ok && Array.isArray(ld.data) ? ld.data : [];
    applySpecs(O.buildPets(st.ok ? st.data : null, landings, offline));
  }

  async function init() {
    cfg = await office.getConfig();
    dicts = await office.dicts();
    office.on('config', (c) => { cfg = c; });
    document.title = tr('app.name');
    await poll();
    setInterval(poll, 3000);
    requestAnimationFrame(frame);
  }
  init();
})();
