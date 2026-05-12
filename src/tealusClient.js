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

  async login() {
    if (this.token) return;

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

  async request(method, path, body = null) {
    await this.login();
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this.apiUrl}/api${path}`, options);
    return res.json();
  }

  async pushMessage(roomId, content) {
    return this.request('POST', '/bot/push', { room_id: roomId, content });
  }

  async pushImage(roomId, buffer, filename, caption = '') {
    await this.login();
    const form = new FormData();
    form.append('room_id', roomId);
    form.append('image', buffer, { filename, contentType: 'image/png' });
    if (caption) form.append('content', caption);

    const res = await fetch(`${this.apiUrl}/api/bot/push-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        ...form.getHeaders(),
      },
      body: form,
    });
    return res.json();
  }

  async pushFile(roomId, buffer, filename, mimeType, content = '') {
    await this.login();
    const form = new FormData();
    form.append('room_id', roomId);
    form.append('file', buffer, { filename, contentType: mimeType });
    if (content) form.append('content', content);

    const res = await fetch(`${this.apiUrl}/api/bot/push-file`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        ...form.getHeaders(),
      },
      body: form,
    });
    return res.json();
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

  async getMessageMedia(messageId) {
    return this.request('GET', `/bot/messages/${messageId}/media`);
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
