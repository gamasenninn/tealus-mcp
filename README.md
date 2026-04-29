# tealus-mcp

[Tealus](https://github.com/gamasenninn/tealus) (人と AI のためのメッセンジャー) の Bot API を **MCP (Model Context Protocol)** ツールとして公開するサーバ。

Claude Code / Cursor / その他 MCP 対応 AI クライアントから、Tealus のルームへメッセージ送信、画像送信、履歴取得などができるようになる。

## インストール不要 (npx)

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "https://your-tealus.example.com",
        "TEALUS_USER_ID": "bot-user-id",
        "TEALUS_PASSWORD": "bot-password"
      }
    }
  }
}
```

これを MCP クライアントの設定ファイル (Claude Desktop なら `claude_desktop_config.json`、Cursor なら `mcp.json`) に追加すれば、`@tealus` 経由でツールが呼べる。

> **配信方式**: 本パッケージは npm registry ではなく **GitHub repo から直接** インストールされる。`npx` が初回に GitHub からアーカイブを取得し、以後は npm のローカルキャッシュから起動する。`gamasenninn` 名義の GitHub repo を信頼する前提。

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `TEALUS_API_URL` | × | Tealus サーバの URL (default: `http://localhost:3000`) |
| `TEALUS_USER_ID` | ○ | Tealus 上の bot ユーザ ID (旧 `TEALUS_BOT_ID` も互換) |
| `TEALUS_PASSWORD` | ○ | bot ユーザのパスワード (旧 `TEALUS_BOT_PASS` も互換) |

bot ユーザは Tealus 管理画面 (`/admin`) の「Bot ユーザ」から作成する。

## 提供ツール

| Tool | 用途 |
|---|---|
| `send_message` | ルームにテキストメッセージを送信 |
| `send_image` | ルームに画像を送信 (base64) |
| `get_messages` | ルームのメッセージ履歴を取得 |
| `get_message_media` | メッセージのメディア取得 (画像は AI が直接視認可、音声は文字起こし優先) |
| `search_messages` | キーワード / タグ / 期間 / 発言者でメッセージ全文検索 (snippet ハイライト付) |
| `mark_tag_done` | メッセージのタグ完了状態 (is_done) を更新 |
| `create_room` | 新しいグループルームを作成 (bot は admin として自動追加) |
| `list_rooms` | 参加中ルーム一覧 |
| `join_room` | ルームへ参加 |
| `mark_read` | 既読化 |

## 使用例 (Claude Code)

```
> @tealus list_rooms
> @tealus send_message room_id="..." content="お疲れ様"
> @tealus get_messages room_id="..." limit=10
```

## ローカル開発

```bash
git clone https://github.com/gamasenninn/tealus-mcp.git
cd tealus-mcp
npm install
npm test                    # 29 件 jest
TEALUS_USER_ID=... TEALUS_PASSWORD=... node src/index.js
```

## バージョン履歴

このパッケージは元々 [tealus](https://github.com/gamasenninn/tealus) monorepo の `mcp-server/` ディレクトリで開発されていたが、独立配布のため v0.1.0 から本 repo に分離された ([#187](https://github.com/gamasenninn/tealus/issues/187))。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。

## 関連

- [Tealus 本体](https://github.com/gamasenninn/tealus)
- [Model Context Protocol](https://modelcontextprotocol.io/)
