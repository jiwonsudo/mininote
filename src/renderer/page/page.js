// 블록 편집기
const { op } = Store;

const els = {
  title: document.getElementById('title'),
  blocks: document.getElementById('blocks'),
  pageList: document.getElementById('page-list'),
  breadcrumbs: document.getElementById('breadcrumbs'),
  slash: document.getElementById('slash-menu'),
  toolbar: document.getElementById('format-bar'),
  linkInput: document.getElementById('link-input'),
  logToggle: document.getElementById('log-toggle'),
  logPanel: document.getElementById('log-panel'),
  logList: document.getElementById('log-list'),
};

let pageId = null;
let topPageIds = [];
const openToggles = new Set();

const TEXTLESS = new Set(['page', 'divider', 'table_of_contents', 'table']); // 글을 직접 고칠 수 없는 블록
// 제목 1~6
const HEADINGS = { header: 1, sub_header: 2, sub_sub_header: 3, header_4: 4, header_5: 5, header_6: 6 };
const NO_PREFIX = new Set(['text', 'quote', 'code', 'divider', 'table_of_contents', 'table', ...Object.keys(HEADINGS)]);
const CONTINUES = new Set(['bulleted_list', 'numbered_list', 'to_do']); // Enter 치면 같은 종류가 이어지는 블록
const PLAIN_ONLY = new Set(['code']); // 서식 없는 블록

// ---------------------------------------------------------------------------
// 저장: 글자 입력은 잠깐 모았다가 저장, 구조 변경은 같은 transaction에 묶어서 저장
const pendingTitle = new Map(); // id → segments
const pendingRows = new Map(); // 표 블록 id → 칸 내용
let saveTimer = null;

function scheduleTitle(id, segs) {
  pendingTitle.set(id, segs);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => commit([]), 300);
}

function currentTitle(id) {
  return pendingTitle.get(id) ?? Store.titleOf(Store.get(id));
}

async function commit(ops) {
  clearTimeout(saveTimer);
  const titleOps = [...pendingTitle].map(([id, segs]) => op.setTitle(id, segs));
  const rowOps = [...pendingRows].map(([id, rows]) => op.update(id, { properties: { ...Store.get(id).properties, rows } }));
  pendingTitle.clear();
  pendingRows.clear();
  const all = [...titleOps, ...rowOps, ...ops];
  if (all.length === 0) return;
  await Store.submit(all);
  afterChange(all);
}

function afterChange(ops) {
  window.electronApi.notifyChanged();
  fillToc();
  if (ops.some((o) => o.id === pageId || topPageIds.includes(o.id) || o.args?.type === 'page' || o.command === 'set')) {
    updateChrome();
  }
}

// ---------------------------------------------------------------------------
// 화면 그리기
function renderBlock(id) {
  const b = Store.get(id);
  if (!b || !b.alive) return null;

  const block = document.createElement('div');
  block.className = 'block';
  block.dataset.id = id;
  block.dataset.type = b.type;

  const row = document.createElement('div');
  row.className = 'row';
  const prefix = document.createElement('div');
  prefix.className = 'prefix';

  const text = document.createElement('div');
  text.className = 'text';
  text.dataset.id = id;
  text.spellcheck = false;

  if (TEXTLESS.has(b.type)) {
    text.tabIndex = 0;
    if (b.type === 'page') {
      prefix.textContent = '📄';
      text.textContent = Store.textOf(b) || '제목 없음';
    } else if (b.type === 'table_of_contents') {
      text.classList.add('toc');
    } else if (b.type === 'table') {
      text.classList.add('table-wrap');
      text.tabIndex = -1;
      text.append(renderTable(b));
    } else {
      text.append(document.createElement('hr'));
    }
  } else {
    text.contentEditable = PLAIN_ONLY.has(b.type) ? 'plaintext-only' : 'true';
    Rich.toDom(text, Store.titleOf(b));
  }

  switch (b.type) {
    case 'toggle': {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.textContent = '▶';
      btn.tabIndex = -1;
      prefix.append(btn);
      block.dataset.open = String(openToggles.has(id));
      break;
    }
    case 'to_do': {
      const box = document.createElement('button');
      box.className = 'check';
      box.tabIndex = -1;
      box.setAttribute('role', 'checkbox');
      prefix.append(box);
      block.dataset.checked = String(Store.isChecked(b));
      break;
    }
    case 'callout': prefix.textContent = b.format?.icon ?? '💡'; break;
    default:
  }
  if (b.type in HEADINGS) block.dataset.level = HEADINGS[b.type];

  // 왼쪽 손잡이: 클릭하면 블록 선택, 끌면 블록 옮기기
  const handle = document.createElement('div');
  handle.className = 'handle';
  handle.draggable = true;
  handle.title = '클릭: 블록 선택 · 드래그: 옮기기';
  handle.textContent = '⋮⋮';
  row.append(handle);

  if (!NO_PREFIX.has(b.type)) row.append(prefix);
  row.append(text);
  block.append(row);

  if (!TEXTLESS.has(b.type)) {
    const kids = b.content.map(renderBlock).filter(Boolean);
    if (kids.length || b.type === 'toggle') {
      const children = document.createElement('div');
      children.className = 'children';
      children.append(...kids);
      numberLists(kids);
      block.append(children);
    }
  }
  return block;
}

// 표 블록 (properties.rows = [[칸, 칸, …], …], 첫 줄은 머리글)
function renderTable(b) {
  const rows = b.properties.rows?.length ? b.properties.rows : [[[], []], [[], []]];
  const table = document.createElement('table');
  rows.forEach((row, r) => {
    const tr = table.insertRow();
    row.forEach((cell, c) => {
      const td = document.createElement(r === 0 ? 'th' : 'td');
      td.contentEditable = 'true';
      td.spellcheck = false;
      td.dataset.r = r;
      td.dataset.c = c;
      Rich.toDom(td, cell);
      tr.append(td);
    });
  });
  const wrap = document.createElement('div');
  const add = document.createElement('button');
  add.className = 'add-row';
  add.textContent = '+ 행 추가';
  add.tabIndex = -1;
  wrap.append(table, add);
  return wrap;
}

