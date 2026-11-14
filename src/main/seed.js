// MiniNote를 처음 열면 보이는 예시 문서 (사용법 + 연습장)
//
// 글 안의 간단한 표시는 서식으로 바뀐다:
//   **굵게**  *기울임*  ~~취소선~~  `코드`  [글자](주소)

// ---------------------------------------------------------------------------
// 서식 표시 → title 형식 [["글자", [["b"]]], ...]
function md(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*(.+?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push([text.slice(last, m.index)]);
    if (m[1]) out.push([m[1], [['b']]]);
    else if (m[2]) out.push([m[2], [['s']]]);
    else if (m[3]) out.push([m[3], [['c']]]);
    else if (m[4]) out.push([m[4], [['a', m[5]]]]);
    else if (m[6]) out.push([m[6], [['i']]]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push([text.slice(last)]);
  return out;
}

// 블록 만들기 도우미
const node = (type, text = '', children = [], extra = {}) => ({ type, text, children, ...extra });
const h1 = (t) => node('header', t);
const h2 = (t) => node('sub_header', t);
const h3 = (t) => node('sub_sub_header', t);
const h4 = (t) => node('header_4', t);
const p = (t, kids) => node('text', t, kids);
const ul = (t, kids) => node('bulleted_list', t, kids);
const ol = (t, kids) => node('numbered_list', t, kids);
const todo = (t, done = false) => node('to_do', t, [], { checked: done });
const toggle = (t, kids) => node('toggle', t, kids);
const callout = (icon, t, kids) => node('callout', t, kids, { icon });
const quote = (t) => node('quote', t);
const code = (t) => node('code', t, [], { plain: true });
const hr = () => node('divider');
const toc = () => node('table_of_contents');
const page = (t, kids) => node('page', t, kids, { plain: true });
const table = (...rows) => node('table', '', [], { rows });


const GUIDE = page('👋 시작하기', [
  callout('👋', '**MiniNote**는 Electron으로 만든 블록형 메모 앱이에요. 모든 내용은 내 컴퓨터의 SQLite 파일에 저장돼요.'),
  toc(),
  h1('사용법'),
  h2('블록 만들기'),
  p('빈 줄에서 `/` 를 누르거나, 줄 맨 앞에 아래처럼 쳐요.'),
  table(
    ['입력', '블록', '입력', '블록'],
    ['`#` ~ `######` + 띄어쓰기', '제목 1 ~ 6', '`-` 또는 `*` + 띄어쓰기', '글머리 기호'],
    ['`1.` + 띄어쓰기', '번호 목록', '`[]` + 띄어쓰기', '할 일'],
    ['`>` + 띄어쓰기', '토글', '큰따옴표 + 띄어쓰기', '인용'],
    ['`!` + 띄어쓰기', '콜아웃', '백틱 3개', '코드'],
    ['`---`', '구분선', '`/표`, `/목차`', '표, 목차'],
  ),
  h2('글씨 서식'),
  p('글자를 드래그하면 도구 막대가 떠요: **굵게** ⌘B, *기울임* ⌘I, ~~취소선~~ ⇧⌘S, `코드` ⌘E, [링크](https://github.com) ⌘K (⌘클릭으로 열기)'),
  h2('블록 선택 · 지우기 · 옮기기'),
  ul('블록 왼쪽 **⋮⋮ 손잡이**를 클릭하면 선택, *끌면 옮기기* (오른쪽으로 끌어 놓으면 안쪽으로 넣기)'),
  ul('글을 쓰다가 **Esc** → 지금 블록 선택'),
  ul('글자를 끌다가 다른 블록까지 가면 여러 블록 선택, 빈 여백에서 끌면 사각형 선택'),
  ul('선택한 상태에서: Backspace 지우기, ↑↓ 이동, ⇧↑↓ 범위 넓히기, Enter 편집'),
  ul('⌘⇧↑ / ⌘⇧↓ 블록을 위아래로 옮기기 (편집 중에도 됨)'),
  h2('기타'),
  ul('Tab / ⇧Tab 들여쓰기, Shift+Enter 줄바꿈, ⌘Z / ⇧⌘Z 실행 취소'),
  ul('⌘P 빠른 검색, ⌘T 새 탭, ⌘클릭 새 탭에서 열기'),
  ul('오른쪽 아래 ⚡ transactions: 방금 보낸 operations 보기'),
  h2('연습장'),
  todo('이 줄을 체크해 보기'),
  todo('아래 블록 두 개를 손잡이로 끌어서 순서 바꿔 보기'),
  p('🍎 첫 번째 블록'),
  p('🍌 두 번째 블록'),
  toggle('토글 안에 블록을 끌어다 넣어 보세요', []),
]);


const PAGES = [GUIDE];

// ---------------------------------------------------------------------------
// 트리 → block 표의 행
function buildSeedRows(pages = PAGES, startClock = 1) {
  const rows = [];
  let clock = startClock; // 예시 페이지가 사이드바 맨 위에 오도록 아주 이른 시각을 씀

  function build(n, parentId, parentTable) {
    const id = crypto.randomUUID();
    const properties = { title: n.plain ? (n.text ? [[n.text]] : []) : md(n.text) };
    if (n.type === 'to_do') properties.checked = n.checked;
    if (n.rows) properties.rows = n.rows.map((r) => r.map(md));
    const row = {
      id,
      type: n.type,
      properties,
      format: n.icon ? { icon: n.icon } : {},
      parent_id: parentId,
      parent_table: parentTable,
      created_time: clock++,
      content: [],
    };
    rows.push(row);
    row.content = n.children.map((c) => build(c, id, 'block'));
    return id;
  }

  for (const pg of pages) build(pg, 'local', 'space');
  return rows;
}

module.exports = { buildSeedRows, GUIDE, SEED_VERSION: '1' };
