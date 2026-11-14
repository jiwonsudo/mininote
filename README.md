# MiniNote

Electron 기반 블록형 메모 앱이에요. [Claude Code](https://claude.com/claude-code)로 만들었어요.

문단, 제목, 할 일, 토글, 표 같은 모든 내용이 **블록** 하나하나로 저장되고, 데이터는 전부 내 컴퓨터의 SQLite 파일에 남아요. 서버나 계정은 필요 없어요.

## 실행 방법

### 준비물

- [Node.js](https://nodejs.org/) 20 이상 (npm 포함)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Visual Studio Build Tools의 "C++를 사용한 데스크톱 개발"

`better-sqlite3`가 네이티브 모듈이라, 설치할 때 내 컴퓨터의 Electron 버전에 맞춰 직접 빌드해요. 위의 빌드 도구는 이때 필요해요.

### 1. 내려받고 설치하기

```bash
git clone https://github.com/jiwonsudo/mininote.git
cd mininote
npm install
```

`npm install`이 끝나면 `postinstall` 스크립트가 `better-sqlite3`를 Electron용으로 자동으로 다시 빌드해요.

### 2. 개발 모드로 실행하기

```bash
npm start
```

macOS에서는 개발 모드일 때 Dock에 "Electron"이라는 이름으로 보여요.

### 3. 앱으로 묶기

```bash
npm run package
```

지금 쓰는 컴퓨터의 OS와 CPU에 맞는 앱이 `dist/` 아래에 만들어져요 (예: `dist/MiniNote-darwin-arm64/MiniNote.app`). 코드는 `app.asar`로 묶이고, 네이티브 모듈만 `app.asar.unpacked`에 따로 들어가요.

서명하지 않은 앱이라 macOS에서 처음 열 때 "확인되지 않은 개발자" 경고가 떠요. Finder에서 앱을 **오른쪽 클릭 → 열기**로 한 번 열면 그다음부터는 바로 열려요.

### 기타 명령

| 명령 | 하는 일 |
|---|---|
| `npm run icon` | `scripts/make-icon.js`로 `build/icon.png`, `build/icon.icns` 다시 만들기 (macOS) |
| `npm run rebuild` | `better-sqlite3`만 다시 빌드 (Electron 버전을 바꿨거나 "NODE_MODULE_VERSION" 오류가 날 때) |

## 데이터와 설정 파일

모든 파일은 앱 데이터 폴더에 있어요. 메뉴 `개발자 > DB 폴더 열기`로 바로 열 수 있어요.

| OS | 폴더 |
|---|---|
| macOS | `~/Library/Application Support/MiniNote/` |
| Windows | `%APPDATA%\MiniNote\` |
| Linux | `~/.config/MiniNote/` |

| 파일 | 내용 |
|---|---|
| `mininote.db` | 모든 페이지와 블록 (SQLite, WAL 모드, 권한 0600) |
| `settings.json` | 앱 설정 (테마) |

처음 열면 사용법이 담긴 **👋 시작하기** 페이지가 들어 있어요. 처음 상태로 돌리려면 메뉴 `개발자 > 예시 데이터로 초기화…`를 쓰거나, 앱을 끄고 `mininote.db*` 파일을 지우면 돼요.

## 설정

### 테마 (라이트 / 다크 / 시스템)

메뉴 **보기 > 테마**에서 셋 중 하나를 골라요. 고르는 즉시 열려 있는 모든 창(탭, 빠른 검색, DB 뷰어)에 적용되고, 다음에 앱을 열 때도 그대로 유지돼요.

| 선택 | 동작 |
|---|---|
| 시스템 설정 따르기 (기본값) | OS의 라이트/다크 설정을 따라가요. 앱을 켜 둔 채 OS 설정을 바꿔도 바로 바뀌어요. |
| 라이트 모드 | OS 설정과 상관없이 항상 밝은 화면 |
| 다크 모드 | OS 설정과 상관없이 항상 어두운 화면 |

선택한 값은 `settings.json`에 저장돼요.

```json
{
  "theme": "system"
}
```

`theme` 값은 `"system"`, `"light"`, `"dark"` 중 하나예요. 파일을 직접 고쳐도 되고, 이 셋이 아닌 값이 들어 있으면 `"system"`으로 처리해요.

동작 방식: main 프로세스가 Electron의 `nativeTheme.themeSource`를 바꾸면, 모든 화면의 CSS `prefers-color-scheme`이 같이 바뀌어요. 색은 [`src/renderer/shared/base.css`](src/renderer/shared/base.css)의 CSS 변수(`--bg`, `--text`, `--accent` …)로 정해져 있어서, 색을 바꾸고 싶으면 이 파일만 고치면 돼요.

## 기능

- 블록 종류: 텍스트, 제목 1~6, 할 일, 글머리 기호, 번호 목록, 토글, 인용, 콜아웃, 코드, 구분선, 표, 목차, 하위 페이지
- 서식: 굵게, 기울임, 취소선, 인라인 코드, 링크
- 블록 선택, 드래그로 옮기기, 들여쓰기, 블록 단위 실행 취소/다시 실행
- 여러 탭, 빠른 검색 창
- 라이트 / 다크 / 시스템 테마
- 개발자용 DB 뷰어: 편집하는 동안 SQLite 표가 바뀌는 모습을 실시간으로 보기

## 단축키

| 동작 | 키 |
|---|---|
| 블록 종류 메뉴 | `/` |
| 제목 1~6 / 글머리 / 번호 / 할 일 | `#`~`######`, `- `, `1. `, `[] ` (뒤에 띄어쓰기) |
| 토글 / 인용 / 콜아웃 / 코드 / 구분선 | `> `, `" `, `! `, ` ``` `, `---` |
| 굵게 / 기울임 / 취소선 / 코드 / 링크 | ⌘B / ⌘I / ⇧⌘S / ⌘E / ⌘K |
| 줄바꿈 (같은 블록 안) | ⇧Enter |
| 실행 취소 / 다시 실행 | ⌘Z / ⇧⌘Z |
| 들여쓰기 / 내어쓰기 | Tab / ⇧Tab |
| 블록 위아래로 옮기기 | ⌘⇧↑ / ⌘⇧↓ |
| 블록 선택 | Esc, 왼쪽 ⋮⋮ 손잡이 클릭, 빈 여백에서 드래그 |
| 선택한 블록 지우기 / 범위 넓히기 / 전체 선택 | Backspace / ⇧↑↓ / ⌘A |
| 빠른 검색 / 새 탭 / 탭 닫기 / 다음 탭 | ⌘P / ⌘T / ⌘W / ⌃Tab |
| 링크·페이지를 새 탭에서 열기 | ⌘클릭 |
| DB 뷰어 | ⌘⌥I |

Windows와 Linux에서는 ⌘ 대신 Ctrl을 써요.

## 구조

```
main.js (메인 프로세스)
 ├─ BrowserWindow
 │   ├─ WebContentsView: 탭 막대 (renderer/tabs)
 │   └─ WebContentsView × N: 페이지 (renderer/page)  ─┐
 ├─ BrowserWindow: 빠른 검색 (renderer/search)        ─┤ 각자 MessagePort 받음
 ├─ BrowserWindow: DB 뷰어 (renderer/db_viewer)        ─┤
 └─ utilityProcess: sqlite-server.js  ◀────────────────┘ 직통 통로 (main을 거치지 않음)
        └─ better-sqlite3 → mininote.db
```

- **SQLite 서버**는 별도 utility process에서 돌아가고, 각 화면은 main이 만들어 준 `MessagePort`로 서버와 직접 대화해요.
- 편집은 **operation** 묶음(`set`, `update`, `insertAfter`, `insertBefore`, `remove`)으로 만들어져 `block` 표에 반영되고, `transactions` 표에 기록돼요. 페이지 오른쪽 아래 `⚡ transactions`에서 실시간으로 볼 수 있어요.
- main이 직접 만든 화면만 DB 통로를 받을 수 있게 막아 두었어요(`trust()`). 모든 화면은 `sandbox`, `contextIsolation`을 켜고 `nodeIntegration`을 끈 상태로 떠요.

| 폴더 | 내용 |
|---|---|
| `src/main` | 메인 프로세스(창, 메뉴, 설정), SQLite 서버, 예시 문서 |
| `src/preload` | 화면별 preload (`contextBridge`) |
| `src/renderer/page` | 편집 화면 |
| `src/renderer/shared` | 블록 저장소, 서식, SQLite 클라이언트, 공통 스타일(테마 색) |
| `src/renderer/tabs`, `search`, `db_viewer` | 탭 막대, 빠른 검색, DB 뷰어 |
| `scripts` | 앱 묶기, 아이콘 만들기 |
| `build` | 앱 아이콘 |

## 라이선스

[MIT](LICENSE)