function readTable(wrapEl) {
  return [...wrapEl.querySelectorAll('tr')].map((tr) => [...tr.cells].map((td) => Rich.fromDom(td)));
}

function scheduleRows(id, rows) {
  pendingRows.set(id, rows);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => commit([]), 300);
}

// 번호 목록: 연속된 numbered_list 끼리 1, 2, 3 …
function numberLists(blockEls) {
  let n = 0;
  for (const el of blockEls) {
    if (el.dataset.type === 'numbered_list') {
      n += 1;
      el.querySelector(':scope > .row > .prefix').textContent = `${n}.`;
    } else n = 0;
  }
}

function render(focus) {
  const page = Store.get(pageId);
  if (document.activeElement !== els.title) els.title.textContent = Store.textOf(page);
  const kids = page.content.map(renderBlock).filter(Boolean);
  numberLists(kids);
  els.blocks.replaceChildren(...kids);
  hideToolbar();
  fillToc();
  paintSelection();
  if (focus) focusBlock(focus.id, focus.offset, focus.end);
}

// 목차 블록: 페이지 안의 제목들을 모아서 보여줌
function fillToc() {
  const tocs = els.blocks.querySelectorAll('.text.toc');
  if (!tocs.length) return;
  const heads = [...els.blocks.querySelectorAll('.block[data-level]')];
  for (const toc of tocs) {
    toc.replaceChildren(...heads.map((h) => {
      const btn = document.createElement('button');
      btn.className = `toc-item lv${h.dataset.level}`;
      btn.tabIndex = -1;
      btn.textContent = h.querySelector(':scope > .row > .text').textContent || '제목 없음';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        h.classList.remove('flash');
        void h.offsetWidth;
        h.classList.add('flash');
      });
      return btn;
    }));
    if (!heads.length) toc.textContent = '제목 블록을 추가하면 여기에 목차가 생겨요';
  }
}

function rerenderBlock(id) {
  const old = els.blocks.querySelector(`.block[data-id="${id}"]`);
  const fresh = renderBlock(id);
  if (old && fresh) old.replaceWith(fresh);
}

function focusBlock(id, offset = 0, end = offset) {
  const el = textEl(id);
  if (!el) return;
  if (el.isContentEditable) Caret.select(el, offset, end);
  else el.focus();
}

const textEl = (id) => els.blocks.querySelector(`.text[data-id="${id}"]`);
const visibleTexts = () => [...els.blocks.querySelectorAll('.text')].filter((el) => el.offsetParent !== null);

async function updateChrome() {
  const [pages, ancestors] = await Promise.all([Store.loadTopPages(), Store.loadAncestors(pageId)]);
  topPageIds = pages.map((p) => p.id);
  const rootId = ancestors[0]?.id;

  els.pageList.replaceChildren(...pages.map((p) => {
    const a = document.createElement('div');
    a.className = 'page-link' + (p.id === rootId ? ' active' : '');
    a.role = 'button';
    a.innerHTML = '<span>📄</span><span class="name"></span><button class="del" title="휴지통으로">✕</button>';
    a.querySelector('.name').textContent = Store.textOf(p) || '제목 없음';
    a.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return deletePage(p.id);
      if (e.metaKey || e.ctrlKey) window.electronApi.openInNewTab(p.id);
      else navigate(p.id);
    });
    return a;
  }));

  els.breadcrumbs.replaceChildren(...ancestors.flatMap((p, i) => {
    const btn = document.createElement('button');
    btn.textContent = Store.textOf(p) || '제목 없음';
    btn.addEventListener('click', () => navigate(p.id));
    if (i === 0) return [btn];
    const sep = document.createElement('span');
    sep.textContent = '/';
    return [sep, btn];
  }));

  const title = Store.textOf(Store.get(pageId)) || '제목 없음';
  document.title = title;
  window.electronApi.setTitle(title, pageId);
}

async function navigate(id) {
  await commit([]);
  closeSlash();
  let page = id && (await Store.loadPage(id));
  if (!page || !page.alive) {
    const pages = await Store.loadTopPages();
    page = pages[0] ? await Store.loadPage(pages[0].id) : await createTopPage();
  }
  pageId = page.id;
  history.replaceState(null, '', `?pageId=${pageId}`);
  render();
  await updateChrome();
  document.getElementById('main').scrollTop = 0;
  if (!Store.textOf(page)) els.title.focus();
}

async function createTopPage() {
  const id = Store.newId();
  await commit([op.create(id, { type: 'page', properties: { title: [] }, parent_id: 'local', parent_table: 'space' })]);
  return Store.loadPage(id);
}

async function deletePage(id) {
  await commit([op.update(id, { alive: 0 })]);
  const ancestors = await Store.loadAncestors(pageId);
  if (ancestors.some((p) => p.id === id)) await navigate(null);
  else await updateChrome();
}

// ---------------------------------------------------------------------------
// 편집 동작
async function insertAfter(b, { type = 'text', title = [], beforeTitle }) {
  const id = Store.newId();
  const ops = [];
  if (beforeTitle !== undefined) {
    pendingTitle.delete(b.id);
    ops.push(op.setTitle(b.id, beforeTitle));
  }
  const fields = { type, properties: { title }, parent_table: 'block' };
  if (type === 'to_do') fields.properties.checked = false;
  if (b.type === 'toggle' && openToggles.has(b.id)) {
    ops.push(op.create(id, { ...fields, parent_id: b.id }), op.insertBefore(b.id, id));
  } else {
    ops.push(op.create(id, { ...fields, parent_id: b.parent_id }), op.insertAfter(b.parent_id, id, b.id));
  }
  await commit(ops);
  render({ id, offset: 0 });
}

