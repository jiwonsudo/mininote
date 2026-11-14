// SQLite 서버 (utility process)
//   - main이 utilityProcess.fork(sqlite-server.js, [userData]) 로 띄움
//   - process.parentPort 로 MessagePort를 받아서 렌더러와 직접 대화
//   - 렌더러가 보낸 { body: [{ sql, args, wantRows }] } 를 그대로 실행
//   - 결과는 { type: "rows" | "ok" | "error" }

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { buildSeedRows, SEED_VERSION } = require('./seed.js');

const dbDirectory = process.argv[2];
const dbPath = path.join(dbDirectory, 'mininote.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// DB 파일 권한 0600: 내 계정만 읽기/쓰기
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { fs.chmodSync(f, 0o600); } catch { /* 아직 없는 파일은 무시 */ }
}

// block: 모든 내용(페이지, 문단, 할 일 …)이 한 줄씩 / transactions: 수정 기록
db.exec(`
  CREATE TABLE IF NOT EXISTS block (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL,
    properties       TEXT,
    content          TEXT,
    format           TEXT,
    parent_id        TEXT,
    parent_table     TEXT,
    alive            INTEGER NOT NULL DEFAULT 1,
    version          INTEGER NOT NULL DEFAULT 1,
    created_time     REAL,
    last_edited_time REAL
  );
  CREATE INDEX IF NOT EXISTS block_parent_id ON block (parent_id);
  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    operations TEXT NOT NULL,
    timestamp  REAL NOT NULL,
    is_undo    INTEGER NOT NULL DEFAULT 0
  );
`);
// 예전 버전 DB에는 is_undo 칸이 없으므로 추가
try { db.exec('ALTER TABLE transactions ADD COLUMN is_undo INTEGER NOT NULL DEFAULT 0'); } catch { /* 이미 있음 */ }

db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
seedIfNeeded();

function log(...args) {
  process.stdout.write(`[sqlite-server] ${args.join(' ')}\n`);
}

function execStatement({ sql, args = [], wantRows }) {
  try {
    const stmt = db.prepare(sql);
    if (wantRows) {
      return { type: 'rows', data: stmt.reader ? stmt.all(...args) : stmt.run(...args) };
    }
    stmt.run(...args);
    return { type: 'ok' };
  } catch (err) {
    return { type: 'error', name: err.name, message: err.message, sqliteCode: err.code };
  }
}

// 배치 전체를 하나의 트랜잭션으로 실행 (중간에 실패하면 전부 되돌림)
const runBatch = db.transaction((body) => {
  const results = [];
  for (const statement of body) {
    const r = execStatement(statement);
    results.push(r);
    if (r.type === 'error') throw Object.assign(new Error(r.message), { results });
  }
  return results;
});

function onPortMessage(port, data) {
  if (!data || !Array.isArray(data.body)) return;
  let results;
  try {
    results = runBatch(data.body);
  } catch (err) {
    results = err.results ?? [{ type: 'error', name: err.name, message: err.message }];
  }
  port.postMessage({ id: data.id, results });
}

process.parentPort.on('message', (e) => {
  // 예시 데이터로 초기화
  if (e.data?.command === 'reset') {
    db.transaction(() => { db.exec('DELETE FROM block; DELETE FROM transactions;'); insertSeed(); })();
    log('reset to sample data');
    process.parentPort.postMessage({ type: 'reset-done' });
    return;
  }
  const { url } = e.data ?? {};
  log(`Listening to ${e.ports.length} MessagePort(s) for renderer ${url}`);
  for (const port of e.ports) {
    port.on('message', (msg) => onPortMessage(port, msg.data));
    port.start();
  }
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
log(`ready: ${dbPath}`);

// ---------------------------------------------------------------------------
// 예시 문서 (seed.js): 사용법 + 연습장
function insertRows(rows) {
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO block
    (id, type, properties, content, format, parent_id, parent_table, alive, version, created_time, last_edited_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`);
  for (const r of rows) {
    insert.run(r.id, r.type, JSON.stringify(r.properties), JSON.stringify(r.content), JSON.stringify(r.format),
      r.parent_id, r.parent_table, r.created_time, now);
  }
}

function setSeedVersion() {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)").run(SEED_VERSION);
}

function insertSeed() {
  insertRows(buildSeedRows());
  setSeedVersion();
}

// 처음 실행(빈 DB)일 때만 예시 문서 넣기
function seedIfNeeded() {
  const { n } = db.prepare('SELECT count(*) AS n FROM block').get();
  if (n === 0) db.transaction(insertSeed)();
}
