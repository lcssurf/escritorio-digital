const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  api: (method, p, body) => ipcRenderer.invoke('api', method, p, body),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  autoToken: () => ipcRenderer.invoke('token:auto'),
  dicts: () => ipcRenderer.invoke('dicts'),
  clickThrough: (through) => ipcRenderer.send('click-through', through),
  openPanel: (opts) => ipcRenderer.send('open-panel', opts),
  openFarm: () => ipcRenderer.send('open-farm'),
  quit: () => ipcRenderer.send('quit'),
  openExports: () => ipcRenderer.send('open-exports'),
  openConnectors: () => ipcRenderer.send('open-connectors'),
  notify: (n) => ipcRenderer.send('notify', n),
  togglePets: () => ipcRenderer.send('toggle-pets'),
  broadcast: (evt) => ipcRenderer.send('broadcast', evt),
  on: (channel, fn) => { if (['config', 'focus', 'event'].includes(channel)) ipcRenderer.on(channel, (_e, v) => fn(v)); },
});
