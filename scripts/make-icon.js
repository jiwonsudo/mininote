// 앱 아이콘 만들기: HTML을 Electron으로 그려 1024px PNG → macOS .icns
// 실행: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
  <div style="width:824px;height:824px;border-radius:185px;background:linear-gradient(160deg,#10b981,#065f46);
              box-shadow:0 20px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;justify-content:center;gap:58px;padding:0 150px;box-sizing:border-box">
    <div style="height:88px;width:62%;border-radius:44px;background:#fff"></div>
    <div style="height:62px;width:100%;border-radius:31px;background:rgba(255,255,255,.75)"></div>
    <div style="display:flex;gap:40px;align-items:center">
      <div style="width:62px;height:62px;border-radius:14px;background:#fff"></div>
      <div style="height:62px;flex:1;border-radius:31px;background:rgba(255,255,255,.75)"></div>
    </div>
    <div style="height:62px;width:78%;border-radius:31px;background:rgba(255,255,255,.75)"></div>
  </div>
</div></body></html>`;

app.whenReady().then(async () => {
  // 화면에 띄우지 않고 그리는 offscreen 렌더링
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(1);
  const painted = new Promise((resolve) => win.webContents.on('paint', (_e, _dirty, img) => { if (!img.isEmpty()) resolve(img); }));
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const image = await painted;
  const outDir = path.join(__dirname, '..', 'build');
  const png = path.join(outDir, 'icon.png');
  fs.writeFileSync(png, image.resize({ width: 1024, height: 1024 }).toPNG());

  const iconset = path.join(outDir, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(size), String(size), png, '--out', path.join(iconset, `icon_${size}x${size}.png`)]);
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('build/icon.icns created');
  app.quit();
});
