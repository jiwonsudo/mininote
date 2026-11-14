// 페이지 화면용 preload
//
// preload는 격리된 세계(isolated world)에 있으므로, 받은 MessagePort를
// window.postMessage로 페이지 쪽 세계에 그대로 넘겨준다.
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('mininote:new-message-port', (e) => {
  window.postMessage('mininote:new-message-port', '*', e.ports);
});

contextBridge.exposeInMainWorld('electronApi', {
  requestSqlitePort: () => ipcRenderer.send('mininote:get-sqlite-port'),
  setTitle: (title, pageId) => ipcRenderer.send('page:title', { title, pageId }),
  openInNewTab: (pageId) => ipcRenderer.send('page:open-in-new-tab', pageId),
  notifyChanged: () => ipcRenderer.send('page:changed'),
  onNavigate: (cb) => ipcRenderer.on('page:navigate', (_e, pageId) => cb(pageId)),
  onHistory: (cb) => ipcRenderer.on('edit:history', (_e, kind) => cb(kind)),
  onRefresh: (cb) => ipcRenderer.on('page:refresh', () => cb()),
  openSearch: () => ipcRenderer.send('search:open'),
  searchOpenPage: (pageId, newTab) => ipcRenderer.send('search:open-page', { pageId, newTab }),
  searchClose: () => ipcRenderer.send('search:close'),
});
