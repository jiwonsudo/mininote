// 메인 프로세스 (총괄 관리자)
const path = require('node:path');
const {
  app, BrowserWindow, WebContentsView, MessageChannelMain,
  utilityProcess, ipcMain, Menu, shell, dialog, nativeTheme,
} = require('electron');
const fs = require('node:fs');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');
const TAB_BAR_HEIGHT = 40;
const isMac = process.platform === 'darwin';

let mainWindow;
let tabBarView;
let sqliteServer;
let quickSearchWindow;
let dbViewerWindow;
const tabs = []; // { id, view, title, pageId }
let activeTabId = null;
let nextTabId = 1;

// 우리가 직접 만든 화면만 DB 통로를 받을 수 있게 함
const trustedWebContents = new Set();
function trust(webContents) {
  trustedWebContents.add(webContents.id);
  webContents.once('destroyed', () => trustedWebContents.delete(webContents.id));
  // 외부 링크는 앱 안에서 열지 않음
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (e) => e.preventDefault());
}

function securePrefs(preloadName, extra = {}) {
  return {
    preload: path.join(PRELOAD, preloadName),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 설정 (userData/settings.json)
//   theme: 'system' | 'light' | 'dark'
const THEMES = { system: '시스템 설정 따르기', light: '라이트 모드', dark: '다크 모드' };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { theme: 'system' };

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* 처음 실행 */ }
  if (!THEMES[settings.theme]) settings.theme = 'system';
}

function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (err) { console.warn('[main] settings save failed', err); }
}

// nativeTheme.themeSource를 바꾸면 모든 화면의 prefers-color-scheme이 같이 바뀜
function applyTheme(theme) {
  settings.theme = theme;
  nativeTheme.themeSource = theme;
  const bg = windowBackground();
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(bg);
}

const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff');

// ---------------------------------------------------------------------------
// SQLite 서버 (utility process로 따로 실행)
function startSqliteServer() {
  sqliteServer = utilityProcess.fork(path.join(__dirname, 'sqlite-server.js'), [app.getPath('userData')], {
    serviceName: 'MiniNote Sqlite Server',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sqliteServer.stdout.on('data', (d) => process.stdout.write(d));
  sqliteServer.stderr.on('data', (d) => process.stderr.write(d));
  sqliteServer.on('message', (msg) => {
    // 초기화가 끝나면 열려 있는 화면을 모두 새로 불러옴
    if (msg?.type === 'reset-done') {
      for (const t of tabs) t.view.webContents.loadFile(path.join(RENDERER, 'page', 'index.html'));
      dbViewerWindow?.webContents.reload();
    }
  });
  sqliteServer.on('exit', (code) => {
    if (code !== 0) console.warn('[main] sqlite server exited unexpectedly', code);
  });
}

// 페이지가 DB 통로를 요청하면 MessageChannel을 만들어
// 한쪽(port1)은 SQLite 서버에, 다른 쪽(port2)은 페이지에 준다.
ipcMain.on('mininote:get-sqlite-port', (event) => {
  const wc = event.sender;
  if (!trustedWebContents.has(wc.id)) {
    console.warn('[main] untrusted renderer asked for a DB port:', wc.getURL());
    return;
  }
  const { port1, port2 } = new MessageChannelMain();
  sqliteServer.postMessage({ id: wc.id, url: wc.getURL(), title: wc.getTitle() }, [port1]);
  wc.postMessage('mininote:new-message-port', null, [port2]);
});

// ---------------------------------------------------------------------------
// 창 + 탭 막대 + 탭
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'MiniNote',
    backgroundColor: windowBackground(),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
  });

  // 탭 막대 (WebContentsView)
  tabBarView = new WebContentsView({ webPreferences: securePrefs('tabs.js') });
  trust(tabBarView.webContents);
  tabBarView.webContents.loadFile(path.join(RENDERER, 'tabs', 'index.html'), {
    query: { platform: process.platform },
  });
  mainWindow.contentView.addChildView(tabBarView);

  mainWindow.on('resize', layout);
  // 창 자체는 페이지를 불러오지 않으므로(화면은 전부 WebContentsView) 'ready-to-show'가 오지 않는다.
  // 탭 막대가 다 그려지면 창을 보여준다.
  tabBarView.webContents.once('did-finish-load', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; tabs.length = 0; });

  newTab();
}

