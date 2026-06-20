'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const Store = require('electron-store');
const { syncFromDevice } = require('./sync');

const store = new Store({ name: 'attendance-config' });

let win = null;
let tray = null;
let pushChild = null;

// ─── config helpers ─────────────────────────────────────────────────────────
const DEFAULTS = {
  deviceIp: '192.168.1.201', devicePort: 4370, deviceSn: 'NYU7253801246',
  timezone: 'Asia/Karachi', tzOffset: '+05:00', autoSyncOnOpen: true, pushEnabled: false,
};
const get = (k) => store.get(k, DEFAULTS[k]);

// What the renderer is allowed to see (no service-role key).
function publicConfig() {
  return {
    supabaseUrl: store.get('supabaseUrl', ''),
    anonKey: store.get('anonKey', ''),
    deviceIp: get('deviceIp'), devicePort: get('devicePort'), deviceSn: get('deviceSn'),
    timezone: get('timezone'), tzOffset: get('tzOffset'),
    autoSyncOnOpen: get('autoSyncOnOpen'), pushEnabled: get('pushEnabled'),
    hasServiceKey: !!store.get('serviceKey', ''),
  };
}

function saveConfig(cfg) {
  try {
    if (!cfg.supabaseUrl || !cfg.anonKey) return { ok: false, error: 'Project URL and anon key are required.' };
    if (!cfg.serviceKey && !store.get('serviceKey')) return { ok: false, error: 'Service-role key is required.' };
    const out = { ...cfg };
    if (!cfg.serviceKey) delete out.serviceKey; // blank = keep existing
    store.set(out);
    applyPushSetting();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function syncConfig() {
  return {
    deviceIp: get('deviceIp'), devicePort: Number(get('devicePort')) || 4370,
    deviceSn: get('deviceSn'), tzOffset: get('tzOffset'),
    supabaseUrl: store.get('supabaseUrl'), serviceKey: store.get('serviceKey'),
  };
}

async function runSync() {
  const cfg = syncConfig();
  if (!cfg.supabaseUrl || !cfg.serviceKey) return { ok: false, error: 'Not configured yet.' };
  try {
    const r = await syncFromDevice(cfg, { log: (m) => console.log('[sync]', m) });
    store.set('lastSync', new Date().toISOString());
    store.set('lastResult', r);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── optional push backup (the proven always-on catcher) ────────────────────
function listenerEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'listener', 'src', 'server.js')
    : path.join(__dirname, '..', '..', 'listener', 'src', 'server.js');
}

function startPush() {
  if (pushChild) return;
  const env = {
    ...process.env,
    DEVICE_SN: get('deviceSn'),
    SUPABASE_URL: store.get('supabaseUrl'),
    SUPABASE_SERVICE_KEY: store.get('serviceKey'),
    DEVICE_TZ_OFFSET: get('tzOffset'),
    BUFFER_DIR: path.join(app.getPath('userData'), 'buffer'),
    PORT: '8081',
    ELECTRON_RUN_AS_NODE: '1',
  };
  try {
    pushChild = fork(listenerEntry(), [], { env, stdio: 'inherit' });
    pushChild.on('exit', () => { pushChild = null; });
    console.log('[push] background catcher started on :8081');
  } catch (e) {
    console.error('[push] failed to start:', e.message);
  }
}

function stopPush() {
  if (pushChild) { try { pushChild.kill(); } catch { /* ignore */ } pushChild = null; }
}

function applyPushSetting() {
  if (get('pushEnabled') && store.get('serviceKey')) startPush();
  else stopPush();
}

// ─── window + tray ──────────────────────────────────────────────────────────
function rendererPath() {
  // ATT_RENDERER_URL lets you point at the Vite dev server during development.
  if (process.env.ATT_RENDERER_URL) return { url: process.env.ATT_RENDERER_URL };
  // renderer/ ships inside the app bundle (asar); __dirname-relative resolves in
  // both dev and packaged builds.
  return { file: path.join(__dirname, '..', 'renderer', 'index.html') };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'Attendance OS',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  const r = rendererPath();
  if (r.url) win.loadURL(r.url); else win.loadFile(r.file);

  win.on('close', (e) => {
    // If the background catcher is on, keep running in the tray instead of quitting.
    if (get('pushEnabled') && !app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  win.webContents.once('did-finish-load', async () => {
    if (get('autoSyncOnOpen') && store.get('supabaseUrl') && store.get('serviceKey')) {
      const r2 = await runSync();
      console.log('[sync] auto-sync on open:', JSON.stringify(r2));
    }
  });
}

function showWindow() {
  if (!win) createWindow(); else { win.show(); win.focus(); }
}

function buildTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('Attendance OS');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Attendance OS', click: showWindow },
      { label: 'Sync device now', click: () => runSync().then((r) => console.log('[sync] tray:', JSON.stringify(r))) },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (e) {
    console.error('[tray] not available:', e.message);
  }
}

// ─── IPC ────────────────────────────────────────────────────────────────────
ipcMain.on('config:get', (e) => { e.returnValue = publicConfig(); });
ipcMain.handle('config:save', (_e, cfg) => saveConfig(cfg));
ipcMain.handle('sync:now', () => runSync());
ipcMain.handle('status:get', () => ({
  lastSync: store.get('lastSync', null),
  lastResult: store.get('lastResult', null),
  pushEnabled: get('pushEnabled'),
}));

// ─── lifecycle ──────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    createWindow();
    buildTray();
    applyPushSetting();

    // Auto-update from GitHub Releases (only meaningful in a packaged build).
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      } catch { /* updater optional */ }
    }

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    // Keep running (tray) if the background catcher is on; otherwise quit.
    if (!get('pushEnabled') && process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => { app.isQuitting = true; stopPush(); });
}
