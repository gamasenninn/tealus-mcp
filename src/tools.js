/**
 * Tealus MCP ツール定義
 * Bot API の各機能を MCP ツールとして公開
 */
const { z } = require('zod');

/**
 * MCP Server にツールを登録
 */
function registerTools(server, client) {
  // 1. send_message
  server.tool(
    'send_message',
    'Tealus のルームにテキストメッセージを送信する',
    { room_id: z.string().describe('送信先ルームID'), content: z.string().describe('メッセージ内容') },
    async ({ room_id, content }) => {
      const result = await client.pushMessage(room_id, content);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 2. send_image
  server.tool(
    'send_image',
    'Tealus のルームに画像を送信する（base64エンコード）',
    {
      room_id: z.string().describe('送信先ルームID'),
      image_base64: z.string().describe('画像データ（base64エンコード）'),
      filename: z.string().describe('ファイル名（例: chart.png）'),
      caption: z.string().optional().describe('キャプション（任意）'),
    },
    async ({ room_id, image_base64, filename, caption }) => {
      const buffer = Buffer.from(image_base64, 'base64');
      const result = await client.pushImage(room_id, buffer, filename, caption || '');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 3. get_messages
  server.tool(
    'get_messages',
    'ルームのメッセージ履歴を取得する',
    {
      room_id: z.string().describe('ルームID'),
      limit: z.number().optional().describe('取得件数（デフォルト20、最大100）'),
    },
    async ({ room_id, limit }) => {
      const result = await client.getMessages(room_id, limit || 20);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 4. list_rooms
  server.tool(
    'list_rooms',
    '参加中のルーム一覧を取得する',
    {},
    async () => {
      const result = await client.getRooms();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 5. join_room
  server.tool(
    'join_room',
    '指定したルームに参加する',
    { room_id: z.string().describe('参加するルームID') },
    async ({ room_id }) => {
      const result = await client.joinRoom(room_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 6. mark_read
  server.tool(
    'mark_read',
    'メッセージを既読にする',
    { message_ids: z.array(z.string()).describe('既読にするメッセージIDの配列') },
    async ({ message_ids }) => {
      const result = await client.markRead(message_ids);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 7. get_message_media
  server.tool(
    'get_message_media',
    'メッセージに紐づくメディア (画像/動画/音声) を取得する。画像は AI が直接「見る」ことができる',
    { message_id: z.string().describe('メッセージID') },
    async ({ message_id }) => {
      const result = await client.getMessageMedia(message_id);
      if (result.error) {
        return { content: [{ type: 'text', text: `エラー: ${result.error}` }] };
      }

      // 画像は MCP image content で返し AI が直接視認できるようにする
      if (result.type === 'image' && result.data_base64 && result.mime_type?.startsWith('image/')) {
        return {
          content: [
            {
              type: 'image',
              data: result.data_base64,
              mimeType: result.mime_type,
            },
            {
              type: 'text',
              text: `画像: ${result.file_name} (${result.mime_type}, ${result.file_size} bytes)`,
            },
          ],
        };
      }

      // 音声は文字起こし優先で返す (MCP の audio content type は対応 client が限定的)
      if (result.type === 'voice') {
        const trans = result.transcription;
        const lines = [`音声メッセージ: ${result.file_name} (${result.mime_type}, ${result.file_size} bytes)`];
        if (trans?.formatted_text || trans?.raw_text) {
          lines.push('', '=== 文字起こし ===', trans.formatted_text || trans.raw_text);
        } else {
          lines.push('', '(文字起こし未完了または失敗)');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // 動画・その他: メタ情報のみ (バイナリは大きすぎることが多いため text 化しない)
      return {
        content: [
          {
            type: 'text',
            text: `メディア: ${result.file_name} (type=${result.type}, ${result.mime_type}, ${result.file_size} bytes)\n` +
                  `データは base64 で取得可能ですが、MCP text 応答には大きすぎるためメタ情報のみ返しています。`,
          },
        ],
      };
    }
  );
}

module.exports = { registerTools };
