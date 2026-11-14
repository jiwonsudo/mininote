// 탭 막대
const tabsEl = document.getElementById('tabs');
document.body.classList.add(new URLSearchParams(location.search).get('platform') ?? '');
document.getElementById('new').addEventListener('click', () => tabsApi.newTab());

tabsApi.onState(({ tabs, activeTabId }) => {
  tabsEl.replaceChildren(...tabs.map((t) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeTabId ? ' active' : '');
    el.title = t.title;
    el.innerHTML = '<span class="name"></span><button class="x" title="닫기">✕</button>';
    el.querySelector('.name').textContent = t.title;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.x')) return;
      if (e.button === 1) return tabsApi.close(t.id);
      tabsApi.select(t.id);
    });
    el.querySelector('.x').addEventListener('click', () => tabsApi.close(t.id));
    return el;
  }));
});
tabsApi.ready();
