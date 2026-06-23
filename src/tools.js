/**
 * Tealus MCP ツール定義
 * Bot API の各機能を MCP ツールとして公開
 */
const { z } = require('zod');
const { extractText } = require('./lib/documentReader');

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
    'ルームのメッセージ履歴を取得する。voice メッセージの transcription は default で formatted_text のみ inline (raw_text は省略)。' +
    'verbosity 制御: include_raw=true で raw_text を追加、include_transcription=false で text を省略し id+status+version のみ返す (大量取得時の軽量モード)。',
    {
      room_id: z.string().describe('ルームID'),
      limit: z.number().optional().describe('取得件数（デフォルト20、最大100）'),
      include_transcription: z.boolean().optional().describe('voice の transcription text を含めるか (default true、false で id/status/version のみ)'),
      include_raw: z.boolean().optional().describe('raw_text (Whisper 生出力) を含めるか (default false、debug / 整形精度評価用)'),
    },
    async ({ room_id, limit, include_transcription, include_raw }) => {
      const result = await client.getMessages(room_id, limit || 20, {
        includeTranscription: include_transcription,
        includeRaw: include_raw,
      });
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

  // 7. search_messages
  server.tool(
    'search_messages',
    '直近の議論を検索する。snippet は索引、詳細が要れば get_messages で再取得する。' +
    '使い方: まず q + room_id か since/until で narrow に絞る → 結果が少なすぎたら範囲を広げる。' +
    '日本語 2 文字 query は index が効きにくく遅い (3 文字以上推奨)。' +
    'q / room_id / sender_id / since / tag_names / type のうち少なくとも 1 つを指定すること。',
    {
      q: z.string().optional().describe('キーワード (ILIKE)。3 文字以上推奨'),
      room_id: z.string().optional().describe('単一ルーム指定 (省略時 cross-room)'),
      sender_id: z.string().optional().describe('発言者の user ID'),
      type: z.enum(['text', 'image', 'voice', 'video', 'stamp', 'system']).optional().describe('メッセージ type 絞り込み'),
      tag_names: z.string().optional().describe('CSV、タグ AND 検索 (例: "TODO,important")'),
      is_done: z.boolean().optional().describe('TODO 完了状態 (tag_names 指定時)'),
      since: z.string().optional().describe('開始日時 ISO 8601'),
      until: z.string().optional().describe('終了日時 ISO 8601'),
      limit: z.number().min(1).max(50).optional().describe('default 10, max 50'),
      offset: z.number().min(0).optional().describe('default 0、has_more=true 時の続きは next_offset'),
    },
    async (args) => {
      const result = await client.searchMessages(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 8. list_tags (#254 — discovery primitive)
  server.tool(
    'list_tags',
    'Bot がメンバーである全 room の tag 一覧を usage 順 (利用回数 desc) で返す。' +
    'tag 名を知らない時に search_messages の前段で discovery として使う (= 「正解の tag 名を当てるゲーム」を防ぐ)。' +
    'is_todo=true の tag は TODO 系 (search_messages の tag_names + is_done filter で進捗管理可能)。' +
    'response: { tags: [{ name, is_todo, total_usage }] }',
    {
      limit: z.number().min(1).max(100).optional().describe('取得件数 (default 30、max 100)'),
    },
    async ({ limit }) => {
      const result = await client.getTags(limit);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 9. mark_tag_done
  server.tool(
    'mark_tag_done',
    'メッセージに付いた特定タグの完了状態 (is_done) を更新する。' +
    'TODO 系タグ (is_todo=true) の場合のみ意味を持つ。' +
    'search_messages で見つけた完了済議題を即マーク更新できる。',
    {
      message_id: z.string().describe('メッセージID'),
      tag_name: z.string().describe('タグ名 (room スコープで解決される)'),
      is_done: z.boolean().describe('true で完了、false で未完了'),
    },
    async ({ message_id, tag_name, is_done }) => {
      const result = await client.markTagDone(message_id, tag_name, is_done);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 11. delete_room
  server.tool(
    'delete_room',
    'グループルームを削除する。**破壊的操作**: メッセージ・メンバー・タグ等が CASCADE で削除される。' +
    '安全制約: (1) 自分が作成者であること (rooms.created_by) (2) 自分以外のメンバーが残っていないこと (= solo)。' +
    '他のメンバーが残っている場合は先に退会させる必要がある。' +
    'direct ルームは削除不可 (この endpoint は group のみ)。',
    {
      room_id: z.string().describe('削除するルームID'),
    },
    async ({ room_id }) => {
      const result = await client.deleteRoom(room_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 10. create_room
  server.tool(
    'create_room',
    '新しいグループルームを作成する。呼び出した bot は admin として自動追加される。' +
    '用途: AI 班連絡用ルーム / 議題スレッド / 期間限定タスク / インシデント対応など、' +
    'AI が組織を能動的に編成したいときに使う primitive。' +
    'name は必須。member_ids 省略時は bot 1 人だけのルームになる。' +
    'type は現状 "group" のみ対応 (direct ルームは別 endpoint)。',
    {
      name: z.string().describe('ルーム名 (必須、空文字不可)'),
      member_ids: z.array(z.string()).optional().describe('追加メンバーの user_id 配列。省略時は bot のみ'),
      type: z.enum(['group']).optional().describe('default: "group"。現状 group のみサポート'),
    },
    async ({ name, member_ids, type }) => {
      const result = await client.createRoom(name, member_ids || [], type || 'group');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 9. get_message_media
  server.tool(
    'get_message_media',
    'メッセージに紐づくメディア (画像/動画/音声) を取得する。画像は AI が直接「見る」ことができる。複数画像が添付されたメッセージは index (0始まり) で1枚ずつ取得する (返り値の media_count を見て全枚 index=0,1,… で呼ぶ)。',
    {
      message_id: z.string().describe('メッセージID'),
      index: z.number().int().min(0).optional().describe('複数添付メッセージで N 枚目 (0始まり) を取得。省略時は 0 枚目。返り値 media_count で総数を確認'),
    },
    async ({ message_id, index }) => {
      const result = await client.getMessageMedia(message_id, index);
      if (result.error) {
        return { content: [{ type: 'text', text: `エラー: ${result.error}` }] };
      }

      // 画像は MCP image content で返し AI が直接視認できるようにする
      // mime_type ベースで判定 (= type='file' で添付された image も救う、Tealus #292 6/7 Day 22)
      // 旧: result.type === 'image' AND check → LINE で「ファイル」添付された image (= type='file') が fall through
      if (result.mime_type?.startsWith('image/') && result.data_base64) {
        // #316: 複数画像メッセージなら、エージェントに残りの index 取得を促す案内を付ける
        const count = result.media_count || 1;
        const cur = (result.index ?? 0) + 1;
        let note = `画像: ${result.file_name} (${result.mime_type}, ${result.file_size} bytes)`;
        if (count > 1) {
          note += `\nこのメッセージには画像が ${count} 枚あります。これは ${cur}/${count} 枚目です。`
                + `残りは get_message_media を index=0,1,…,${count - 1} で呼び出して全枚取得してください。`;
        }
        return {
          content: [
            {
              type: 'image',
              data: result.data_base64,
              mimeType: result.mime_type,
            },
            {
              type: 'text',
              text: note,
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

      // text/* mime で size が小さければ data_base64 を decode して inline 返却 (#281 Std fix)
      // Light agent が自作 markdown attachment 等を read_document を経由せず直接読めるようにする
      const MAX_INLINE_TEXT_BYTES = 100 * 1024; // 100KB
      if (result.mime_type?.startsWith('text/') && result.file_size <= MAX_INLINE_TEXT_BYTES && result.data_base64) {
        const text = Buffer.from(result.data_base64, 'base64').toString('utf8');
        return {
          content: [
            {
              type: 'text',
              text: `${result.file_name} (${result.mime_type}, ${result.file_size} bytes)\n\n=== 内容 ===\n${text}`,
            },
          ],
        };
      }

      // 動画 / 大型 text / 非 text mime: metadata のみ + honest 理由 + 代替 tool 案内
      const overTextLimit = result.mime_type?.startsWith('text/') && result.file_size > MAX_INLINE_TEXT_BYTES;
      const sizeReason = overTextLimit
        ? `text/* mime ですが ${MAX_INLINE_TEXT_BYTES} bytes (100 KB) 上限を超過、inline 化スキップ`
        : `非 text mime のため inline 化対象外`;
      return {
        content: [
          {
            type: 'text',
            text: `メディア: ${result.file_name} (type=${result.type}, ${result.mime_type}, ${result.file_size} bytes)\n` +
                  `${sizeReason}。text 化が必要なら read_document (PDF / DOCX / XLSX / text/*) or transcribe_media (動画 / 音声) を試す。`,
          },
        ],
      };
    }
  );

  // 12. send_text_as_file (#260)
  // Light v1 の custom tool `share_text_as_file` を MCP 化、Light v2 (codex)
  // からも同じ動作で使えるようにする。長文の text (要約 / レポート / コード等) を
  // file 添付として投稿、chat 表示が肥大しない。
  server.tool(
    'send_text_as_file',
    'Tealus のルームに text 内容を file (.txt / .md 等) として送信する。長文の要約 / レポート / コード等で chat 流れを切らずに添付したい時に使う。',
    {
      room_id: z.string().describe('送信先ルームID'),
      content: z.string().describe('file の内容 (text)'),
      filename: z.string().describe('ファイル名 (拡張子付き、例: summary.md, report.txt, output.py)'),
      mime_type: z.string().optional().describe('MIME type (default: text/plain、.md なら text/markdown 等)'),
      caption: z.string().optional().describe('添付メッセージ text (任意、添付理由などの 1-2 行説明)'),
    },
    async ({ room_id, content, filename, mime_type, caption }) => {
      const buffer = Buffer.from(content, 'utf-8');
      const mt = mime_type || (filename.endsWith('.md') ? 'text/markdown' : 'text/plain');
      const result = await client.pushFile(room_id, buffer, filename, mt, caption || '');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // 13. generate_and_send_image (#260)
  // Light v1 の custom tool `generate_image` を MCP 化、DALL-E 3 で画像生成 →
  // Tealus に投稿する composite action。Light v2 (codex SDK 経由) からも使える。
  // OPENAI_API_KEY を env で必要 (Light v2 が subscription mode でも image gen は API 経由)。
  server.tool(
    'generate_and_send_image',
    '画像を生成して Tealus のルームに送信する。prompt は英語が精度高い (日本語 OK だが意訳される)。OPENAI_API_KEY env が必要。モデルは env OPENAI_IMAGE_MODEL で変更可 (default gpt-image-1)。',
    {
      room_id: z.string().describe('送信先ルームID'),
      prompt: z.string().describe('画像生成 prompt (英語推奨、日本語可)'),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).optional().describe('画像サイズ (default: 1024x1024)'),
      caption: z.string().optional().describe('画像に添える caption text (任意)'),
    },
    async ({ room_id, prompt, size, caption }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return { content: [{ type: 'text', text: 'エラー: OPENAI_API_KEY が設定されていません。tealus-mcp 起動環境に env を追加してください。' }] };
      }
      try {
        const genRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          // #313/#314: response_format は現行 Images API で廃止 (Unknown parameter エラー)。
          // model は env で変更可、default gpt-image-1 (= dall-e-3 は account によって
          // "does not exist" になるため現行モデルへ移行)。応答は b64_json / url 両対応。
          body: JSON.stringify({
            model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
            prompt,
            size: size || '1024x1024',
            n: 1,
          }),
        });
        const genData = await genRes.json();
        if (genData.error) {
          return { content: [{ type: 'text', text: `画像生成エラー: ${genData.error.message || JSON.stringify(genData.error)}` }] };
        }
        const item = genData.data?.[0];
        const revisedPrompt = item?.revised_prompt || prompt;
        // #313: b64_json (= gpt-image-1 等) と url (= dall-e-3 default) の両方に対応
        let buffer;
        if (item?.b64_json) {
          buffer = Buffer.from(item.b64_json, 'base64');
        } else if (item?.url) {
          const imgRes = await fetch(item.url);
          if (!imgRes.ok) {
            return { content: [{ type: 'text', text: `画像生成エラー: 画像 URL 取得失敗 (${imgRes.status})` }] };
          }
          buffer = Buffer.from(await imgRes.arrayBuffer());
        } else {
          return { content: [{ type: 'text', text: `画像生成エラー: 応答に b64_json / url なし: ${JSON.stringify(genData).slice(0, 200)}` }] };
        }
        const filename = `generated-${Date.now()}.png`;
        const result = await client.pushImage(room_id, buffer, filename, caption || '');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: result.message,
              image_size: buffer.length,
              filename,
              revised_prompt: revisedPrompt,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `画像生成 / 送信エラー: ${err.message}` }] };
      }
    }
  );

  // 14. read_document
  server.tool(
    'read_document',
    'Tealus メッセージに添付された PDF/DOCX/XLSX を text 化して返す。get_message_media がメタ情報のみ返すのに対し、本 tool は文書本文を text として抽出する。複数文書が添付されたメッセージは index (0始まり) で1件ずつ取得する (返り値の media_count を見て全件 index=0,1,… で呼ぶ)。',
    {
      message_id: z.string().describe('対象メッセージのID'),
      index: z.number().int().min(0).optional().describe('複数添付メッセージで N 件目 (0始まり) を取得。省略時は 0 件目。返り値 media_count で総数を確認'),
    },
    async ({ message_id, index }) => {
      const media = await client.getMessageMedia(message_id, index);
      if (media.error) {
        return { content: [{ type: 'text', text: `エラー: ${media.error}` }] };
      }
      const result = await extractText(media);
      // #317: 複数文書メッセージなら、エージェントに残りの index 取得を促す案内を付ける
      const count = media.media_count || 1;
      const cur = media.index ?? 0;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            text: result.text,
            format: result.format,
            ...(result.extraction_method ? { extraction_method: result.extraction_method } : {}),
            ...(result.model ? { model: result.model } : {}),
            ...(result.pages !== undefined ? { pages: result.pages } : {}),
            ...(result.sheets !== undefined ? { sheets: result.sheets.map(s => ({ name: s.name })) } : {}),
            ...(result.truncated ? { truncated: true } : {}),
            ...(result.warning ? { warning: result.warning } : {}),
            ...(count > 1 ? {
              media_count: count,
              index: cur,
              note: `このメッセージには文書が ${count} 件あります。これは ${cur + 1}/${count} 件目です。`
                + `残りは read_document を index=0,1,…,${count - 1} で呼び出して全件取得してください。`,
            } : {}),
          }, null, 2),
        }],
      };
    }
  );

  // 16. transcribe_media (#271 follow-up、v0.13.0)
  server.tool(
    'transcribe_media',
    '動画/音声メッセージの文字起こしを取得する。voice は既存 cached transcription を返す。video は初回 call で server-side で transcribe (ffmpeg audio 抽出 → Whisper → AI 整形)、結果は DB cache、2 回目以降は cached を返す。get_message_media の 10MB 上限を回避する構造 (server-side で text のみ返すため動画 size 制限なし)。',
    {
      message_id: z.string().describe('対象メッセージのID (video / voice / audio)'),
      force_retranscribe: z.boolean().optional().describe('既存 cache を無視して再 transcribe する (default: false)'),
    },
    async ({ message_id, force_retranscribe }) => {
      try {
        const result = await client.transcribeMedia(message_id, { force: force_retranscribe === true });
        if (result.error) {
          return { content: [{ type: 'text', text: `エラー: ${result.error}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Transcribe failed: ${err.message}` }] };
      }
    }
  );

  // 17. get_message_edit_history (= 5/24 user 提案、Day 8、organon daily cycle で edit history 観察用)
  server.tool(
    'get_message_edit_history',
    'メッセージの編集履歴 (text edits + voice/video transcription versions) を統合返却する。voice/video の場合は raw_text (Whisper output) vs formatted_text (AI整形) vs user-corrected の version history を取得可能、text の場合は message_edits table の version history を返す。organon class の daily cycle で raw STT vs user-corrected pair を直接観察するための tool (= 別途 mining script を運用する必要を解消、organic ontology paradigm の simplicity 1 instrument 主義)。',
    {
      message_id: z.string().describe('対象メッセージのID'),
    },
    async ({ message_id }) => {
      try {
        const result = await client.getMessageEditHistory(message_id);
        if (result.error) {
          return { content: [{ type: 'text', text: `エラー: ${result.error}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Edit history fetch failed: ${err.message}` }] };
      }
    }
  );
}

module.exports = { registerTools };
