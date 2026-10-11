// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// Escritório Digital overlay: little office workers standing on the Windows taskbar.
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme, shell, globalShortcut, Notification, dialog } = electron;
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const I18N = require('./i18n');
const EXPORT = require('./exporter');

const DICTS = { 'pt-BR': require('./i18n/pt-BR.json'), en: require('./i18n/en.json') };
// the characters are drawn 46 pixels tall; each pixel is shown 2 to 5 screen pixels wide (always a whole number, so they stay sharp)
const petScale = () => ([2, 3, 4, 5].includes(cfg.petScale) ? cfg.petScale : 3);
const petH = () => 46 * petScale(), winH = () => petH() + 64;   // pets plus room for the name tag
const FEET_PAD = 6;       // transparent canvas pixels under the soles (2 sprite rows x 3)
const AUTOHIDE_BAR = 48;  // assumed taskbar height when it hides itself (Windows 11 default, in DIP)
const DEFAULTS = { url: 'http://localhost:8080', token: '', lang: '', sound: true, hidden: false, container: 'clodfarm', yoffset: 0, onboarded: false, notify: true, panelSize: {}, panelPos: {}, exportFormats: [], updateCheck: true, updateSkipped: '', legalAccepted: false, characters: 'people', petScale: 3 };

let cfg = { ...DEFAULTS }, overlay = null, panel = null, tray = null;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch (_) { cfg = { ...DEFAULTS }; }
  cfg.lang = I18N.pick(cfg.lang || app.getLocale());
}
function saveCfg(patch) {
  cfg = { ...cfg, ...patch };
  cfg.lang = I18N.pick(cfg.lang);
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
  for (const w of [overlay, panel]) if (w && !w.isDestroyed()) w.webContents.send('config', publicCfg());
  rebuildTray();
}
const exportDir = () => path.join(app.getPath('documents'), 'Escrit\u00f3rio Digital');   // where approved work is copied (the start script mounts it into the container)
const appVersion = () => { try { return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch (_) { return ''; } };
let updateInfo = null;   // { version, url, notes } when a newer release exists and the person has not skipped it
const publicCfg = () => ({ url: cfg.url, lang: cfg.lang, sound: cfg.sound, hasToken: !!cfg.token, hidden: cfg.hidden, yoffset: cfg.yoffset, onboarded: cfg.onboarded, notify: cfg.notify, exportDir: exportDir(), exportFormats: cfg.exportFormats, updateCheck: cfg.updateCheck !== false, version: appVersion(), update: updateInfo, legalAccepted: !!cfg.legalAccepted, characters: cfg.characters === 'animals' ? 'animals' : 'people', petScale: petScale(), floor: lastPlace && lastPlace.floor, bar: lastPlace && lastPlace.bar });
const t = (k, v) => I18N.make(DICTS, cfg.lang)(k, v);

// The farm's secret for this PC: the container wrote it into its volume. It never leaves this machine.
function fetchToken() {
  return new Promise((resolve) => {
    // on the Mac an app opened from the Finder does not get the terminal's PATH: look for Docker where it usually is
    const env = { ...process.env, PATH: [process.env.PATH || '', '/usr/local/bin', '/opt/homebrew/bin', '/Applications/Docker.app/Contents/Resources/bin'].join(path.delimiter) };
    execFile('docker', ['exec', cfg.container, 'cat', '/workspace/.farm/overlay.token'], { timeout: 15000, env }, (err, out) => {
      const tok = String(out || '').trim();
      resolve(!err && tok ? tok : '');
    });
  });
}

async function api(method, p, body) {
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + p, {
      method,
      headers: { 'X-Overlay-Token': cfg.token, 'X-Clodfarm': '1', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
}

// Windows keeps the taskbar edge/auto-hide choice in the registry (StuckRects3: byte 8 = auto-hide, byte 12 = edge).
function taskbarState() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ autoHide: false, edge: 3 });
    execFile('reg', ['query', String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3`, '/v', 'Settings'], { timeout: 4000 }, (err, out) => {
      const m = !err && /REG_BINARY\s+([0-9A-Fa-f]+)/.exec(String(out));
      if (!m) return resolve({ autoHide: false, edge: 3 });
      const b = m[1].match(/../g).map((x) => parseInt(x, 16));
      resolve({ autoHide: (b[8] & 1) === 1, edge: b[12] });
    });
  });
}

// Where the soles go: the top edge of a bottom taskbar, found from what Windows reserves (bounds vs workArea).
// Works for any taskbar height or DPI; for a top/side taskbar the characters stand on the screen bottom.
let lastPlace = null, tbState = { autoHide: false, edge: 3 };
function computePlace() {
  const d = screen.getPrimaryDisplay();
  const bar = d.bounds.y + d.bounds.height - (d.workArea.y + d.workArea.height);   // reserved at the bottom (DIP)
  let floor = d.workArea.y + d.workArea.height;
  if (bar <= 0 && tbState.autoHide && tbState.edge === 3) floor = d.bounds.y + d.bounds.height - AUTOHIDE_BAR; // hidden bar: stand where it slides in
  return { x: d.bounds.x, width: d.bounds.width, floor, bar, id: d.id, scale: d.scaleFactor };
}
function placeOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const p = computePlace(), y = Math.round(p.floor + FEET_PAD - 1 + (cfg.yoffset || 0) - winH());
  const sig = [p.x, p.width, p.floor, cfg.yoffset, p.scale, petScale()].join(',');
  if (!lastPlace || lastPlace.sig !== sig) {
    overlay.setBounds({ x: p.x, y, width: p.width, height: winH() });
    lastPlace = { ...p, sig };
    for (const w of [panel]) if (w && !w.isDestroyed()) w.webContents.send('config', publicCfg());
  }
  overlay.setAlwaysOnTop(true, 'screen-saver');   // the taskbar can climb over us when it is clicked: take the top back
  overlay.moveTop();
}
async function refreshTaskbar() { tbState = await taskbarState(); placeOverlay(); }

function createOverlay() {
  overlay = new BrowserWindow({
    width: 800, height: winH(), transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  placeOverlay();
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.once('ready-to-show', () => { if (!cfg.hidden) overlay.showInactive(); });
}

// The panel: a small window for quick things (it hides when you click elsewhere), and a wide one for reading and editing a
// document (it stays until you close it). Both can be resized by the person, and the sizes are remembered.
let panelMode = 'normal';
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function sizeFor(mode, d) {
  const wa = d.workArea, saved = (cfg.panelSize || {})[mode] || {};
  const dw = mode === 'wide' ? Math.min(1120, wa.width - 24) : 420, dh = mode === 'wide' ? Math.min(780, wa.height - 24) : 680;
  return { w: clampN(Math.round(saved.w || dw), mode === 'wide' ? 760 : 380, Math.max(380, wa.width - 16)), h: clampN(Math.round(saved.h || dh), 480, Math.max(480, wa.height - 16)) };
}
// where the person left the panel (per mode); ignored if that spot is no longer on any screen
function savedSpot(mode, w, h) {
  const p = (cfg.panelPos || {})[mode];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const ok = screen.getAllDisplays().some((dd) => {
    const a = dd.workArea;
    return p.x + 80 < a.x + a.width && p.x + w - 80 > a.x && p.y >= a.y - 8 && p.y + 60 < a.y + a.height;
  });
  return ok ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
}
function openPanel(opts = {}) {
  const d = screen.getPrimaryDisplay();
  if (panel && !panel.isDestroyed()) {
    if (panelMode === 'normal') {
      const { w, h } = sizeFor('normal', d);
      const x = Math.max(d.bounds.x + 8, Math.min(d.bounds.x + d.bounds.width - w - 8, Math.round((opts.x ?? d.bounds.width - w - 24) - w / 2)));
      const spot = savedSpot('normal', w, h);
      panel.setBounds({ x: spot ? spot.x : x, y: spot ? spot.y : Math.max(d.bounds.y + 8, d.workArea.y + d.workArea.height - petH() - h - 16 + (cfg.yoffset || 0)), width: w, height: h });
    }
    panel.show(); panel.focus();
    panel.webContents.send('focus', opts);
    return;
  }
  panelMode = 'normal';
  const { w, h } = sizeFor('normal', d);
  const x = Math.max(d.bounds.x + 8, Math.min(d.bounds.x + d.bounds.width - w - 8, Math.round((opts.x ?? d.bounds.width - w - 24) - w / 2)));
  const y0 = Math.max(d.bounds.y + 8, d.workArea.y + d.workArea.height - petH() - h - 16 + (cfg.yoffset || 0));
  const spot0 = savedSpot('normal', w, h);
  panel = new BrowserWindow({
    x: spot0 ? spot0.x : x, y: spot0 ? spot0.y : y0, width: w, height: h, minWidth: 380, minHeight: 480, frame: false, resizable: true, maximizable: false, fullscreenable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#15131f' : '#f5f4fa',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'), { query: { id: opts.id || '', kind: opts.kind || '', tab: opts.tab === 'agent' ? 'team' : (opts.tab || '') } });
  panel.once('ready-to-show', () => panel.show());
  // clicking elsewhere hides the small panel; the wide one (a document being read or edited) stays
  panel.on('blur', () => { if (panel && !panel.isDestroyed() && panelMode === 'normal' && !panel.webContents.isDevToolsOpened()) panel.hide(); });
  let saveTimer = null;
  panel.on('resized', () => {   // the person dragged an edge: remember that size for this mode
    if (!panel || panel.isDestroyed()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { const b = panel.getBounds(); saveCfg({ panelSize: { ...(cfg.panelSize || {}), [panelMode]: { w: b.width, h: b.height } } }); }, 400);
  });
  let moveTimer = null;
  panel.on('moved', () => {   // the person dragged the title bar: remember where, for this mode
    if (!panel || panel.isDestroyed()) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (!panel || panel.isDestroyed()) return; const b = panel.getBounds(); saveCfg({ panelPos: { ...(cfg.panelPos || {}), [panelMode]: { x: b.x, y: b.y } } }); }, 400);
  });
  panel.on('closed', () => { panel = null; panelMode = 'normal'; });
}
// the page asks for more room while a document is open, and gives it back when it is closed
function setPanelWide(wide) {
  if (!panel || panel.isDestroyed()) return;
  const mode = wide ? 'wide' : 'normal';
  if (mode === panelMode) return;
  const d = screen.getPrimaryDisplay(), b = panel.getBounds();
  panelMode = mode;
  const { w, h } = sizeFor(mode, d), wa = d.workArea;
  const spot = savedSpot(mode, w, h);
  const x = spot ? spot.x : clampN(b.x + b.width - w, wa.x + 8, wa.x + wa.width - w - 8);   // grow to the left: the panel sits at the right
  const y = spot ? spot.y : clampN(b.y + b.height - h, wa.y + 8, wa.y + wa.height - h - 8);   // keep its bottom edge
  panel.setBounds({ x, y, width: w, height: h });
  panel.focus();
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip(t('app.name'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.chat'), click: () => talkToChief() },
    { label: t('tray.show'), click: () => openPanel({ tab: 'approvals' }) },
    { label: cfg.hidden ? t('tray.showpets') : t('tray.hide'), click: () => togglePets() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}
function talkToChief() { openPanel({ tab: 'chat', id: 'chief', kind: 'member' }); }
function togglePets() {
  cfg.hidden = !cfg.hidden; saveCfg({}); // saveCfg also tells the panel, so its button follows
  if (overlay) cfg.hidden ? overlay.hide() : overlay.showInactive();
}

ipcMain.handle('api', (_e, method, p, body) => {
  if (!/^\/api\/[A-Za-z0-9/_.?=&%-]*$/.test(String(p))) return { ok: false, status: 0, error: 'bad path' };
  if (!['GET', 'POST'].includes(method)) return { ok: false, status: 0, error: 'bad method' };
  return api(method, p, body);
});
ipcMain.handle('config:get', () => publicCfg());
ipcMain.handle('config:set', (_e, patch) => {
  const allowed = {};
  for (const k of ['url', 'lang', 'sound', 'token', 'yoffset', 'onboarded', 'notify', 'updateCheck', 'updateSkipped', 'legalAccepted', 'characters', 'petScale']) if (k in patch) allowed[k] = patch[k];
  if ('exportFormats' in patch) allowed.exportFormats = [...new Set((Array.isArray(patch.exportFormats) ? patch.exportFormats : []).filter((f) => ['docx', 'pdf', 'html', 'rtf', 'txt'].includes(f)))];
  if ('updateCheck' in allowed) allowed.updateCheck = !!allowed.updateCheck;
  if ('legalAccepted' in allowed) allowed.legalAccepted = !!allowed.legalAccepted;
  if ('characters' in allowed) allowed.characters = allowed.characters === 'animals' ? 'animals' : 'people';
  if ('petScale' in allowed) allowed.petScale = [2, 3, 4, 5].includes(Number(allowed.petScale)) ? Number(allowed.petScale) : 3;
  if ('updateSkipped' in allowed) allowed.updateSkipped = String(allowed.updateSkipped || '').slice(0, 40);
  if ('yoffset' in allowed) allowed.yoffset = Math.max(-60, Math.min(60, Math.round(Number(allowed.yoffset) || 0)));
  // the key only ever goes to this PC: refuse any address that is not local
  if (allowed.url && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(allowed.url)) delete allowed.url;
  saveCfg(allowed);
  placeOverlay();
  return publicCfg();
});
ipcMain.handle('token:auto', async () => {
  const tok = await fetchToken();
  if (tok) saveCfg({ token: tok });
  return !!tok;
});
ipcMain.handle('dicts', () => DICTS);
ipcMain.on('click-through', (_e, through) => {
  if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!!through, { forward: true });
});
ipcMain.on('broadcast', (_e, evt) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('event', evt); });
ipcMain.on('open-panel', (_e, opts) => openPanel(opts || {}));
ipcMain.on('panel-wide', (_e, wide) => setPanelWide(!!wide));
ipcMain.on('quit', () => app.quit());
ipcMain.on('open-connectors', () => shell.openExternal('https://claude.ai/settings/connectors'));   // fixed address: the renderer cannot choose where to go
ipcMain.on('open-exports', () => { const d = exportDir(); try { fs.mkdirSync(d, { recursive: true }); } catch (_) { /* opening reports it */ } shell.openPath(d); });
ipcMain.on('notify', (_e, n) => {   // a Windows notification: the lawyer does not have to watch the bar
  if (!cfg.notify || !Notification.isSupported() || !n || typeof n.title !== 'string') return;
  if (panel && !panel.isDestroyed() && panel.isVisible() && panel.isFocused()) return;
  const note = new Notification({ title: String(n.title).slice(0, 80), body: String(n.body || '').slice(0, 200), silent: !cfg.sound });
  note.on('click', () => openPanel(n.target || { tab: 'chat', id: 'chief', kind: 'member' }));
  note.show();
});
// ---------------------------------------------------------------- documents: save a document in another format
const nowStamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const FORMAT_NAMES = { docx: 'Word', pdf: 'PDF', html: 'HTML', rtf: 'RTF', txt: 'Texto', md: 'Markdown' };
ipcMain.handle('export:doc', async (_e, req) => {
  try {
    const r = req || {}, fmt = String(r.format || '');
    if (!EXPORT.FORMATS[fmt] || typeof r.text !== 'string' || r.text.length > 2_000_000) return { ok: false, error: 'bad request' };
    const ext = EXPORT.FORMATS[fmt].ext, title = String(r.title || 'documento').slice(0, 200);
    const win = panel && !panel.isDestroyed() ? panel : undefined;
    const pick = await dialog.showSaveDialog(win, { title: t('export.dialog'), defaultPath: path.join(exportDir(), EXPORT.fileName(title, ext)), filters: [{ name: FORMAT_NAMES[fmt], extensions: [ext] }] });
    if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
    fs.mkdirSync(path.dirname(pick.filePath), { recursive: true });
    fs.writeFileSync(pick.filePath, await EXPORT.convert(fmt, r.text, { title, lang: cfg.lang }, electron));
    shell.showItemInFolder(pick.filePath);
    return { ok: true, path: pick.filePath };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// After an approval: the extra formats the person chose are made next to the copy the office already put in their folder.
ipcMain.handle('export:approved', async (_e, req) => {
  try {
    const r = req || {}, folder = String(r.folder || '');
    const formats = (cfg.exportFormats || []).filter((f) => EXPORT.FORMATS[f] && f !== 'md');
    if (!formats.length || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(folder) || !Array.isArray(r.files)) return { ok: true, made: 0 };
    const made = await EXPORT.writeApproved(path.resolve(exportDir(), folder), r.files, formats, { lang: cfg.lang }, electron);
    return { ok: true, made };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ---------------------------------------------------------------- backup of the team (a file the person keeps)
ipcMain.handle('backup:save', async () => {
  const r = await api('GET', '/api/backup');
  if (!r.ok || !r.data) return { ok: false, error: (r.data && r.data.error) || r.error || String(r.status) };
  const win = panel && !panel.isDestroyed() ? panel : undefined;
  const pick = await dialog.showSaveDialog(win, { title: t('backup.dialog.save'), defaultPath: path.join(app.getPath('documents'), `escritorio-digital-equipe-${nowStamp()}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(pick.filePath, JSON.stringify(r.data, null, 1));
  shell.showItemInFolder(pick.filePath);
  return { ok: true, path: pick.filePath, people: (r.data.team || []).length };
});
ipcMain.handle('backup:restore', async () => {
  const win = panel && !panel.isDestroyed() ? panel : undefined;
  const pick = await dialog.showOpenDialog(win, { title: t('backup.dialog.open'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
  let data;
  try {
    const f = pick.filePaths[0];
    if (fs.statSync(f).size > 300 * 1024) return { ok: false, error: t('backup.toolarge') };
    data = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) { return { ok: false, error: t('backup.notjson') }; }
  const n = Array.isArray(data && data.team) ? data.team.length : 0;
  // the question is asked by the operating system, in a window the page cannot draw or click for itself
  const ask = await dialog.showMessageBox(win, { type: 'warning', buttons: [t('backup.confirm.yes'), t('backup.confirm.no')], defaultId: 1, cancelId: 1, title: t('backup.confirm.title'), message: t('backup.confirm.msg', { n }), detail: t('backup.confirm.detail') });
  if (ask.response !== 0) return { ok: false, canceled: true };
  const r = await api('POST', '/api/restore', data);
  return r.ok ? { ok: true, ...(r.data || {}) } : { ok: false, error: (r.data && r.data.error) || r.error || String(r.status) };
});

// ---------------------------------------------------------------- updates: is there a newer release? (one anonymous request to GitHub; no data goes out)
const RELEASES = 'https://api.github.com/repos/lcssurf/escritorio-digital/releases/latest';
const semver = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate(manual) {
  const mine = appVersion();
  if (!mine || (!manual && cfg.updateCheck === false)) return { ok: true, update: updateInfo };
  try {
    const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'escritorio-digital' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rel = await res.json();
    const tag = String(rel.tag_name || '');
    updateInfo = isNewer(tag, mine) && (manual || cfg.updateSkipped !== tag) ? { version: tag.replace(/^v/i, ''), notes: String(rel.body || '').replace(/\r/g, '').slice(0, 600), url: 'https://github.com/lcssurf/escritorio-digital/releases/latest' } : null;
    saveCfg({});   // tells the panel
    return { ok: true, update: updateInfo, current: mine, latest: tag.replace(/^v/i, '') };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), update: updateInfo }; }
}
ipcMain.handle('update:check', () => checkUpdate(true));
ipcMain.on('update:open', () => shell.openExternal('https://github.com/lcssurf/escritorio-digital/releases/latest'));
ipcMain.handle('update:run', () => {
  // The same command a person would type. It closes this app and opens the new one when it is done; if it cannot (a job is
  // running, or the folder has changes of its own) it says why and nothing is touched.
  const script = path.join(__dirname, '..', 'scripts', 'escritorio.mjs');
  const logFile = path.join(app.getPath('userData'), 'update.log');
  let out;
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); out = fs.openSync(logFile, 'w'); } catch (_) { out = 'ignore'; }
  const env = { ...process.env, PATH: [process.env.PATH || '', '/usr/local/bin', '/opt/homebrew/bin'].join(path.delimiter), NO_COLOR: '1' };
  let child;
  try { child = spawn('node', [script, 'atualizar'], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env }); } catch (_) { child = null; }
  if (!child) { shell.openExternal('https://github.com/lcssurf/escritorio-digital/releases/latest'); return { ok: false, error: 'node' }; }
  child.on('error', () => { shell.openExternal('https://github.com/lcssurf/escritorio-digital/releases/latest'); dialog.showMessageBox({ type: 'info', message: t('update.nonode') }); });
  child.on('exit', (code) => {
    if (code === 0) return;
    let why = '';
    try { const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/); why = lines.filter((l) => /^\s*\S?\s*(\u2716|x )/.test(l) || /\u2716/.test(l)).concat(lines.filter((l) => /\u2192/.test(l))).map((l) => l.replace(/^\s*[^\w\u00c0-\u017f]+/, '').trim()).slice(0, 3).join('\n'); } catch (_) { /* no log */ }
    dialog.showMessageBox({ type: 'warning', title: t('update.failed.title'), message: t('update.failed'), detail: why || t('update.failed.log', { file: logFile }) });
  });
  child.unref();
  if (Notification.isSupported()) new Notification({ title: t('app.name'), body: t('update.running'), silent: true }).show();
  return { ok: true };
});

ipcMain.on('toggle-pets', () => togglePets());
ipcMain.on('open-farm', () => shell.openExternal(cfg.url));

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.escritoriodigital.overlay');
if (process.platform === 'darwin' && app.dock) app.dock.hide();   // a menu-bar utility: no Dock icon of its own
app.whenReady().then(async () => {
  loadCfg();
  if (!cfg.token) { const tok = await fetchToken(); if (tok) saveCfg({ token: tok }); }
  createOverlay();
  if (!cfg.onboarded) setTimeout(talkToChief, 1500);   // first run: the panel opens with the tour
  try { globalShortcut.register('Control+Alt+E', talkToChief); } catch (_) { /* the shortcut is a convenience */ }
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    if (process.platform === 'darwin') icon = icon.resize({ width: 18, height: 18 });   // the menu bar wants a small icon
    tray = new Tray(icon);
    tray.on('click', () => talkToChief());
    tray.on('double-click', () => togglePets());
    rebuildTray();
  } catch (_) { /* no tray icon: the characters still work */ }
  setTimeout(() => checkUpdate(false), 20000); setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
  await refreshTaskbar();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, refreshTaskbar);
  setInterval(refreshTaskbar, 3000); // taskbar moved, resized or set to auto-hide while we run
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