async function insertText(el, b, text) {
  const caret = Caret.get(el) ?? { start: 0, end: 0 };
  const segs = Rich.insert(Rich.fromDom(el), caret.start, caret.end, text);
  Rich.toDom(el, segs);
  Caret.set(el, caret.start + text.length);
  scheduleTitle(b.id, segs);
}

async function onEnter(el, b) {
  const segs = Rich.fromDom(el);
  const len = Rich.plain(segs).length;
  const caret = Caret.get(el) ?? { start: len, end: len };
  if (len === 0 && b.type !== 'text') {
    await commit([op.update(b.id, { type: 'text' })]);
    return render({ id: b.id, offset: 0 });
  }
  await insertAfter(b, {
    type: CONTINUES.has(b.type) ? b.type : 'text',
    title: Rich.slice(segs, caret.end),
    beforeTitle: Rich.slice(segs, 0, caret.start),
  });
}

async function onBackspace(el, b) {
  if (b.type !== 'text') {
    await commit([op.update(b.id, { type: 'text' })]);
    return render({ id: b.id, offset: 0 });
  }
  if (b.parent_id !== pageId) return outdent(b, 0);

  const list = visibleTexts();
  const prevEl = list[list.indexOf(el) - 1];
  if (!prevEl || b.content.length) return;
  const prev = Store.get(prevEl.dataset.id);
  const segs = Rich.fromDom(el);

  if (TEXTLESS.has(prev.type)) {
    if (Rich.plain(segs) === '') {
      await commit([op.update(b.id, { alive: 0 }), op.remove(b.parent_id, b.id)]);
      render({ id: prev.id });
    }
    return;
  }
  const prevSegs = currentTitle(prev.id);
  const joinAt = Rich.plain(prevSegs).length;
  pendingTitle.delete(prev.id);
  pendingTitle.delete(b.id);
  await commit([
    op.setTitle(prev.id, Rich.concat(prevSegs, segs)),
    op.update(b.id, { alive: 0 }),
    op.remove(b.parent_id, b.id),
  ]);
  render({ id: prev.id, offset: joinAt });
}

async function removeTextless(el, b) {
  const list = visibleTexts();
  const prevEl = list[list.indexOf(el) - 1];
  await commit([op.update(b.id, { alive: 0 }), op.remove(b.parent_id, b.id)]);
  render(prevEl ? { id: prevEl.dataset.id, offset: prevEl.textContent.length } : undefined);
}

async function indent(b, offset) {
  const parent = Store.get(b.parent_id);
  const siblings = parent.content.filter((id) => Store.get(id)?.alive);
  const prev = Store.get(siblings[siblings.indexOf(b.id) - 1]);
  if (!prev || TEXTLESS.has(prev.type)) return;
  if (prev.type === 'toggle') openToggles.add(prev.id);
  await commit([
    op.remove(parent.id, b.id),
    op.update(b.id, { parent_id: prev.id }),
    op.insertAfter(prev.id, b.id),
  ]);
  render({ id: b.id, offset });
}

async function outdent(b, offset) {
  if (b.parent_id === pageId) return;
  const parent = Store.get(b.parent_id);
  await commit([
    op.remove(parent.id, b.id),
    op.update(b.id, { parent_id: parent.parent_id }),
    op.insertAfter(parent.parent_id, b.id, parent.id),
  ]);
  render({ id: b.id, offset });
}

async function changeType(b, type, segs) {
  pendingTitle.delete(b.id);
  if (type === 'toggle') openToggles.add(b.id);
  const ops = [op.setTitle(b.id, PLAIN_ONLY.has(type) ? [[Rich.plain(segs)]].filter((s) => s[0]) : segs), op.update(b.id, { type })];
  if (type === 'to_do') ops.push(op.setChecked(b.id, false));
  if (type === 'table') ops.push(op.update(b.id, { properties: { title: [], rows: [[[['항목']], [['내용']]], [[], []], [[], []]] } }));
  if (type === 'divider') {
    // 구분선 다음에 빈 글 블록을 만들어 이어 쓰게 함
    const next = Store.newId();
    ops.push(
      op.create(next, { type: 'text', properties: { title: [] }, parent_id: b.parent_id, parent_table: 'block' }),
      op.insertAfter(b.parent_id, next, b.id),
    );
    await commit(ops);
    return render({ id: next, offset: 0 });
  }
  await commit(ops);
  render({ id: b.id, offset: 0 });
}

// 줄 맨 앞에 치는 마크다운식 단축 입력
const SHORTCUTS = [
  ['###### ', 'header_6'], ['##### ', 'header_5'], ['#### ', 'header_4'],
  ['### ', 'sub_sub_header'], ['## ', 'sub_header'], ['# ', 'header'], ['- ', 'bulleted_list'], ['* ', 'bulleted_list'], ['1. ', 'numbered_list'],
  ['[] ', 'to_do'], ['> ', 'toggle'], ['" ', 'quote'], ['! ', 'callout'],
];

els.blocks.addEventListener('input', (e) => {
  const cell = e.target.closest?.('td, th');
  if (cell) {
    const wrap = cell.closest('.text');
    return scheduleRows(wrap.dataset.id, readTable(wrap));
  }
  const el = e.target.closest('.text');
  if (!el) return;
  const b = Store.get(el.dataset.id);
  if (!e.isComposing && Rich.isDirty(el)) {
    // 브라우저가 이상한 태그를 넣었으면 깨끗하게 다시 그림
    const caret = Caret.get(el);
    Rich.toDom(el, Rich.fromDom(el));
    if (caret) Caret.select(el, caret.start, caret.end);
  }
  const segs = Rich.fromDom(el);
  const text = Rich.plain(segs);

  if (!e.isComposing && b.type === 'text') {
    const at = Caret.get(el)?.start;
    for (const [mark, type] of SHORTCUTS) {
      if (text.startsWith(mark) && at === mark.length) return changeType(b, type, Rich.slice(segs, mark.length));
    }
    if (text === '```') return changeType(b, 'code', []);
    if (text === '---') return changeType(b, 'divider', []);
  }
  if (text.startsWith('/') && !PLAIN_ONLY.has(b.type)) openSlash(el, text.slice(1));
  else closeSlash();
  scheduleTitle(b.id, segs);
});

