// contenteditable 안에서 커서(캐럿)와 선택 범위를 글자 수로 읽고 쓰기
(function () {
  function point(el, offset) {
    let remaining = Math.max(0, offset);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let last = null;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) return [node, remaining];
      remaining -= node.length;
      last = node;
    }
    return last ? [last, last.length] : [el, 0];
  }

  window.Caret = {
    get(el) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
      const range = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      return { start, end: start + range.toString().length, collapsed: range.collapsed };
    },
    set(el, offset) {
      this.select(el, offset, offset);
    },
    select(el, start, end) {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(...point(el, start));
      range.setEnd(...point(el, end));
      sel.removeAllRanges();
      sel.addRange(range);
    },
  };
})();
