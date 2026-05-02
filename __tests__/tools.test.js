/**
 * Tealus MCP ツール テスト
 */

const { TealusClient } = require('../src/tealusClient');
const { registerTools } = require('../src/tools');

// McpServer のモック
function createMockServer() {
  const tools = {};
  return {
    tool: (name, description, schema, handler) => {
      tools[name] = { description, schema, handler };
    },
    getTools: () => tools,
    callTool: async (name, args) => {
      const tool = tools[name];
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool.handler(args);
    },
  };
}

// TealusClient のモック
function createMockClient() {
  return {
    pushMessage: jest.fn().mockResolvedValue({ message: { id: 'msg1', content: 'hello' } }),
    pushImage: jest.fn().mockResolvedValue({ message: { id: 'msg2', type: 'image' }, media: [] }),
    getMessages: jest.fn().mockResolvedValue({ messages: [{ id: 'msg1', content: 'test' }] }),
    getRooms: jest.fn().mockResolvedValue({ rooms: [{ id: 'room1', name: 'General' }] }),
    joinRoom: jest.fn().mockResolvedValue({ success: true }),
    markRead: jest.fn().mockResolvedValue({ success: true, count: 2 }),
    getMessageMedia: jest.fn(),
    searchMessages: jest.fn(),
    markTagDone: jest.fn(),
    createRoom: jest.fn(),
    deleteRoom: jest.fn(),
  };
}

