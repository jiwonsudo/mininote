// 빠른 검색 창
// 이 창도 메인 창과 똑같이 DB 통로(MessagePort)를 따로 받아서 직접 SQL을 보낸다.
const q = document.getElementById('q');
const resultsEl = document.getElementById('results');
let results = [];
let index = 0;
let parents = new Map();

const textOf = (props) => (JSON.parse(props || '{}').title ?? []).map((p) => p[0]).join('');

function pageOf(id) {
  let cur = parents.get(id);
  while (cur && cur.type !== 'page') cur = parents.get(cur.parent_id);
  return cur;
}

async function search() {
  const term = q.value.trim();
  const rows = await Sqlite.query(
    `SELECT id, type, properties, parent_id FROM block
     WHERE alive = 1 AND (? = '' AND type = 'page' OR ? != '' AND properties LIKE ?)
     ORDER BY type = 'page' DESC, last_edited_time DESC LIMIT 30`,
    [term, term, `%${term}%`],
  );
  if (term && !parents.size) {
    const all = await Sqlite.query('SELECT id, type, parent_id, properties FROM block WHERE alive = 1');
    parents = new Map(all.map((r) => [r.id, r]));
  }
  results = rows.map((r) => {
    const text = textOf(r.properties);
    if (r.type === 'page') return { pageId: r.id, title: `📄 ${text || '제목 없음'}`, sub: '페이지' };
    const page = pageOf(r.id);
    return page && { pageId: page.id, title: text, sub: `in 📄 ${textOf(page.properties) || '제목 없음'}` };
  }).filter((r) => r && (!term || r.title.toLowerCase().includes(term.toLowerCase()) || r.sub === '페이지'));
  index = 0;
  draw();
}

function draw() {
  if (!results.length) {
    resultsEl.innerHTML = '<div class="empty">결과 없음</div>';
    return;
  }
  resultsEl.replaceChildren(...results.map((r, i) => {
    const el = document.createElement('div');
    el.className = 'item' + (i === index ? ' selected' : '');
    el.innerHTML = '<span class="title"></span><span class="sub"></span>';
    el.querySelector('.title').textContent = r.title;
    el.querySelector('.sub').textContent = r.sub;
    el.addEventListener('click', (e) => open(r, e.metaKey || e.ctrlKey));
    return el;
  }));
  resultsEl.children[index]?.scrollIntoView({ block: 'nearest' });
}

function open(r, newTab) {
  window.electronApi.searchOpenPage(r.pageId, newTab);
}

q.addEventListener('input', search);
q.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, results.length - 1); draw(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); draw(); }
  if (e.key === 'Enter' && results[index]) open(results[index], e.metaKey || e.ctrlKey);
  if (e.key === 'Escape') window.electronApi.searchClose();
});
search();
