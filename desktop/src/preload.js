'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge between the dashboard (renderer) and the Electron main process.
// `config` is fetched synchronously so it's available before the renderer's
// modules (e.g. the Supabase client) initialize. The service-role key is NEVER
// exposed here — only main holds it.
contextBridge.exposeInMainWorld('attendance', {
  isElectron: true,
  config: ipcRenderer.sendSync('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getStatus: () => ipcRenderer.invoke('status:get'),
});
