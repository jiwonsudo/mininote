// 개발자용 DB 뷰어
// 이 창도 DB 통로를 받아 SQL을 그대로 보낸다. 다른 탭에서 글을 쓰면 표가 바로 바뀌는 걸 볼 수 있다.
const sqlEl = document.getElementById('sql');
const out = document.getElementById('out');
const status = document.getElementById('status');
const live = document.getElementById('live');
let lastRows = new Map();

sqlEl.value = `SELECT id, type, properties, parent_id, content, version
FROM block WHERE alive = 1
ORDER BY last_edited_time DESC LIMIT 50`;

async function loadTables() {
  const rows = await Sqlite.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  document.getElementById('tables').replaceChildren(...rows.map(({ name }) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      sqlEl.value = name === 'transactions'
        ? 'SELECT timestamp, operations FROM transactions ORDER BY timestamp DESC LIMIT 50'
        : `SELECT * FROM ${name} LIMIT 100`;
      run();
    });
    return b;
  }));
}

async function run() {
  const t0 = performance.now();
  try {
    const rows = await Sqlite.query(sqlEl.value);
    draw(Array.isArray(rows) ? rows : [rows]);
    status.textContent = `${Array.isArray(rows) ? rows.length : 1}행 · ${(performance.now() - t0).toFixed(1)}ms`;
  } catch (e) {
    out.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = e.message;
    out.append(d);
    status.textContent = '오류';
  }
}

function draw(rows) {
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const c of cols) { const th = document.createElement('th'); th.textContent = c; head.append(th); }
  const body = table.createTBody();
  const next = new Map();
  rows.forEach((r, i) => {
    const key = r.id ?? i;
    const sig = JSON.stringify(r);
    next.set(key, sig);
    const tr = body.insertRow();
    if (lastRows.size && lastRows.get(key) !== sig) tr.className = 'changed';
    for (const c of cols) {
      const td = tr.insertCell();
      td.textContent = r[c] == null ? 'NULL' : String(r[c]);
      td.title = td.textContent;
    }
  });
  lastRows = next;
  out.replaceChildren(table);
}

document.getElementById('run').addEventListener('click', () => { lastRows = new Map(); run(); });
sqlEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); lastRows = new Map(); run(); }
});
setInterval(() => { if (live.checked && /^\s*(select|with)\b/i.test(sqlEl.value)) run(); }, 1000);
loadTables().then(run);