// 붙여넣기는 글자만 (다른 곳의 HTML 서식은 버림)
els.blocks.addEventListener('paste', (e) => {
  if (e.target.closest?.('td, th')) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' '));
    return;
  }
  const el = e.target.closest('.text');
  if (!el?.isContentEditable) return;
  e.preventDefault();
  insertText(el, Store.get(el.dataset.id), e.clipboardData.getData('text/plain'));
});

els.blocks.addEventListener('keydown', async (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  const cell = e.target.closest?.('td, th');
  if (cell) return tableKey(e, cell);
  const el = e.target.closest('.text');
  if (!el) return;
  const b = Store.get(el.dataset.id);
  if (slash.open && slashKey(e)) return;
  const mod = e.metaKey || e.ctrlKey;

  // Esc: 지금 블록을 "블록 선택" 상태로
  if (e.key === 'Escape') {
    e.preventDefault();
    selAnchor = selFocus = b.id;
    return setSelection([b.id]);
  }
  // ⌘⇧↑/↓: 블록 위아래로 옮기기
  if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const caretNow = el.isContentEditable ? Caret.get(el) : null;
    if (await moveBlocks([b.id], e.key === 'ArrowUp' ? -1 : 1)) render({ id: b.id, offset: caretNow?.start ?? 0 });
    return;
  }
  // ⌘A: 글자를 이미 다 선택했으면 페이지의 모든 블록 선택
  if (mod && e.key.toLowerCase() === 'a' && el.isContentEditable) {
    const c = Caret.get(el);
    if (c && c.start === 0 && c.end === el.textContent.length) {
      e.preventDefault();
      return setSelection(visibleBlocks().map((x) => x.dataset.id));
    }
  }

  if (TEXTLESS.has(b.type)) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (b.type === 'page') return openPageBlock(b.id, e);
      return insertAfter(b, {});
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return removeTextless(el, b); }
  }

  // 서식 단축키
  if (mod && !PLAIN_ONLY.has(b.type) && !TEXTLESS.has(b.type)) {
    const fmt = { b: 'b', i: 'i', e: 'c', s: e.shiftKey ? 's' : null }[e.key.toLowerCase()];
    if (fmt) { e.preventDefault(); return applyFormat(el, fmt); }
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); return openLinkInput(el); }
    if (e.key.toLowerCase() === 'u') { e.preventDefault(); return; } // 밑줄은 지원 안 함
  }

  const caret = el.isContentEditable ? Caret.get(el) : { start: 0, end: 0, collapsed: true };
  if (e.key === 'Enter' && (e.shiftKey || (b.type === 'code' && !mod))) {
    e.preventDefault();
    return insertText(el, b, '\n');
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    return onEnter(el, b);
  }
  if (e.key === 'Backspace' && caret?.collapsed && caret.start === 0) {
    e.preventDefault();
    return onBackspace(el, b);
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (b.type === 'code') return insertText(el, b, '  ');
    return e.shiftKey ? outdent(b, caret?.start ?? 0) : indent(b, caret?.start ?? 0);
  }
  if (e.key === 'ArrowUp' && caret?.start === 0 && caret.collapsed) {
    const list = visibleTexts();
    const prev = list[list.indexOf(el) - 1];
    e.preventDefault();
    if (prev) focusBlock(prev.dataset.id, prev.textContent.length);
    else Caret.set(els.title, els.title.textContent.length);
  }
  if (e.key === 'ArrowDown' && caret?.collapsed && caret.end === Rich.plain(Rich.fromDom(el)).length) {
    const list = visibleTexts();
    const next = list[list.indexOf(el) + 1];
    if (next) { e.preventDefault(); focusBlock(next.dataset.id, 0); }
  }
});

els.blocks.addEventListener('click', async (e) => {
  const addRow = e.target.closest('.add-row');
  if (addRow) {
    const wrap = addRow.closest('.text');
    const rows = readTable(wrap);
    rows.push(rows[0].map(() => []));
    pendingRows.set(wrap.dataset.id, rows);
    await commit([]);
    rerenderBlock(wrap.dataset.id);
    const last = textEl(wrap.dataset.id).querySelector('tr:last-child td');
    if (last) Caret.set(last, 0);
    return;
  }
  const handle = e.target.closest('.handle');
  if (handle) {
    const id = handle.closest('.block').dataset.id;
    if (e.shiftKey && selAnchor) setSelection(rangeIds(selAnchor, id));
    else if (e.metaKey || e.ctrlKey) setSelection(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id]);
    else { selAnchor = selFocus = id; setSelection([id]); }
    return;
  }
  const toggleBtn = e.target.closest('.toggle-btn');
  if (toggleBtn) {
    const block = toggleBtn.closest('.block');
    const id = block.dataset.id;
    if (openToggles.has(id)) openToggles.delete(id);
    else openToggles.add(id);
    block.dataset.open = String(openToggles.has(id));
    return;
  }
  const check = e.target.closest('.check');
  if (check) {
    const block = check.closest('.block');
    const b = Store.get(block.dataset.id);
    await commit([op.setChecked(b.id, !Store.isChecked(b))]);
    block.dataset.checked = String(Store.isChecked(b));
    return;
  }
  const link = e.target.closest('.text a');
  if (link && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    window.open(link.getAttribute('href'));
    return;
  }
  const pageRow = e.target.closest('.block[data-type="page"] > .row');
  if (pageRow) openPageBlock(pageRow.parentElement.dataset.id, e);
});

