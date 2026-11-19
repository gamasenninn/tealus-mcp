/**
 * send_file — パスを渡すと、そのファイルをそのまま添付する (tealus 改善ループ 89、2026-11-19 利用者判断)
 *
 * ★ 既定では無い道具。TEALUS_FILE_ROOT (添付してよいフォルダ) を明示した班だけに出る。
 *   社内のアシスタント (agent-server) は誰でも話しかけられるので、設定しない = 使えない
 * ★ 守り: フォルダの外・「.」で始まるもの (.env / .mcp.json / .git の中)・鍵らしい名前・大きさの上限を断る
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAttachable } = require('../src/lib/fileGuard');
const { registerTools } = require('../src/tools');

let root, outside;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-out-'));
  fs.mkdirSync(path.join(root, 'note'));
  fs.writeFileSync(path.join(root, 'note', 'ch1.md'), '# 第1章\n');
  fs.writeFileSync(path.join(root, 'fig.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(root, '.mcp.json'), '{}');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), '[core]');
  fs.writeFileSync(path.join(root, 'server.key'), 'k');
  fs.writeFileSync(path.join(root, 'id_rsa'), 'k');
  fs.writeFileSync(path.join(outside, 'x.md'), 'x');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('resolveAttachable (添付してよいかの判定)', () => {
  test('フォルダの中のファイルは通る (相対・絶対どちらでも)。名前と種類を返す', () => {
    const a = resolveAttachable(root, 'note/ch1.md');
    expect(a.ok).toBe(true);
    expect(a.filename).toBe('ch1.md');
    expect(a.mimeType).toBe('text/markdown');
    expect(resolveAttachable(root, path.join(root, 'fig.png'))).toMatchObject({ ok: true, mimeType: 'image/png' });
  });

  test('★ フォルダの外は断る (.. で出る・絶対パスで外を指す)', () => {
    expect(resolveAttachable(root, '../' + path.basename(outside) + '/x.md').ok).toBe(false);
    expect(resolveAttachable(root, path.join(outside, 'x.md')).ok).toBe(false);
  });

  test('★ 「.」で始まるもの (.env / .mcp.json / .git の中) は断る', () => {
    for (const p of ['.env', '.mcp.json', '.git/config']) {
      expect(resolveAttachable(root, p).ok).toBe(false);
    }
  });

  test('★ 鍵らしい名前は断る', () => {
    expect(resolveAttachable(root, 'server.key').ok).toBe(false);
    expect(resolveAttachable(root, 'id_rsa').ok).toBe(false);
  });

  test('★ 無い・フォルダ・上限より大きいものは断る', () => {
    expect(resolveAttachable(root, 'none.md').ok).toBe(false);
    expect(resolveAttachable(root, 'note').ok).toBe(false);
    expect(resolveAttachable(root, 'note/ch1.md', { maxBytes: 3 }).ok).toBe(false);
  });

  test('★ 添付してよいフォルダが決まっていなければ何も通さない', () => {
    expect(resolveAttachable('', 'note/ch1.md').ok).toBe(false);
    expect(resolveAttachable(undefined, 'note/ch1.md').ok).toBe(false);
  });
});

describe('send_file の道具', () => {
  const mockServer = () => {
    const tools = {};
    return { tool: (n, d, s, h) => { tools[n] = { d, s, h }; }, tools };
  };
  const client = () => ({
    pushFile: jest.fn().mockResolvedValue({ message: { id: 'm1', type: 'file' } }),
    pushImage: jest.fn().mockResolvedValue({ message: { id: 'm2', type: 'image' } }),
  });

  test('★ TEALUS_FILE_ROOT を決めていなければ、道具そのものが出ない', () => {
    const s = mockServer();
    registerTools(s, client(), {});
    expect(s.tools.send_file).toBeUndefined();
  });

  test('決めてあれば出る。中身をそのまま pushFile へ (画像は pushImage)', async () => {
    const s = mockServer(); const c = client();
    registerTools(s, c, { fileRoot: root });
    await s.tools.send_file.h({ room_id: 'r1', path: 'note/ch1.md', caption: '第1章' });
    expect(c.pushFile).toHaveBeenCalledWith('r1', expect.any(Buffer), 'ch1.md', 'text/markdown', '第1章');
    expect(c.pushFile.mock.calls[0][1].toString('utf8')).toBe('# 第1章\n');
    await s.tools.send_file.h({ room_id: 'r1', path: 'fig.png' });
    expect(c.pushImage).toHaveBeenCalledWith('r1', expect.any(Buffer), 'fig.png', '');
  });

  test('★ 断るときは送らずに理由を返す', async () => {
    const s = mockServer(); const c = client();
    registerTools(s, c, { fileRoot: root });
    const r = await s.tools.send_file.h({ room_id: 'r1', path: '.env' });
    expect(r.isError).toBe(true);
    expect(c.pushFile).not.toHaveBeenCalled();
  });
});
