// 탭 막대용 preload
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabsApi', {
  ready: () => ipcRenderer.send('tabs:ready'),
  newTab: () => ipcRenderer.send('tabs:new'),
  select: (id) => ipcRenderer.send('tabs:select', id),
  close: (id) => ipcRenderer.send('tabs:close', id),
  onState: (cb) => ipcRenderer.on('tabs:state', (_e, state) => cb(state)),
});
