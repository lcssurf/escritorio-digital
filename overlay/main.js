// Escritório Digital overlay: little office workers standing on the Windows taskbar.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const I18N = require('./i18n');

const DICTS = { 'pt-BR': require('./i18n/pt-BR.json'), en: require('./i18n/en.json') };
const SCALE = 3, PET_H = 46 * SCALE, WIN_H = PET_H + 56; // pets plus room for the name tag
const DEFAULTS = { url: 'http://localhost:8080', token: '', lang: '', sound: true, hidden: false, container: 'clodfarm' };

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
const publicCfg = () => ({ url: cfg.url, lang: cfg.lang, sound: cfg.sound, hasToken: !!cfg.token, hidden: cfg.hidden });
const t = (k, v) => I18N.make(DICTS, cfg.lang)(k, v);

// The farm's secret for this PC: the container wrote it into its volume. It never leaves this machine.
function fetchToken() {
  return new Promise((resolve) => {
    execFile('docker', ['exec', cfg.container, 'cat', '/workspace/.farm/overlay.token'], { timeout: 15000 }, (err, out) => {
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

function placeOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const bottom = d.workArea.y + d.workArea.height; // top edge of a bottom taskbar: pets stand right on it
  overlay.setBounds({ x: d.bounds.x, y: bottom - PET_H - 10, width: d.bounds.width, height: WIN_H });
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 800, height: WIN_H, transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  placeOverlay();
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.once('ready-to-show', () => { if (!cfg.hidden) overlay.showInactive(); });
}

function openPanel(opts = {}) {
  const d = screen.getPrimaryDisplay();
  const w = 420, h = 680;
  const x = Math.max(d.bounds.x + 8, Math.min(d.bounds.x + d.bounds.width - w - 8, Math.round((opts.x ?? d.bounds.width - w - 24) - w / 2)));
  const y = Math.max(d.bounds.y + 8, d.workArea.y + d.workArea.height - PET_H - h - 16);
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
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'), { query: { id: opts.id || '', tab: opts.tab === 'agent' ? 'team' : (opts.tab || '') } });
  panel.once('ready-to-show', () => panel.show());
  panel.on('blur', () => { if (panel && !panel.isDestroyed() && !panel.webContents.isDevToolsOpened()) panel.hide(); });
  panel.on('closed', () => { panel = null; });
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip(t('app.name'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.show'), click: () => openPanel({ tab: 'approvals' }) },
    { label: cfg.hidden ? t('tray.showpets') : t('tray.hide'), click: () => togglePets() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}
function togglePets() {
  cfg.hidden = !cfg.hidden; saveCfg({});
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
  for (const k of ['url', 'lang', 'sound', 'token']) if (k in patch) allowed[k] = patch[k];
  // the key only ever goes to this PC: refuse any address that is not local
  if (allowed.url && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(allowed.url)) delete allowed.url;
  saveCfg(allowed);
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
ipcMain.on('open-farm', () => shell.openExternal(cfg.url));

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  loadCfg();
  if (!cfg.token) { const tok = await fetchToken(); if (tok) saveCfg({ token: tok }); }
  createOverlay();
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.on('click', () => openPanel({ tab: 'approvals' }));
    rebuildTray();
  } catch (_) { /* no tray icon: the characters still work */ }
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, placeOverlay);
});
app.on('window-all-closed', (e) => e.preventDefault());