function layout() {
  if (!mainWindow) return;
  const { width, height } = mainWindow.getContentBounds();
  tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT });
  for (const t of tabs) {
    t.view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height: height - TAB_BAR_HEIGHT });
    t.view.setVisible(t.id === activeTabId);
  }
}

function newTab(pageId) {
  const view = new WebContentsView({ webPreferences: securePrefs('page.js') });
  trust(view.webContents);
  const tab = { id: nextTabId++, view, title: '새 탭', pageId: pageId ?? null };
  tabs.push(tab);
  view.webContents.loadFile(path.join(RENDERER, 'page', 'index.html'), {
    query: pageId ? { pageId } : {},
  });
  mainWindow.contentView.addChildView(view);
  selectTab(tab.id);
  return tab;
}

function selectTab(id) {
  activeTabId = id;
  layout();
  activeTab()?.view.webContents.focus();
  broadcastTabs();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [tab] = tabs.splice(i, 1);
  mainWindow.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  if (tabs.length === 0) { mainWindow.close(); return; }
  if (activeTabId === id) selectTab(tabs[Math.max(0, i - 1)].id);
  else broadcastTabs();
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId);
}

function tabOf(webContents) {
  return tabs.find((t) => t.view.webContents === webContents);
}

function broadcastTabs() {
  tabBarView?.webContents.send('tabs:state', {
    activeTabId,
    tabs: tabs.map(({ id, title }) => ({ id, title })),
  });
}

ipcMain.on('tabs:ready', broadcastTabs);
ipcMain.on('tabs:new', () => newTab());
ipcMain.on('tabs:select', (_e, id) => selectTab(id));
ipcMain.on('tabs:close', (_e, id) => closeTab(id));

ipcMain.on('page:title', (event, { title, pageId }) => {
  const tab = tabOf(event.sender);
  if (!tab) return;
  tab.title = title || '제목 없음';
  tab.pageId = pageId;
  broadcastTabs();
});
ipcMain.on('page:open-in-new-tab', (_e, pageId) => newTab(pageId));
// 다른 화면(검색 등)에서 페이지가 바뀌면 모든 탭이 사이드바를 새로 그림
ipcMain.on('page:changed', (event) => {
  for (const t of tabs) if (t.view.webContents !== event.sender) t.view.webContents.send('page:refresh');
});

// ---------------------------------------------------------------------------
// 빠른 검색 (테두리 없는 패널 창, 항상 위)
function openQuickSearch() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    quickSearchWindow.show();
    quickSearchWindow.focus();
    return;
  }
  const parent = mainWindow?.getBounds();
  quickSearchWindow = new BrowserWindow({
    width: 560,
    height: 380,
    x: parent ? Math.round(parent.x + parent.width / 2 - 280) : undefined,
    y: parent ? parent.y + 90 : undefined,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    ...(isMac ? { type: 'panel' } : {}),
    backgroundColor: windowBackground(),
    webPreferences: securePrefs('page.js'),
  });
  trust(quickSearchWindow.webContents);
  quickSearchWindow.loadFile(path.join(RENDERER, 'search', 'index.html'));
  quickSearchWindow.once('ready-to-show', () => quickSearchWindow.show());
  // 한 번이라도 포커스를 받은 뒤에 다른 곳을 누르면 닫힘
  let hadFocus = false;
  quickSearchWindow.on('focus', () => { hadFocus = true; });
  quickSearchWindow.on('blur', () => { if (hadFocus) quickSearchWindow?.close(); });
  quickSearchWindow.on('closed', () => { quickSearchWindow = null; });
}