// 표 칸 안에서: Tab/⇧Tab 옆 칸, Enter 아래 칸, Esc 블록 선택
function tableKey(e, cell) {
  const wrap = cell.closest('.text');
  const cells = [...wrap.querySelectorAll('th, td')];
  const cols = cell.parentElement.cells.length;
  const i = cells.indexOf(cell);
  const go = (j) => { const t = cells[j]; if (t) { e.preventDefault(); Caret.set(t, t.textContent.length); } };
  if (e.key === 'Tab') return go(e.shiftKey ? i - 1 : i + 1) ?? e.preventDefault();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return go(i + cols); }
  if (e.key === 'Escape') {
    e.preventDefault();
    selAnchor = selFocus = wrap.dataset.id;
    return setSelection([wrap.dataset.id]);
  }
  if (e.key === 'Enter') e.preventDefault();
}

function openPageBlock(id, e) {
  if (e.metaKey || e.ctrlKey) window.electronApi.openInNewTab(id);
  else navigate(id);
}

// 제목
els.title.addEventListener('input', () => scheduleTitle(pageId, els.title.textContent ? [[els.title.textContent]] : []));
els.title.addEventListener('keydown', async (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' || (e.key === 'ArrowDown' && Caret.get(els.title)?.end === els.title.textContent.length)) {
    e.preventDefault();
    const first = visibleTexts()[0];
    if (first) return focusBlock(first.dataset.id, 0);
    const id = Store.newId();
    await commit([
      op.create(id, { type: 'text', properties: { title: [] }, parent_id: pageId, parent_table: 'block' }),
      op.insertBefore(pageId, id),
    ]);
    render({ id, offset: 0 });
  }
});
els.title.addEventListener('blur', () => commit([]));

// 본문 아래 빈 곳 클릭 → 마지막 빈 블록으로, 없으면 새 블록
document.getElementById('click-catcher').addEventListener('click', async () => {
  const page = Store.get(pageId);
  const last = Store.get(page.content.filter((id) => Store.get(id)?.alive).at(-1));
  if (last && last.type === 'text' && Rich.plain(currentTitle(last.id)) === '') return focusBlock(last.id);
  const id = Store.newId();
  await commit([
    op.create(id, { type: 'text', properties: { title: [] }, parent_id: pageId, parent_table: 'block' }),
    op.insertAfter(pageId, id),
  ]);
  render({ id, offset: 0 });
});

// ---------------------------------------------------------------------------
// 서식 도구 막대 (글자를 드래그하면 뜸)
let toolbarTarget = null; // { el, start, end }

function applyFormat(el, type, value) {
  const caret = Caret.get(el) ?? toolbarTarget;
  if (!caret || caret.start === caret.end) return;
  const b = Store.get(el.dataset.id);
  const segs = Rich.toggle(Rich.fromDom(el), caret.start, caret.end, type, value);
  Rich.toDom(el, segs);
  Caret.select(el, caret.start, caret.end);
  scheduleTitle(b.id, segs);
  updateToolbar();
}

function updateToolbar() {
  if (els.toolbar.classList.contains('linking')) return;
  const sel = window.getSelection();
  const el = sel.rangeCount && sel.anchorNode?.parentElement?.closest('#blocks .text');
  if (!el || !el.isContentEditable || PLAIN_ONLY.has(Store.get(el.dataset.id)?.type) || !el.contains(sel.focusNode)) return hideToolbar();
  const caret = Caret.get(el);
  if (!caret || caret.collapsed) return hideToolbar();

  toolbarTarget = { el, start: caret.start, end: caret.end };
  const segs = Rich.fromDom(el);
  for (const btn of els.toolbar.querySelectorAll('[data-fmt]')) {
    btn.classList.toggle('on', Rich.has(segs, caret.start, caret.end, btn.dataset.fmt));
  }
  els.toolbar.hidden = false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const w = els.toolbar.offsetWidth;
  els.toolbar.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
  els.toolbar.style.top = `${r.top - els.toolbar.offsetHeight - 8 < 40 ? r.bottom + 8 : r.top - els.toolbar.offsetHeight - 8}px`;
}

function hideToolbar() {
  els.toolbar.hidden = true;
  els.toolbar.classList.remove('linking');
  toolbarTarget = null;
}

function openLinkInput(el) {
  const caret = Caret.get(el);
  if (!caret || caret.collapsed) return;
  updateToolbar();
  toolbarTarget = { el, start: caret.start, end: caret.end };
  els.toolbar.classList.add('linking');
  els.linkInput.value = Rich.linkAt(Rich.fromDom(el), caret.start + 1) ?? '';
  els.linkInput.focus();
  els.linkInput.select();
}

function finishLink(apply) {
  const target = toolbarTarget;
  els.toolbar.classList.remove('linking');
  if (!target) return hideToolbar();
  Caret.select(target.el, target.start, target.end);
  if (apply) {
    let url = els.linkInput.value.trim();
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    applyFormat(target.el, 'a', url || null);
  }
  updateToolbar();
}

document.addEventListener('selectionchange', () => requestAnimationFrame(updateToolbar));
els.toolbar.addEventListener('mousedown', (e) => {
  if (e.target !== els.linkInput) e.preventDefault(); // 선택이 풀리지 않게
});
els.toolbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !toolbarTarget) return;
  if (btn.dataset.fmt === 'a') return openLinkInput(toolbarTarget.el);
  if (btn.dataset.fmt) applyFormat(toolbarTarget.el, btn.dataset.fmt);
});
els.linkInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') { e.preventDefault(); finishLink(true); }
  if (e.key === 'Escape') { e.preventDefault(); finishLink(false); }
});
els.linkInput.addEventListener('blur', () => { if (els.toolbar.classList.contains('linking')) hideToolbar(); });

