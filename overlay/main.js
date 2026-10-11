// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// Escritório Digital overlay: little office workers standing on the Windows taskbar.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme, shell, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const I18N = require('./i18n');

const DICTS = { 'pt-BR': require('./i18n/pt-BR.json'), en: require('./i18n/en.json') };
const SCALE = 3, PET_H = 46 * SCALE, WIN_H = PET_H + 64; // pets plus room for the name tag
const FEET_PAD = 6;       // transparent canvas pixels under the soles (2 sprite rows x 3)
const AUTOHIDE_BAR = 48;  // assumed taskbar height when it hides itself (Windows 11 default, in DIP)
const DEFAULTS = { url: 'http://localhost:8080', token: '', lang: '', sound: true, hidden: false, container: 'clodfarm', yoffset: 0, onboarded: false, notify: true };

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
const publicCfg = () => ({ url: cfg.url, lang: cfg.lang, sound: cfg.sound, hasToken: !!cfg.token, hidden: cfg.hidden, yoffset: cfg.yoffset, onboarded: cfg.onboarded, notify: cfg.notify, exportDir: exportDir(), floor: lastPlace && lastPlace.floor, bar: lastPlace && lastPlace.bar });
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
  const p = computePlace(), y = Math.round(p.floor + FEET_PAD - 1 + (cfg.yoffset || 0) - WIN_H);
  const sig = [p.x, p.width, p.floor, cfg.yoffset, p.scale].join(',');
  if (!lastPlace || lastPlace.sig !== sig) {
    overlay.setBounds({ x: p.x, y, width: p.width, height: WIN_H });
    lastPlace = { ...p, sig };
    for (const w of [panel]) if (w && !w.isDestroyed()) w.webContents.send('config', publicCfg());
  }
  overlay.setAlwaysOnTop(true, 'screen-saver');   // the taskbar can climb over us when it is clicked: take the top back
  overlay.moveTop();
}
async function refreshTaskbar() { tbState = await taskbarState(); placeOverlay(); }

function createOverlay() {
  overlay = new BrowserWindow({
    width: 800, height: WIN_H, transparent: true, frame: false, resizable: false, hasShadow: false,
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

function openPanel(opts = {}) {
  const d = screen.getPrimaryDisplay();
  const w = 420, h = 680;
  const x = Math.max(d.bounds.x + 8, Math.min(d.bounds.x + d.bounds.width - w - 8, Math.round((opts.x ?? d.bounds.width - w - 24) - w / 2)));
  const y = Math.max(d.bounds.y + 8, d.workArea.y + d.workArea.height - PET_H - h - 16 + (cfg.yoffset || 0));
  if (panel && !panel.isDestroyed()) {
    panel.setBounds({ x, y, width: w, height: h });
    panel.show(); panel.focus();
    panel.webContents.send('focus', opts);
    return;
  }
  panel = new BrowserWindow({
    x, y, width: w, height: h, frame: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#15131f' : '#f5f4fa',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'), { query: { id: opts.id || '', kind: opts.kind || '', tab: opts.tab === 'agent' ? 'team' : (opts.tab || '') } });
  panel.once('ready-to-show', () => panel.show());
  panel.on('blur', () => { if (panel && !panel.isDestroyed() && !panel.webContents.isDevToolsOpened()) panel.hide(); });
  panel.on('closed', () => { panel = null; });
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
  for (const k of ['url', 'lang', 'sound', 'token', 'yoffset', 'onboarded', 'notify']) if (k in patch) allowed[k] = patch[k];
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
  await refreshTaskbar();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, refreshTaskbar);
  setInterval(refreshTaskbar, 3000); // taskbar moved, resized or set to auto-hide while we run
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