ipcMain.on('search:open-page', (_e, { pageId, newTab: inNewTab }) => {
  quickSearchWindow?.close();
  if (!mainWindow) createMainWindow();
  if (inNewTab || !activeTab()) newTab(pageId);
  else activeTab().view.webContents.send('page:navigate', pageId);
  mainWindow.focus();
});
ipcMain.on('search:open', () => openQuickSearch());
ipcMain.on('search:close', () => quickSearchWindow?.close());

// ---------------------------------------------------------------------------
// 개발자용 DB 뷰어
function openDbViewer() {
  if (dbViewerWindow && !dbViewerWindow.isDestroyed()) {
    dbViewerWindow.focus();
    return;
  }
  dbViewerWindow = new BrowserWindow({
    width: 1000,
    height: 640,
    title: 'DB 뷰어',
    webPreferences: securePrefs('page.js'),
  });
  trust(dbViewerWindow.webContents);
  dbViewerWindow.loadFile(path.join(RENDERER, 'db_viewer', 'index.html'));
  dbViewerWindow.on('closed', () => { dbViewerWindow = null; });
}

function editCommand(kind) {
  const wc = require('electron').webContents.getFocusedWebContents();
  if (!wc) return;
  if (tabOf(wc)) wc.send('edit:history', kind);
  else wc[kind]();
}

async function resetSampleData() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['초기화', '취소'],
    defaultId: 1,
    cancelId: 1,
    message: '모든 페이지를 지우고 예시 데이터로 되돌릴까요?',
    detail: '지금 있는 페이지가 모두 지워지고 예시 문서만 남아요. 되돌릴 수 없어요.',
  });
  if (response === 0) sqliteServer.postMessage({ command: 'reset' });
}

// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '파일',
      submenu: [
        { label: '새 탭', accelerator: 'CmdOrCtrl+T', click: () => (mainWindow ? newTab() : createMainWindow()) },
        { label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: () => activeTab() && closeTab(activeTabId) },
        { type: 'separator' },
        { label: '빠른 검색', accelerator: 'CmdOrCtrl+P', click: openQuickSearch },
      ],
    },
    {
      label: '편집',
      submenu: [
        // 페이지 화면에서는 브라우저 기본 실행 취소 대신 블록 단위 실행 취소(transactions)를 씀
        { label: '실행 취소', accelerator: 'CmdOrCtrl+Z', click: () => editCommand('undo') },
        { label: '다시 실행', accelerator: 'Shift+CmdOrCtrl+Z', click: () => editCommand('redo') },
        { type: 'separator' },
        { role: 'cut', label: '오려두기' },
        { role: 'copy', label: '복사하기' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '전체 선택' },
      ],
    },
    {
      label: '보기',
      submenu: [
        {
          label: '다음 탭', accelerator: 'Ctrl+Tab',
          click: () => { const i = tabs.indexOf(activeTab()); if (tabs.length) selectTab(tabs[(i + 1) % tabs.length].id); },
        },
        { type: 'separator' },
        {
          label: '테마',
          submenu: Object.entries(THEMES).map(([value, label]) => ({
            label, type: 'radio', checked: settings.theme === value,
            click: () => { applyTheme(value); saveSettings(); },
          })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '개발자',
      submenu: [
        { label: 'DB 뷰어', accelerator: 'CmdOrCtrl+Alt+I', click: openDbViewer },
        { label: '현재 탭 개발자 도구', accelerator: 'CmdOrCtrl+Shift+I', click: () => activeTab()?.view.webContents.toggleDevTools() },
        { label: '탭 막대 개발자 도구', click: () => tabBarView?.webContents.toggleDevTools() },
        { label: 'DB 폴더 열기', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: '예시 데이터로 초기화…', click: resetSampleData },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('MiniNote');
app.whenReady().then(() => {
  loadSettings();
  applyTheme(settings.theme);
  // '시스템 설정 따르기'일 때 OS 테마가 바뀌면 창 배경도 맞춤
  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground());
  });
  startSqliteServer();
  buildMenu();
  createMainWindow();
  app.on('activate', () => { if (!mainWindow) createMainWindow(); });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('will-quit', () => sqliteServer?.kill());