// ---------------------------------------------------------------------------
// 블록 선택 (파란 배경으로 블록 단위 선택 → 지우기/옮기기)
const selected = new Set();
let selAnchor = null;
let selFocus = null;

const visibleBlocks = () => [...els.blocks.querySelectorAll('.block')].filter((el) => el.offsetParent !== null);
const orderedIds = (ids) => visibleBlocks().map((el) => el.dataset.id).filter((id) => ids.includes(id));

function rangeIds(aId, bId) {
  const list = visibleBlocks().map((el) => el.dataset.id);
  let i = list.indexOf(aId);
  let j = list.indexOf(bId);
  if (i < 0 || j < 0) return [bId];
  if (i > j) [i, j] = [j, i];
  return list.slice(i, j + 1);
}

// 부모가 이미 선택돼 있으면 자식은 빼기 (부모와 같이 움직이므로)
function topmost(ids) {
  return ids.filter((id) => {
    let p = Store.get(id)?.parent_id;
    while (p && p !== pageId) {
      if (ids.includes(p)) return false;
      p = Store.get(p)?.parent_id;
    }
    return true;
  });
}

function paintSelection() {
  for (const el of els.blocks.querySelectorAll('.block')) el.classList.toggle('selected', selected.has(el.dataset.id));
}

function setSelection(ids) {
  selected.clear();
  for (const id of ids) selected.add(id);
  paintSelection();
  if (ids.length) {
    window.getSelection().removeAllRanges();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    hideToolbar();
    closeSlash();
  }
}

async function deleteSelected() {
  const ids = topmost(orderedIds([...selected]));
  if (!ids.length) return;
  const all = visibleBlocks();
  const firstIdx = all.findIndex((el) => el.dataset.id === ids[0]);
  let prev = null;
  for (let i = firstIdx - 1; i >= 0; i--) {
    if (!ids.some((id) => all[i].closest(`.block[data-id="${id}"]`))) { prev = all[i].dataset.id; break; }
  }
  const prevLen = prev ? textEl(prev)?.textContent.length ?? 0 : 0;
  setSelection([]);
  await commit(ids.flatMap((id) => [op.update(id, { alive: 0 }), op.remove(Store.get(id).parent_id, id)]));
  render(prev ? { id: prev, offset: prevLen } : undefined);
}

// 같은 부모 안에서 붙어 있는 블록 묶음을 한 칸 위/아래로
async function moveBlocks(ids, dir) {
  ids = topmost(orderedIds(ids));
  const parentId = Store.get(ids[0])?.parent_id;
  if (!parentId || ids.some((id) => Store.get(id).parent_id !== parentId)) return null;
  const sibs = Store.get(parentId).content.filter((id) => Store.get(id)?.alive);
  const idx = ids.map((id) => sibs.indexOf(id)).sort((a, b) => a - b);
  if (idx.at(-1) - idx[0] !== idx.length - 1) return null;
  const group = idx.map((i) => sibs[i]);
  let ops;
  if (dir < 0) {
    const prev = sibs[idx[0] - 1];
    if (!prev) return null;
    ops = [op.remove(parentId, prev), op.insertAfter(parentId, prev, group.at(-1))];
  } else {
    const next = sibs[idx.at(-1) + 1];
    if (!next) return null;
    ops = [op.remove(parentId, next), op.insertBefore(parentId, next, group[0])];
  }
  await commit(ops);
  return group;
}

// 끌어다 놓기: 대상 블록의 앞(before) / 뒤(after) / 안쪽(inside)
async function moveTo(ids, targetId, pos) {
  const target = Store.get(targetId);
  const parentId = pos === 'inside' ? targetId : target.parent_id;
  if (pos === 'inside' && target.type === 'toggle') openToggles.add(targetId);
  const ops = [];
  let last = null;
  ids.forEach((id, i) => {
    ops.push(op.remove(Store.get(id).parent_id, id), op.update(id, { parent_id: parentId }));
    if (pos === 'inside') ops.push(op.insertAfter(parentId, id));
    else if (pos === 'before') ops.push(i === 0 ? op.insertBefore(parentId, id, targetId) : op.insertAfter(parentId, id, last));
    else ops.push(op.insertAfter(parentId, id, i === 0 ? targetId : last));
    last = id;
  });
  await commit(ops);
  render();
  setSelection(ids);
}

// 선택 상태에서의 키보드
document.addEventListener('keydown', async (e) => {
  if (!selected.size || e.isComposing) return;
  if (e.target.closest?.('#link-input, #title')) return;
  const ids = orderedIds([...selected]);
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return deleteSelected(); }
  if (e.key === 'Escape') { e.preventDefault(); return setSelection([]); }
  if (e.key === 'Enter') {
    e.preventDefault();
    const id = ids[0];
    setSelection([]);
    return focusBlock(id, textEl(id)?.textContent.length ?? 0);
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    if (mod && e.shiftKey) {
      const moved = await moveBlocks(ids, dir);
      if (moved) { render(); setSelection(moved); }
      return;
    }
    const list = visibleBlocks().map((el) => el.dataset.id);
    if (!selFocus || !selected.has(selFocus)) selFocus = dir < 0 ? ids[0] : ids.at(-1);
    const next = list[list.indexOf(selFocus) + dir];
    if (!next) return;
    if (e.shiftKey) {
      if (!selAnchor || !selected.has(selAnchor)) selAnchor = dir < 0 ? ids.at(-1) : ids[0];
      selFocus = next;
      setSelection(rangeIds(selAnchor, next));
    } else {
      selAnchor = selFocus = next;
      setSelection([next]);
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(visibleBlocks().map((el) => el.dataset.id)); }
}, true);

