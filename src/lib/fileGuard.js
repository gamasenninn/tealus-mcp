/**
 * send_file で添付してよいかの判定 (tealus 改善ループ 89)。
 *
 * ★ この道具は「AI がこの機械のファイルを部屋に出せる口」なので、次を全部満たすものだけを通す:
 *   1. 添付してよいフォルダ (TEALUS_FILE_ROOT) が決まっている。決まっていなければ何も通さない
 *   2. 実体 (シンボリックリンク・ジャンクションをたどった先) がそのフォルダの中
 *   3. フォルダからの道のりに「.」で始まる名前が無い (.env / .mcp.json / .git / .claude の中を出さない)
 *   4. 鍵らしい名前でない (*.key / *.pem / id_rsa など)
 *   5. 普通のファイルで、大きさが上限以下
 */
const fs = require('fs');
const path = require('path');

const MIME = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.html': 'text/html', '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
  '.ttl': 'text/turtle', '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/plain',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** 本体の添付の上限 (server/src/middleware/upload.mts の SIZE_LIMITS) に合わせる。動画は道具では送らないので文書と同じ */
const LIMIT_IMAGE = 10 * 1024 * 1024;
const LIMIT_DEFAULT = 100 * 1024 * 1024;

const SECRET_NAME = /(\.(key|pem|p12|pfx|crt|cer|keystore|jks)$)|(^id_(rsa|dsa|ecdsa|ed25519)(\.|$))|secret|credential/i;

function mimeOf(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

/**
 * @returns {{ ok: true, absPath: string, filename: string, mimeType: string, size: number } | { ok: false, reason: string }}
 */
function resolveAttachable(root, p, opts = {}) {
  if (!root || typeof root !== 'string') return { ok: false, reason: '添付してよいフォルダ (TEALUS_FILE_ROOT) が決まっていません' };
  if (!p || typeof p !== 'string') return { ok: false, reason: 'パスがありません' };
  let realRoot, real;
  try { realRoot = fs.realpathSync(root); } catch { return { ok: false, reason: '添付してよいフォルダが見つかりません' }; }
  try { real = fs.realpathSync(path.resolve(realRoot, p)); } catch { return { ok: false, reason: 'ファイルが見つかりません' }; }

  const rel = path.relative(realRoot, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, reason: '添付してよいフォルダの外です' };
  const parts = rel.split(/[\\/]+/);
  if (parts.some((s) => s.startsWith('.'))) return { ok: false, reason: '「.」で始まるファイル・フォルダの中は添付しません (秘密の設定が入るため)' };
  const filename = parts[parts.length - 1];
  if (SECRET_NAME.test(filename)) return { ok: false, reason: '鍵や秘密らしい名前のファイルは添付しません' };

  let st;
  try { st = fs.statSync(real); } catch { return { ok: false, reason: 'ファイルが見つかりません' }; }
  if (!st.isFile()) return { ok: false, reason: '普通のファイルではありません' };
  const mimeType = mimeOf(filename);
  const max = opts.maxBytes ?? (mimeType.startsWith('image/') ? LIMIT_IMAGE : LIMIT_DEFAULT);
  if (st.size > max) return { ok: false, reason: `大きすぎます (${st.size} バイト、上限 ${max} バイト)` };
  return { ok: true, absPath: real, filename, mimeType, size: st.size };
}

module.exports = { resolveAttachable, mimeOf };
