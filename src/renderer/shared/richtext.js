// 서식 있는 글 (properties.title: [[글자, [서식…]], …])
//
//   [["그냥 글"], ["굵은 글", [["b"]]], ["링크", [["a", "https://..."]]]]
//
// 한 덩어리(segment) = [글자, 서식목록?]
// 서식: b 굵게, i 기울임, s 취소선, c 코드, a 링크
(function () {
  const ORDER = ['a', 'b', 'i', 's', 'c'];
  const TAGS = { b: 'B', i: 'I', s: 'S', c: 'CODE', a: 'A' };
  const FROM_TAG = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', S: 's', STRIKE: 's', DEL: 's', CODE: 'c', A: 'a' };

  const anns = (seg) => seg[1] ?? [];
  const sortAnns = (list) => [...list].sort((x, y) => ORDER.indexOf(x[0]) - ORDER.indexOf(y[0]));
  const key = (list) => JSON.stringify(sortAnns(list));

  function make(text, list) {
    return list && list.length ? [text, sortAnns(list)] : [text];
  }

  function normalize(segs) {
    const out = [];
    for (const seg of segs) {
      if (!seg[0]) continue;
      const last = out[out.length - 1];
      if (last && key(anns(last)) === key(anns(seg))) last[0] += seg[0];
      else out.push(make(seg[0], anns(seg)));
    }
    return out;
  }

  const plain = (segs) => (segs ?? []).map((s) => s[0]).join('');

  // offset 위치에서 덩어리를 둘로 나눔
  function splitAt(segs, offset) {
    const left = [];
    const right = [];
    let pos = 0;
    for (const seg of segs) {
      const len = seg[0].length;
      if (pos + len <= offset) left.push(seg);
      else if (pos >= offset) right.push(seg);
      else {
        left.push(make(seg[0].slice(0, offset - pos), anns(seg)));
        right.push(make(seg[0].slice(offset - pos), anns(seg)));
      }
      pos += len;
    }
    return [left, right];
  }

  function slice(segs, start, end = Infinity) {
    const [, rest] = splitAt(segs, start);
    if (end === Infinity) return normalize(rest);
    const [mid] = splitAt(rest, end - start);
    return normalize(mid);
  }

  const concat = (a, b) => normalize([...a, ...b]);

  // 글자 넣기: 바로 앞 글자의 서식을 이어받음 (코드/링크는 이어받지 않음)
  function insert(segs, start, end, text) {
    const [left] = splitAt(segs, start);
    const [, right] = splitAt(segs, end);
    const prev = left[left.length - 1];
    const inherit = prev ? anns(prev).filter(([t]) => t !== 'a' && t !== 'c') : [];
    return normalize([...left, make(text, inherit), ...right]);
  }

  function has(segs, start, end, type) {
    const mid = slice(segs, start, end);
    return mid.length > 0 && mid.every((seg) => anns(seg).some(([t]) => t === type));
  }

  // 선택 범위에 서식 켜기/끄기. 링크는 value(주소)를 넣으면 켜고, null이면 끔
  function toggle(segs, start, end, type, value) {
    if (start >= end) return segs;
    const on = type === 'a' ? value != null : !has(segs, start, end, type);
    const [left, rest] = splitAt(segs, start);
    const [mid, right] = splitAt(rest, end - start);
    const changed = mid.map((seg) => {
      const list = anns(seg).filter(([t]) => t !== type);
      if (on) list.push(type === 'a' ? ['a', value] : [type]);
      return make(seg[0], list);
    });
    return normalize([...left, ...changed, ...right]);
  }

  function linkAt(segs, offset) {
    let pos = 0;
    for (const seg of segs) {
      if (offset >= pos && offset <= pos + seg[0].length) {
        const a = anns(seg).find(([t]) => t === 'a');
        if (a) return a[1];
      }
      pos += seg[0].length;
    }
    return null;
  }

  // 화면(DOM) → 덩어리
  function fromDom(root) {
    const out = [];
    const walk = (node, list) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push(make(child.data, list));
        } else if (child.nodeName === 'BR') {
          if (!child.dataset.trail) out.push(make('\n', list));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          // 브라우저가 몰래 넣은 <div>/<p>는 줄바꿈으로 취급
          if ((child.nodeName === 'DIV' || child.nodeName === 'P') && out.length) out.push(['\n']);
          const t = FROM_TAG[child.nodeName];
          const next = t ? [...list.filter(([x]) => x !== t), t === 'a' ? ['a', child.getAttribute('href') ?? ''] : [t]] : list;
          walk(child, next);
        }
      }
    };
    walk(root, []);
    return normalize(out);
  }

  // 덩어리 → 화면(DOM)
  function toDom(root, segs) {
    root.replaceChildren();
    for (const seg of segs ?? []) {
      let node = document.createTextNode(seg[0]);
      for (const [t, v] of [...sortAnns(anns(seg))].reverse()) {
        const el = document.createElement(TAGS[t]);
        if (t === 'a') { el.href = v; el.title = `${v}\n⌘클릭으로 열기`; }
        el.append(node);
        node = el;
      }
      root.append(node);
    }
    // 맨 끝 줄바꿈이 화면에 보이도록
    if (plain(segs).endsWith('\n')) {
      const br = document.createElement('br');
      br.dataset.trail = '1';
      root.append(br);
    }
  }

  // DOM 안에 우리가 모르는 태그가 생겼는지 (브라우저가 <span style>, <font> 등을 넣는 경우)
  const isDirty = (root) => !!root.querySelector(':not(b, i, s, code, a, br)');

  window.Rich = { plain, slice, concat, insert, toggle, has, linkAt, fromDom, toDom, isDirty, normalize };
})();