// 마우스로 여러 블록 선택: 글자를 끌다가 다른 블록으로 넘어가면 블록 선택으로 바뀜,
// 빈 여백에서 끌면 사각형으로 선택
const selectBox = document.getElementById('select-box');
let mouseSel = null;

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('#slash-menu, #format-bar, #log-panel, #log-toggle, #sidebar, #breadcrumbs, .handle, button, #title')) return;
  if (!e.target.closest('#main')) return;
  if (selected.size && !e.shiftKey) setSelection([]);
  const block = e.target.closest('#blocks .block');
  if (block) mouseSel = { mode: 'text', startId: block.dataset.id };
  else mouseSel = { mode: 'box', x: e.clientX, y: e.clientY, moved: false };
});

document.addEventListener('mousemove', (e) => {
  if (!mouseSel || !(e.buttons & 1)) return;
  if (mouseSel.mode === 'text' || mouseSel.mode === 'blocks') {
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#blocks .block');
    if (!over) return;
    if (mouseSel.mode === 'text' && over.dataset.id === mouseSel.startId) return;
    const start = els.blocks.querySelector(`.block[data-id="${mouseSel.startId}"]`);
    if (mouseSel.mode === 'text' && (start?.contains(over) || over.contains(start))) return;
    mouseSel.mode = 'blocks';
    setSelection(rangeIds(mouseSel.startId, over.dataset.id));
    window.getSelection().removeAllRanges();
    return;
  }
  // 사각형 선택
  if (!mouseSel.moved && Math.hypot(e.clientX - mouseSel.x, e.clientY - mouseSel.y) < 6) return;
  mouseSel.moved = true;
  const left = Math.min(mouseSel.x, e.clientX);
  const top = Math.min(mouseSel.y, e.clientY);
  const right = Math.max(mouseSel.x, e.clientX);
  const bottom = Math.max(mouseSel.y, e.clientY);
  Object.assign(selectBox.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  selectBox.hidden = false;
  window.getSelection().removeAllRanges();
  const hit = visibleBlocks().filter((el) => {
    const r = el.querySelector(':scope > .row').getBoundingClientRect();
    return r.bottom > top && r.top < bottom && r.right > left && r.left - 30 < right;
  }).map((el) => el.dataset.id);
  setSelection(topmost(hit));
});

let suppressClickUntil = 0;
document.addEventListener('mouseup', () => {
  // 사각형/블록 선택 직후의 click(빈 곳 클릭 → 새 블록 만들기)은 무시
  if (mouseSel && (mouseSel.moved || mouseSel.mode === 'blocks')) suppressClickUntil = Date.now() + 80;
  mouseSel = null;
  selectBox.hidden = true;
});
window.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
}, true);

// 손잡이를 끌어서 옮기기
const dropLine = document.getElementById('drop-line');
let dragIds = null;
let drop = null;

els.blocks.addEventListener('dragstart', (e) => {
  const handle = e.target.closest?.('.handle');
  if (!handle) return;
  const block = handle.closest('.block');
  const id = block.dataset.id;
  dragIds = topmost(orderedIds(selected.has(id) ? [...selected] : [id]));
  setSelection(dragIds);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragIds.join(','));
  e.dataTransfer.setDragImage(block.querySelector(':scope > .row'), 20, 12);
});

els.blocks.addEventListener('dragover', (e) => {
  if (!dragIds) return;
  const row = e.target.closest('.row');
  const block = row?.parentElement;
  if (!block || dragIds.some((id) => block.closest(`.block[data-id="${id}"]`))) { dropLine.hidden = true; drop = null; return; }
  e.preventDefault();
  const r = row.getBoundingClientRect();
  let pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  const canNest = !TEXTLESS.has(block.dataset.type) && block.dataset.type !== 'code';
  if (pos === 'after' && canNest && e.clientX > r.left + 70) pos = 'inside';
  drop = { target: block.dataset.id, pos };
  const indent = pos === 'inside' ? 28 : 0;
  Object.assign(dropLine.style, {
    top: `${(pos === 'before' ? r.top : r.bottom) - 2}px`,
    left: `${r.left + indent}px`,
    width: `${r.width - indent}px`,
  });
  dropLine.hidden = false;
});

els.blocks.addEventListener('drop', async (e) => {
  e.preventDefault();
  const ids = dragIds;
  const d = drop;
  dragIds = null;
  drop = null;
  dropLine.hidden = true;
  if (ids && d) await moveTo(ids, d.target, d.pos);
});

document.addEventListener('dragend', () => { dragIds = null; drop = null; dropLine.hidden = true; });

// ---------------------------------------------------------------------------
// 실행 취소 / 다시 실행 (블록 단위, transactions에 is_undo=1 로 기록됨)
async function history_(kind) {
  await commit([]);
  const ids = await Store[kind]();
  if (!ids) return;
  window.electronApi.notifyChanged();
  const page = Store.get(pageId);
  if (!page?.alive) return navigate(null);
  render();
  updateChrome();
  const target = ids.map(textEl).find(Boolean);
  if (target) focusBlock(target.dataset.id, target.textContent.length);
}
window.electronApi.onHistory(history_);

