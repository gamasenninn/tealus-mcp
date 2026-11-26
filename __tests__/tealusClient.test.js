/**
 * TealusClient HTTP hardening test (#303 同型 silent fail 排除)
 *
 * 背景: agent-server botApi.request() と同じく、tealus-mcp の HTTP client も res.ok を
 * 見ず res.json() を返していたため、/bot/push 等の失敗 (401 token 失効含む) を握り潰し
 * 偽「送信成功」を生んでいた (= 藤井さん環境の agent 自律 send_message 経路の silent fail)。
 */
jest.mock('node-fetch');
const fetch = require('node-fetch');
const { TealusClient } = require('../src/tealusClient');

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `S${status}`,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function newClient() {
  return new TealusClient({ apiUrl: 'http://x', userId: 'bot', password: 'pw' });
}

function loginCallCount() {
  return fetch.mock.calls.filter(([u]) => String(u).includes('/api/auth/login')).length;
}

beforeEach(() => { fetch.mockReset(); });

describe('TealusClient.request — silent fail 排除 (#303 同型)', () => {
  test('2xx は JSON を返す', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))           // login
      .mockResolvedValueOnce(jsonRes(200, { message: { id: 'm1' } })); // request
    const out = await newClient().pushMessage('room1', 'hi');
    expect(out).toEqual({ message: { id: 'm1' } });
  });

  test('非2xx は status/body 付き Error を throw (= 握り潰さない)', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))
      .mockResolvedValueOnce(jsonRes(500, { error: 'boom' }));
    await expect(newClient().pushMessage('room1', 'hi'))
      .rejects.toMatchObject({ status: 500 });
  });

  test('401 → token 破棄して 1 回再ログイン + retry し成功', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))            // initial login
      .mockResolvedValueOnce(jsonRes(401, { error: 'expired' }))       // request → 401
      .mockResolvedValueOnce(jsonRes(200, { token: 't2' }))            // re-login
      .mockResolvedValueOnce(jsonRes(200, { message: { id: 'm2' } })); // retry 成功
    const out = await newClient().pushMessage('room1', 'hi');
    expect(out).toEqual({ message: { id: 'm2' } });
    expect(loginCallCount()).toBe(2); // 再ログインが走った
  });

  test('401 が retry 後も続く場合は throw (status=401、無限ループしない)', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))
      .mockResolvedValueOnce(jsonRes(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonRes(200, { token: 't2' }))
      .mockResolvedValueOnce(jsonRes(401, { error: 'expired' }));
    await expect(newClient().pushMessage('room1', 'hi'))
      .rejects.toMatchObject({ status: 401 });
    expect(loginCallCount()).toBe(2); // 再ログインは 1 回だけ
  });
});

describe('TealusClient.pushFile/pushImage — 同型 hardening', () => {
  test('pushFile 非2xx は throw する', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))  // login
      .mockResolvedValueOnce(jsonRes(413, { error: 'too large' }));
    await expect(
      newClient().pushFile('room1', Buffer.from('x'), 'a.txt', 'text/plain')
    ).rejects.toMatchObject({ status: 413 });
  });

  test('pushFile 401 → 再ログイン + retry し成功', async () => {
    fetch
      .mockResolvedValueOnce(jsonRes(200, { token: 't1' }))            // login
      .mockResolvedValueOnce(jsonRes(401, { error: 'expired' }))       // push 401
      .mockResolvedValueOnce(jsonRes(200, { token: 't2' }))            // re-login
      .mockResolvedValueOnce(jsonRes(200, { message: { id: 'f1' } })); // retry
    const out = await newClient().pushFile('room1', Buffer.from('x'), 'a.txt', 'text/plain');
    expect(out).toEqual({ message: { id: 'f1' } });
    expect(loginCallCount()).toBe(2);
  });
});

describe('タスク一覧 (tealus docs/16、#661)', () => {
  const lastCall = () => fetch.mock.calls[fetch.mock.calls.length - 1];

  test('listTasks: 誰のタスクかを X-Tealus-Requester で渡し、絞りは query に', async () => {
    fetch.mockResolvedValueOnce(jsonRes(200, { token: 't1' })).mockResolvedValueOnce(jsonRes(200, { tasks: [] }));
    await newClient().listTasks({ forUserId: 'u1', status: 'all', roomId: 'r1' });
    const [url, opts] = lastCall();
    expect(url).toBe('http://x/api/bot/tasks?status=all&room_id=r1');
    expect(opts.method).toBe('GET');
    expect(opts.headers['X-Tealus-Requester']).toBe('u1');
  });

  test('誰のタスクかを渡さなければヘッダを付けない (アシスタントの中継が付ける)', async () => {
    fetch.mockResolvedValueOnce(jsonRes(200, { token: 't1' })).mockResolvedValueOnce(jsonRes(200, { tasks: [] }));
    await newClient().listTasks({});
    const [url, opts] = lastCall();
    expect(url).toBe('http://x/api/bot/tasks');
    expect(opts.headers).not.toHaveProperty('X-Tealus-Requester');
  });

  test('addTask / updateTask は POST / PATCH で本文を送る', async () => {
    fetch.mockResolvedValueOnce(jsonRes(200, { token: 't1' })).mockResolvedValueOnce(jsonRes(201, { task: { id: 't' } }));
    const c = newClient();
    await c.addTask({ title: '見積り', section: 'decide' }, 'u1');
    let [url, opts] = lastCall();
    expect([url, opts.method, JSON.parse(opts.body)]).toEqual(['http://x/api/bot/tasks', 'POST', { title: '見積り', section: 'decide' }]);
    expect(opts.headers['X-Tealus-Requester']).toBe('u1');
    fetch.mockResolvedValueOnce(jsonRes(200, { task: { id: 't' } }));
    await c.updateTask('t9', { ai_suggests_done: true }, 'u1');
    [url, opts] = lastCall();
    expect([url, opts.method, JSON.parse(opts.body)]).toEqual(['http://x/api/bot/tasks/t9', 'PATCH', { ai_suggests_done: true }]);
  });
});
