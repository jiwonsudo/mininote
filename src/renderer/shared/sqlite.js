// 렌더러 쪽 SQLite 클라이언트
// 1) preload에 "DB 통로 주세요" 요청 → main이 MessageChannelMain을 만들어 줌
// 2) window 'message' 이벤트로 MessagePort를 받음
// 3) 이후 { id, body: [{ sql, args, wantRows }] } 를 보내고 결과를 기다림
(function () {
  let port = null;
  let nextId = 1;
  const pending = new Map();

  const ready = new Promise((resolve) => {
    window.addEventListener('message', function onMessage(event) {
      if (event.data !== 'mininote:new-message-port' || !event.ports?.[0]) return;
      window.removeEventListener('message', onMessage);
      port = event.ports[0];
      port.onmessage = (e) => {
        const { id, results } = e.data;
        pending.get(id)?.(results);
        pending.delete(id);
      };
      port.start();
      resolve();
    });
  });
  window.electronApi.requestSqlitePort();

  // 여러 문장을 한 번에 (서버에서 하나의 트랜잭션으로 실행)
  async function batch(body) {
    await ready;
    const id = nextId++;
    const results = await new Promise((resolve) => {
      pending.set(id, resolve);
      port.postMessage({ id, body });
    });
    const err = results.find((r) => r.type === 'error');
    if (err) throw Object.assign(new Error(err.message), err);
    return results;
  }

  async function query(sql, args = []) {
    const [r] = await batch([{ sql, args, wantRows: true }]);
    return r.data;
  }

  window.Sqlite = { ready, batch, query };
})();