describe('Tealus MCP Tools', () => {
  let server, client;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    registerTools(server, client);
  });

  test('11ツールが登録される', () => {
    const tools = server.getTools();
    expect(Object.keys(tools)).toHaveLength(11);
    expect(tools).toHaveProperty('send_message');
    expect(tools).toHaveProperty('send_image');
    expect(tools).toHaveProperty('get_messages');
    expect(tools).toHaveProperty('list_rooms');
    expect(tools).toHaveProperty('join_room');
    expect(tools).toHaveProperty('mark_read');
    expect(tools).toHaveProperty('get_message_media');
    expect(tools).toHaveProperty('search_messages');
    expect(tools).toHaveProperty('mark_tag_done');
    expect(tools).toHaveProperty('create_room');
    expect(tools).toHaveProperty('delete_room');
  });

  test('send_message がメッセージを送信する', async () => {
    const result = await server.callTool('send_message', { room_id: 'room1', content: 'hello' });
    expect(client.pushMessage).toHaveBeenCalledWith('room1', 'hello');
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toHaveProperty('message');
  });

  test('send_image が画像を送信する', async () => {
    const base64 = Buffer.from('fake-image').toString('base64');
    const result = await server.callTool('send_image', {
      room_id: 'room1',
      image_base64: base64,
      filename: 'test.png',
      caption: 'テスト画像',
    });
    expect(client.pushImage).toHaveBeenCalledWith(
      'room1',
      expect.any(Buffer),
      'test.png',
      'テスト画像'
    );
    expect(result.content[0].type).toBe('text');
  });

  describe('get_messages', () => {
    test('メッセージ履歴を取得する (limit 指定)', async () => {
      const result = await server.callTool('get_messages', { room_id: 'room1', limit: 10 });
      expect(client.getMessages).toHaveBeenCalledWith('room1', 10, {
        includeTranscription: undefined,
        includeRaw: undefined,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toHaveLength(1);
    });

    test('limit デフォルトは20', async () => {
      await server.callTool('get_messages', { room_id: 'room1' });
      expect(client.getMessages).toHaveBeenCalledWith('room1', 20, {
        includeTranscription: undefined,
        includeRaw: undefined,
      });
    });

    test('include_raw=true を指定すると options で透過する', async () => {
      await server.callTool('get_messages', { room_id: 'room1', include_raw: true });
      expect(client.getMessages).toHaveBeenCalledWith('room1', 20, {
        includeTranscription: undefined,
        includeRaw: true,
      });
    });

    test('include_transcription=false を指定すると options で透過する (id-only モード)', async () => {
      await server.callTool('get_messages', { room_id: 'room1', include_transcription: false });
      expect(client.getMessages).toHaveBeenCalledWith('room1', 20, {
        includeTranscription: false,
        includeRaw: undefined,
      });
    });

    test('flag 両方指定 (include_transcription=true, include_raw=true) も透過する', async () => {
      await server.callTool('get_messages', {
        room_id: 'room1',
        limit: 5,
        include_transcription: true,
        include_raw: true,
      });
      expect(client.getMessages).toHaveBeenCalledWith('room1', 5, {
        includeTranscription: true,
        includeRaw: true,
      });
    });
  });

  test('list_rooms がルーム一覧を取得する', async () => {
    const result = await server.callTool('list_rooms', {});
    expect(client.getRooms).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rooms).toHaveLength(1);
  });

  test('join_room がルームに参加する', async () => {
    const result = await server.callTool('join_room', { room_id: 'room1' });
    expect(client.joinRoom).toHaveBeenCalledWith('room1');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  test('mark_read が既読にする', async () => {
    const result = await server.callTool('mark_read', { message_ids: ['msg1', 'msg2'] });
    expect(client.markRead).toHaveBeenCalledWith(['msg1', 'msg2']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });

  describe('get_message_media', () => {
    test('image を image content として返す (AI が直接視認できる形式)', async () => {
      client.getMessageMedia.mockResolvedValue({
        type: 'image',
        mime_type: 'image/png',
        file_name: 'photo.png',
        file_size: 12345,
        data_base64: 'aGVsbG8=',
      });
      const result = await server.callTool('get_message_media', { message_id: 'msg-img-1' });
      expect(client.getMessageMedia).toHaveBeenCalledWith('msg-img-1');
      expect(result.content[0]).toEqual({ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toContain('photo.png');
    });

    test('voice は文字起こしを優先して text で返す', async () => {
      client.getMessageMedia.mockResolvedValue({
        type: 'voice',
        mime_type: 'audio/wav',
        file_name: 'voice.wav',
        file_size: 9999,
        data_base64: 'wave-data',
        transcription: { formatted_text: 'お疲れ様です', raw_text: 'お疲れ様です', status: 'done' },
      });
      const result = await server.callTool('get_message_media', { message_id: 'msg-v-1' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('お疲れ様です');
      expect(result.content[0].text).toContain('voice.wav');
    });

    test('voice で文字起こし無しのケース', async () => {
      client.getMessageMedia.mockResolvedValue({
        type: 'voice',
        mime_type: 'audio/wav',
        file_name: 'voice.wav',
        file_size: 9999,
        data_base64: 'wave-data',
      });
      const result = await server.callTool('get_message_media', { message_id: 'msg-v-2' });
      expect(result.content[0].text).toContain('文字起こし未完了または失敗');
    });

    test('video など他タイプはメタ情報のみ返す', async () => {
      client.getMessageMedia.mockResolvedValue({
        type: 'video',
        mime_type: 'video/mp4',
        file_name: 'clip.mp4',
        file_size: 8388608,
        data_base64: 'big-data',
      });
      const result = await server.callTool('get_message_media', { message_id: 'msg-vid-1' });
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('clip.mp4');
      expect(result.content[0].text).toContain('video/mp4');
      expect(result.content[0].text).not.toContain('big-data'); // base64 は埋め込まない
    });

    test('error 応答を text で返す', async () => {
      client.getMessageMedia.mockResolvedValue({ error: 'メッセージが見つかりません' });
      const result = await server.callTool('get_message_media', { message_id: 'unknown' });
      expect(result.content[0].text).toContain('エラー');
      expect(result.content[0].text).toContain('メッセージが見つかりません');
    });
  });

  describe('search_messages', () => {
    test('client.searchMessages が引数とともに呼ばれる', async () => {
      client.searchMessages.mockResolvedValue({ results: [], has_more: false, next_offset: null });
      await server.callTool('search_messages', { q: '削除', limit: 5 });
      expect(client.searchMessages).toHaveBeenCalledWith({ q: '削除', limit: 5 });
    });

    test('レスポンスが JSON 文字列で text として返る', async () => {
      const mockResult = {
        results: [{
          message_id: 'm1',
          room_name: 'Web部',
          snippet: '...設計上の **削除** 確認...',
        }],
        has_more: false,
        next_offset: null,
      };
      client.searchMessages.mockResolvedValue(mockResult);
      const result = await server.callTool('search_messages', { q: '削除' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].snippet).toContain('**削除**');
    });

    test('snippet ハイライトが透過する', async () => {
      client.searchMessages.mockResolvedValue({
        results: [{ message_id: 'm1', snippet: 'before **match** after' }],
        has_more: false,
      });
      const result = await server.callTool('search_messages', { q: 'match' });
      expect(result.content[0].text).toContain('**match**');
    });

    test('has_more / next_offset が透過する', async () => {
      client.searchMessages.mockResolvedValue({
        results: new Array(10).fill({}).map((_, i) => ({ message_id: `m${i}` })),
        has_more: true,
        next_offset: 10,
      });
      const result = await server.callTool('search_messages', { q: 'test', limit: 10 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_offset).toBe(10);
    });

    test('空 results の応答も正しく返す', async () => {
      client.searchMessages.mockResolvedValue({ results: [], has_more: false, next_offset: null });
      const result = await server.callTool('search_messages', { q: 'no-match' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toEqual([]);
      expect(parsed.has_more).toBe(false);
    });
  });

  describe('create_room', () => {
    test('client.createRoom が引数とともに呼ばれる (member_ids あり)', async () => {
      client.createRoom.mockResolvedValue({ room: { id: 'r1', name: 'AI班連絡' }, members: [] });
      await server.callTool('create_room', { name: 'AI班連絡', member_ids: ['u1', 'u2'] });
      expect(client.createRoom).toHaveBeenCalledWith('AI班連絡', ['u1', 'u2'], 'group');
    });

    test('member_ids 省略時は空配列で呼ばれる', async () => {
      client.createRoom.mockResolvedValue({ room: { id: 'r1', name: 'solo' }, members: [] });
      await server.callTool('create_room', { name: 'solo' });
      expect(client.createRoom).toHaveBeenCalledWith('solo', [], 'group');
    });

    test('type 省略時は "group" で呼ばれる', async () => {
      client.createRoom.mockResolvedValue({ room: { id: 'r1' }, members: [] });
      await server.callTool('create_room', { name: 'test', member_ids: ['u1'] });
      const call = client.createRoom.mock.calls[0];
      expect(call[2]).toBe('group');
    });

    test('成功レスポンスを JSON で返す', async () => {
      const mockResult = {
        room: { id: 'r-uuid', type: 'group', name: 'test', created_at: '2026-04-29T10:00:00Z' },
        members: [{ user_id: 'bot', display_name: 'Claude', role: 'admin' }],
      };
      client.createRoom.mockResolvedValue(mockResult);
      const result = await server.callTool('create_room', { name: 'test' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.room.id).toBe('r-uuid');
      expect(parsed.room.name).toBe('test');
      expect(parsed.members).toHaveLength(1);
    });

    test('error 応答を JSON でそのまま透過する', async () => {
      client.createRoom.mockResolvedValue({ error: 'グループ名は必須です' });
      const result = await server.callTool('create_room', { name: '' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('グループ名は必須');
    });

    test('複数メンバー追加が透過する (10 名)', async () => {
      const memberIds = Array.from({ length: 10 }, (_, i) => `user-${i}`);
      client.createRoom.mockResolvedValue({ room: { id: 'r2' }, members: memberIds.map(id => ({ user_id: id })) });
      await server.callTool('create_room', { name: 'big group', member_ids: memberIds });
      expect(client.createRoom).toHaveBeenCalledWith('big group', memberIds, 'group');
    });
  });

  describe('delete_room', () => {
    test('client.deleteRoom が引数とともに呼ばれる', async () => {
      client.deleteRoom.mockResolvedValue({ success: true, room_id: 'r1' });
      await server.callTool('delete_room', { room_id: 'r1' });
      expect(client.deleteRoom).toHaveBeenCalledWith('r1');
    });

    test('成功レスポンスを JSON で返す', async () => {
      client.deleteRoom.mockResolvedValue({ success: true, room_id: 'r-uuid' });
      const result = await server.callTool('delete_room', { room_id: 'r-uuid' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.room_id).toBe('r-uuid');
    });

    test('non-creator エラー (403) を透過する', async () => {
      client.deleteRoom.mockResolvedValue({ error: 'ルームを作成した本人のみ削除できます' });
      const result = await server.callTool('delete_room', { room_id: 'r1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('作成した本人');
    });

    test('他メンバーあり (409) を透過する', async () => {
      client.deleteRoom.mockResolvedValue({ error: '他のメンバーが残っているため削除できません。先にメンバーを退会させてください。' });
      const result = await server.callTool('delete_room', { room_id: 'r1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('他のメンバー');
    });

    test('not found (404) を透過する', async () => {
      client.deleteRoom.mockResolvedValue({ error: 'ルームが見つかりません' });
      const result = await server.callTool('delete_room', { room_id: 'unknown' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('見つかりません');
    });
  });

  describe('mark_tag_done', () => {
    test('client.markTagDone が引数とともに呼ばれる', async () => {
      client.markTagDone.mockResolvedValue({ success: true, message_id: 'm1', tag_name: 'TODO', is_done: true });
      await server.callTool('mark_tag_done', { message_id: 'm1', tag_name: 'TODO', is_done: true });
      expect(client.markTagDone).toHaveBeenCalledWith('m1', 'TODO', true);
    });

    test('成功レスポンスを JSON で返す', async () => {
      client.markTagDone.mockResolvedValue({ success: true, message_id: 'm1', tag_name: 'tealus関係', is_done: true });
      const result = await server.callTool('mark_tag_done', { message_id: 'm1', tag_name: 'tealus関係', is_done: true });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.is_done).toBe(true);
    });

    test('is_done=false でも呼べる', async () => {
      client.markTagDone.mockResolvedValue({ success: true, is_done: false });
      await server.callTool('mark_tag_done', { message_id: 'm1', tag_name: 'TODO', is_done: false });
      expect(client.markTagDone).toHaveBeenCalledWith('m1', 'TODO', false);
    });

    test('error レスポンスをそのまま透過する', async () => {
      client.markTagDone.mockResolvedValue({ error: 'タグ "X" がこのルームに存在しません' });
      const result = await server.callTool('mark_tag_done', { message_id: 'm1', tag_name: 'X', is_done: true });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('存在しません');
    });
  });
});

describe('TealusClient', () => {
  test('コンストラクタが設定を保持する', () => {
    const client = new TealusClient({
      apiUrl: 'http://localhost:3000',
      userId: 'tanaka',
      password: 'pass',
    });
    expect(client.apiUrl).toBe('http://localhost:3000');
    expect(client.userId).toBe('tanaka');
    expect(client.token).toBeNull();
  });
});
