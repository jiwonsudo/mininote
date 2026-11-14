// MiniNote.app 만들기: npm run package
// 내 코드는 app.asar 로 묶고, 네이티브 모듈(.node)만 밖(app.asar.unpacked)에 둔다.
const { packager } = require('@electron/packager');
const path = require('node:path');

packager({
  dir: path.join(__dirname, '..'),
  out: path.join(__dirname, '..', 'dist'),
  name: 'MiniNote',
  executableName: 'MiniNote',
  appBundleId: 'dev.mininote.app',
  appCategoryType: 'public.app-category.productivity',
  icon: path.join(__dirname, '..', 'build', 'icon.icns'),
  platform: process.platform,
  arch: process.arch,
  asar: { unpack: '**/*.node' },
  prune: true,
  overwrite: true,
  ignore: [/^\/build($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/README\.md$/, /^\/\.gitignore$/],
}).then((paths) => console.log('created:', paths.join(', ')));
