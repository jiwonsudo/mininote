// 블록 저장소
// 모든 내용은 블록이고, 수정은 operations 묶음(transaction)으로 기록한다.
//
// operation 모양
//   { command: 'set' | 'update' | 'insertAfter' | 'insertBefore' | 'remove',
//     id, field?, args }   (field가 없으면 블록 자체, 있으면 그 칸: 'content' / 'properties')
(function () {
  const blocks = new Map(); // id → block (메모리 캐시)

  function parse(row) {
    return {
      ...row,
      properties: row.properties ? JSON.parse(row.properties) : {},
      content: row.content ? JSON.parse(row.content) : [],
      format: row.format ? JSON.parse(row.format) : {},
    };
  }

  function cache(rows) {
    for (const r of rows) blocks.set(r.id, parse(r));
  }

  function get(id) {
    return blocks.get(id);
  }

  function textOf(block) {
    return (block?.properties?.title ?? []).map((part) => part[0]).join('');
  }

  // 페이지와 그 아래 블록 전부 (하위 page 블록의 내용은 제외)
  async function loadPage(pageId) {
    const rows = await Sqlite.query(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM block WHERE id = ?
         UNION ALL
         SELECT b.id FROM block b JOIN tree t ON b.parent_id = t.id
         JOIN block p ON p.id = t.id
         WHERE b.alive = 1 AND (p.id = ? OR p.type != 'page')
       )
       SELECT block.* FROM block JOIN tree ON block.id = tree.id`,
      [pageId, pageId],
    );
    cache(rows);
    return get(pageId);
  }

  async function loadTopPages() {
    const rows = await Sqlite.query(
      `SELECT * FROM block WHERE type = 'page' AND parent_table = 'space' AND alive = 1
       ORDER BY created_time`,
    );
    cache(rows);
    return rows.map((r) => get(r.id));
  }

  async function loadAncestors(id) {
    const rows = await Sqlite.query(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM block WHERE id = ?
         UNION ALL
         SELECT b.id, b.parent_id, up.depth + 1 FROM block b JOIN up ON b.id = up.parent_id
       )
       SELECT block.* FROM block JOIN up ON block.id = up.id
       WHERE block.type = 'page' ORDER BY up.depth DESC`,
      [id],
    );
    cache(rows);
    return rows.map((r) => get(r.id));
  }

  // operation을 메모리 캐시에 적용
  function apply(op) {
    const { command, id, field, args } = op;
    const now = Date.now();
    if (command === 'set') {
      blocks.set(id, {
        alive: 1, version: 0, content: [], properties: {}, format: {},
        created_time: now, ...args, id,
      });
    }
    const b = blocks.get(id);
    if (!b) throw new Error(`unknown block ${id}`);

    if (command === 'update') {
      if (!field) Object.assign(b, args);
      else b[field] = { ...b[field], ...args };
    } else if (command === 'insertAfter' || command === 'insertBefore') {
      const list = b[field].filter((x) => x !== args.id);
      const anchor = command === 'insertAfter' ? args.after : args.before;
      let i = anchor ? list.indexOf(anchor) : -1;
      if (i < 0) i = command === 'insertAfter' ? list.length : 0;
      else if (command === 'insertAfter') i += 1;
      list.splice(i, 0, args.id);
      b[field] = list;
    } else if (command === 'remove') {
      b[field] = b[field].filter((x) => x !== args.id);
    }
    b.last_edited_time = now;
    return b.id;
  }

  const UPSERT = `INSERT INTO block
    (id, type, properties, content, format, parent_id, parent_table, alive, version, created_time, last_edited_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, properties = excluded.properties, content = excluded.content,
      format = excluded.format, parent_id = excluded.parent_id, parent_table = excluded.parent_table,
      alive = excluded.alive, version = excluded.version, last_edited_time = excluded.last_edited_time`;

  const listeners = new Set();
  const undoStack = [];
  const redoStack = [];
  const snapshot = (id) => (blocks.has(id) ? structuredClone(blocks.get(id)) : null);

  // operations 묶음 → 캐시 반영 → SQL 배치 → transactions 표 기록
  // 바뀌기 전/후 모습을 기억해 두었다가 실행 취소(undo)에 씀 (transactions.is_undo)
  async function submit(operations, { kind } = {}) {
    const before = new Map();
    for (const o of operations) if (!before.has(o.id)) before.set(o.id, snapshot(o.id));

    const touched = new Set(operations.map(apply));
    const body = [];
    for (const id of touched) {
      const b = blocks.get(id);
      b.version += 1;
      body.push({
        sql: UPSERT,
        args: [
          b.id, b.type, JSON.stringify(b.properties), JSON.stringify(b.content), JSON.stringify(b.format),
          b.parent_id, b.parent_table, b.alive, b.version, b.created_time, b.last_edited_time,
        ],
      });
    }
    body.push({
      sql: 'INSERT INTO transactions (id, operations, timestamp, is_undo) VALUES (?, ?, ?, ?)',
      args: [crypto.randomUUID(), JSON.stringify(operations), Date.now(), kind ? 1 : 0],
    });
    await Sqlite.batch(body);

    if (!kind) {
      const after = new Map([...touched].map((id) => [id, snapshot(id)]));
      undoStack.push({ before, after });
      if (undoStack.length > 200) undoStack.shift();
      redoStack.length = 0;
    }
    for (const fn of listeners) fn(operations, kind);
  }

  function restoreOps(states) {
    return [...states].map(([id, snap]) => {
      if (!snap) return { command: 'update', id, args: { alive: 0 } };
      const { id: _id, version: _v, ...args } = snap;
      return { command: 'set', id, args: { ...args, version: blocks.get(id)?.version ?? 0 } };
    });
  }

  async function undo() {
    const entry = undoStack.pop();
    if (!entry) return null;
    await submit(restoreOps(entry.before), { kind: 'undo' });
    redoStack.push(entry);
    return [...entry.before.keys()];
  }

  async function redo() {
    const entry = redoStack.pop();
    if (!entry) return null;
    await submit(restoreOps(entry.after), { kind: 'redo' });
    undoStack.push(entry);
    return [...entry.after.keys()];
  }

  // 자주 쓰는 operation 만들기
  const op = {
    create: (id, fields) => ({ command: 'set', id, args: fields }),
    update: (id, args) => ({ command: 'update', id, args }),
    insertAfter: (parentId, id, after) => ({
      command: 'insertAfter', id: parentId, field: 'content', args: after ? { id, after } : { id },
    }),
    insertBefore: (parentId, id, before) => ({
      command: 'insertBefore', id: parentId, field: 'content', args: before ? { id, before } : { id },
    }),
    remove: (parentId, id) => ({
      command: 'remove', id: parentId, field: 'content', args: { id },
    }),
    setTitle: (id, segs) => ({ command: 'update', id, field: 'properties', args: { title: segs } }),
    setText: (id, text) => ({ command: 'update', id, field: 'properties', args: { title: text ? [[text]] : [] } }),
    setChecked: (id, checked) => ({ command: 'update', id, field: 'properties', args: { checked } }),
  };

  const titleOf = (block) => block?.properties?.title ?? [];
  const isChecked = (block) => block?.properties?.checked === true;

  window.Store = {
    get, textOf, titleOf, isChecked, undo, redo, loadPage, loadTopPages, loadAncestors, submit, op,
    onSubmit: (fn) => listeners.add(fn),
    newId: () => crypto.randomUUID(),
  };
})();
