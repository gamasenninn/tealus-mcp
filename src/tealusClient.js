/**
 * Tealus Bot API クライアント
 * MCP Server から Tealus Server への HTTP 通信
 */
const fetch = require('node-fetch');
const FormData = require('form-data');

class TealusClient {
  constructor({ apiUrl, userId, password }) {
    this.apiUrl = apiUrl;
    this.userId = userId;
    this.password = password;
    this.token = null;
  }

  async login(force = false) {
    if (this.token && !force) return;
    this.token = null;

    const res = await fetch(`${this.apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login_id: this.userId,
        password: this.password,
      }),
    });

    const data = await res.json();
    if (!data.token) {
      throw new Error(`Login failed: ${data.error || 'Unknown error'}`);
    }
    this.token = data.token;
  }

  /**
   * 非2xx を握り潰さず status/body 付き Error を throw (#303 同型)。
   */
  async _throwIfNotOk(res, method, path) {
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) detail = `: ${parsed.error}`;
    } catch { /* 非 JSON body はそのまま無視 */ }
    const err = new Error(
      `Tealus API ${method} ${path} failed: ${res.status} ${res.statusText}${detail}`
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }

  async _send(method, path, body) {
    await this.login();
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);
    return fetch(`${this.apiUrl}/api${path}`, options);
  }

  /**
   * 認証付きリクエスト (#303)
   *
   * 旧実装は res.ok を見ず res.json() を返していたため、/bot/push 等の失敗 (= 401 token
   * 失効含む) を握り潰し、agent が「送信成功」と扱うのに実際は届かない silent fail を招いた。
   * - 2xx: 従来どおり JSON を返す
   * - 401: bot JWT 失効とみなし token を破棄して 1 回だけ再ログイン retry (直線・再入なし)
   * - 非2xx (401 retry 後含む): status/body 付き Error を throw
   */
  async request(method, path, body = null) {
    let res = await this._send(method, path, body);

    if (res.status === 401) {
      this.token = null;
      await this.login(true);
      res = await this._send(method, path, body);
    }

    await this._throwIfNotOk(res, method, path);
    return res.json();
  }

  /**
   * multipart (image/file) 送信の共通処理。request() と同じ 401 再ログイン retry + ok 検査。
   * form は consume されるため、再送時に buildForm() で作り直す。
   */
  async _sendForm(path, buildForm) {
    await this.login();
    const doSend = async () => {
      const form = buildForm();
      return fetch(`${this.apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          ...form.getHeaders(),
        },
        body: form,
      });
    };

    let res = await doSend();
    if (res.status === 401) {
      this.token = null;
      await this.login(true);
      res = await doSend();
    }

    await this._throwIfNotOk(res, 'POST', path);
    return res.json();
  }

  async pushMessage(roomId, content) {
    return this.request('POST', '/bot/push', { room_id: roomId, content });
  }

  // #336 汎用フォーム primitive: type='form' で投稿。content は可読ヘッダ + fenced tealus-form JSON。
  async pushForm(roomId, content) {
    return this.request('POST', '/bot/push', { room_id: roomId, content, type: 'form' });
  }

  async pushImage(roomId, buffer, filename, caption = '') {
    return this._sendForm('/api/bot/push-image', () => {
      const form = new FormData();
      form.append('room_id', roomId);
      form.append('image', buffer, { filename, contentType: 'image/png' });
      if (caption) form.append('content', caption);
      return form;
    });
  }

  async pushFile(roomId, buffer, filename, mimeType, content = '') {
    return this._sendForm('/api/bot/push-file', () => {
      const form = new FormData();
      form.append('room_id', roomId);
      form.append('file', buffer, { filename, contentType: mimeType });
      if (content) form.append('content', content);
      return form;
    });
  }

  async getMessages(roomId, limit = 20, options = {}) {
    const { includeTranscription, includeRaw } = options;
    const params = new URLSearchParams({ room_id: roomId, limit: String(limit) });
    if (includeTranscription !== undefined) {
      params.set('include_transcription', String(includeTranscription));
    }
    if (includeRaw !== undefined) {
      params.set('include_raw', String(includeRaw));
    }
    return this.request('GET', `/bot/messages?${params.toString()}`);
  }

  async getRooms() {
    return this.request('GET', '/bot/rooms');
  }

  async joinRoom(roomId) {
    return this.request('POST', `/bot/rooms/${roomId}/join`);
  }

  async markRead(messageIds) {
    return this.request('POST', '/bot/mark-read', { message_ids: messageIds });
  }

  async getMessageMedia(messageId, index) {
    // #316: 複数添付メッセージは index で N 枚目を取得 (省略時は 0 枚目、後方互換)
    const qs = new URLSearchParams();
    if (index !== undefined && index !== null) qs.set('index', String(index));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request('GET', `/bot/messages/${messageId}/media${suffix}`);
  }

  /**
   * メッセージの編集履歴 (text edits + voice/video transcription versions) を統合返却。
   *
   * 動機: organon daily cycle で raw STT vs user-corrected pair を直接観察できるように
   * (= 5/24 user 提案、別 mining script (= server/scripts/mine_transcription_aliases.js)
   * の自動化代替、organic ontology paradigm の simplicity 1 instrument 主義)。
   *
   * @param {string} messageId
   * @returns {Promise<{
   *   message_id, type, room_id, sender_id, is_edited, created_at,
   *   current_content,
   *   text_edit_history: Array<{version, content, edited_by, created_at}>,
   *   voice_transcription_versions: Array<{version, raw_text, formatted_text, status, edited_by, created_at}>
   * }>}
   */
  async getMessageEditHistory(messageId) {
    return this.request('GET', `/bot/messages/${messageId}/edit-history`);
  }

  /**
   * 既存メッセージの本文を差し替える (tealus#394)。
   *
   * ★ `/bot/*` ではなく通常のルーム API を叩く。bot も `/api/auth/login` で user JWT を
   *   取っているため呼べる。編集可否は server 側の `message_edit_policy` が判定する
   *   (`none` のルームは 403、`sender` は送信者のみ、`member` はメンバーなら可)。
   *   ここで policy を再実装しない —— 判定を 2 か所に置くと必ずずれる。
   *
   * server 側が旧版を `message_edits` に version として積むので、元の本文は失われない。
   *
   * @param {string} roomId
   * @param {string} messageId
   * @param {string} content - 差し替え後の本文 (全文)
   * @returns {Promise<{message: object}>}
   */
  async editMessage(roomId, messageId, content) {
    return this.request('PUT', `/rooms/${roomId}/messages/${messageId}`, { content });
  }

  /**
   * 動画/音声メッセージの文字起こしを取得する。
   *
   * - 既存 cached (status='done') があれば即返却 (`cached: true`)
   * - cache 無 or `force_retranscribe=true` の場合、server 側で transcribe + format を同期実行
   * - video は server 側で ffmpeg -vn で audio 抽出してから Whisper API 経由 (25MB 上限対策)
   *
   * @param {string} messageId
   * @param {object} [options]
   * @param {boolean} [options.force=false] - 既存 cache を無視して再 transcribe
   * @returns {Promise<{status, message_type, formatted_text, raw_text, language, cached, model, version}>}
   */
  async transcribeMedia(messageId, options = {}) {
    return this.request('POST', `/bot/messages/${messageId}/transcribe`, {
      force_retranscribe: options.force === true,
    });
  }

  async searchMessages(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    return this.request('GET', `/bot/search?${qs.toString()}`);
  }

  async getTags(limit = 30) {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    return this.request('GET', `/bot/tags?${qs.toString()}`);
  }

  async markTagDone(messageId, tagName, isDone) {
    return this.request(
      'PATCH',
      `/bot/messages/${messageId}/tags/${encodeURIComponent(tagName)}/done`,
      { is_done: isDone }
    );
  }

  async createRoom(name, memberIds = [], type = 'group') {
    return this.request('POST', '/rooms', {
      name,
      type,
      member_ids: Array.isArray(memberIds) ? memberIds : [],
    });
  }

  async deleteRoom(roomId) {
    return this.request('DELETE', `/rooms/${roomId}`);
  }
}

module.exports = { TealusClient };