// ---------------------------------------------------------------------------
// / 메뉴
const SLASH_ITEMS = [
  { type: 'text', label: '텍스트', icon: 'Aa', desc: '일반 글', keys: 'text plain 텍스트 글' },
  { type: 'header', label: '제목 1', icon: 'H1', desc: '가장 큰 제목 (#)', keys: 'header heading h1 제목1' },
  { type: 'sub_header', label: '제목 2', icon: 'H2', desc: '중간 제목 (##)', keys: 'header heading h2 제목2' },
  { type: 'sub_sub_header', label: '제목 3', icon: 'H3', desc: '작은 제목 (###)', keys: 'header heading h3 제목3' },
  { type: 'header_4', label: '제목 4', icon: 'H4', desc: '####', keys: 'header heading h4 제목4' },
  { type: 'header_5', label: '제목 5', icon: 'H5', desc: '#####', keys: 'header heading h5 제목5' },
  { type: 'header_6', label: '제목 6', icon: 'H6', desc: '######', keys: 'header heading h6 제목6' },
  { type: 'table', label: '표', icon: '▦', desc: '간단한 표 (첫 줄은 머리글)', keys: 'table 표 테이블' },
  { type: 'table_of_contents', label: '목차', icon: '☰', desc: '이 페이지의 제목 모음', keys: 'toc table contents 목차' },
  { type: 'to_do', label: '할 일 목록', icon: '☑', desc: '체크박스로 할 일 관리', keys: 'todo to-do check 할일 체크' },
  { type: 'bulleted_list', label: '글머리 기호 목록', icon: '•', desc: '간단한 목록', keys: 'bullet list ul 목록 글머리' },
  { type: 'numbered_list', label: '번호 매기기 목록', icon: '1.', desc: '번호가 붙는 목록', keys: 'number ol 번호 목록' },
  { type: 'toggle', label: '토글 목록', icon: '▶', desc: '접었다 펼 수 있는 목록', keys: 'toggle 토글' },
  { type: 'quote', label: '인용', icon: '❝', desc: '인용문', keys: 'quote 인용' },
  { type: 'callout', label: '콜아웃', icon: '💡', desc: '눈에 띄는 상자', keys: 'callout 콜아웃 박스' },
  { type: 'code', label: '코드', icon: '</>', desc: '코드 조각', keys: 'code 코드' },
  { type: 'divider', label: '구분선', icon: '—', desc: '가로줄', keys: 'divider hr 구분선 줄' },
  { type: 'page', label: '페이지', icon: '📄', desc: '안에 새 페이지 만들기', keys: 'page 페이지' },
];
const slash = { open: false, el: null, items: [], index: 0 };

function openSlash(el, query) {
  const q = query.trim().toLowerCase();
  slash.items = SLASH_ITEMS.filter((it) => !q || it.label.toLowerCase().includes(q) || it.keys.includes(q));
  slash.el = el;
  slash.index = Math.min(slash.index, Math.max(0, slash.items.length - 1));
  slash.open = true;

  els.slash.replaceChildren();
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = '기본 블록';
  els.slash.append(label);
  if (!slash.items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '결과 없음';
    els.slash.append(empty);
  }
  slash.items.forEach((it, i) => {
    const btn = document.createElement('button');
    btn.className = 'item' + (i === slash.index ? ' selected' : '');
    btn.innerHTML = '<span class="icon"></span><span><div class="name"></div><div class="desc"></div></span>';
    btn.querySelector('.icon').textContent = it.icon;
    btn.querySelector('.name').textContent = it.label;
    btn.querySelector('.desc').textContent = it.desc;
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(it); });
    els.slash.append(btn);
  });

  els.slash.hidden = false;
  els.slash.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  const h = els.slash.offsetHeight;
  const top = r.bottom + 4 + h > window.innerHeight ? r.top - h - 4 : r.bottom + 4;
  els.slash.style.top = `${Math.max(8, top)}px`;
  els.slash.style.left = `${Math.min(r.left, window.innerWidth - 270)}px`;
}

function closeSlash() {
  slash.open = false;
  slash.index = 0;
  els.slash.hidden = true;
}

function slashKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = slash.items.length || 1;
    slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    openSlash(slash.el, slash.el.textContent.slice(1));
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (slash.items[slash.index]) pickSlash(slash.items[slash.index]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSlash();
    return true;
  }
  return false;
}

async function pickSlash(item) {
  const b = Store.get(slash.el.dataset.id);
  closeSlash();
  if (item.type === 'page') {
    pendingTitle.delete(b.id);
    await commit([op.setTitle(b.id, []), op.update(b.id, { type: 'page' })]);
    return navigate(b.id);
  }
  await changeType(b, item.type, []);
}

document.addEventListener('mousedown', (e) => {
  if (slash.open && !els.slash.contains(e.target)) closeSlash();
});

// ---------------------------------------------------------------------------
// transactions 패널: 이 탭이 보낸 operations를 실시간으로 보여줌
const logItems = [];
Store.onSubmit((ops, kind) => {
  logItems.unshift({ time: new Date(), ops, kind });
  logItems.length = Math.min(logItems.length, 40);
  if (!els.logPanel.hidden) renderLog();
});

function renderLog() {
  els.logList.replaceChildren(...logItems.map(({ time, ops, kind }) => {
    const item = document.createElement('div');
    item.className = 'log-item' + (kind ? ' undo' : '');
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = `${time.toLocaleTimeString()}  ${ops.length} op(s)${kind ? `  ↶ ${kind} (is_undo=1)` : ''}\n`;
    item.append(t);
    for (const o of ops) {
      const c = document.createElement('span');
      c.className = 'cmd';
      c.textContent = o.command;
      const args = JSON.stringify(o.args);
      item.append(c, ` block:${o.id.slice(0, 8)}${o.field ? ' ' + o.field : ''} ${args.length > 140 ? args.slice(0, 140) + '…' : args}\n`);
    }
    return item;
  }));
  if (!logItems.length) els.logList.textContent = '아직 없음. 글을 써 보세요.';
}

els.logToggle.addEventListener('click', () => {
  els.logPanel.hidden = !els.logPanel.hidden;
  if (!els.logPanel.hidden) renderLog();
});

// ---------------------------------------------------------------------------
document.getElementById('new-page').addEventListener('click', async () => {
  const page = await createTopPage();
  navigate(page.id);
});
document.getElementById('search-btn').addEventListener('click', () => window.electronApi.openSearch());

window.electronApi.onNavigate((id) => navigate(id));
window.electronApi.onRefresh(async () => {
  if (document.hasFocus()) return updateChrome();
  await commit([]);
  const page = await Store.loadPage(pageId);
  if (!page?.alive) return navigate(null);
  render();
  updateChrome();
});
window.addEventListener('beforeunload', () => commit([]));

navigate(new URLSearchParams(location.search).get('pageId'));
