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

## HTTP transport (リモート利用、v0.12.0+)

cross-machine で MCP client (Claude Code 等) と Tealus 本体が **別マシン** に居る場合、stdio transport は使えない (child process spawn が成立しない)。代わりに **HTTP transport** を使う。

```
[Claude Code (マシン A)]               [Tealus サーバ (マシン B)]
  ~/.claude.json                          port 3000 (Tealus 本体)
  mcpServers:                             ┌──────────────────┐
    tealus:                               │ /mcp proxy       │
      url: https://tealus.example.com/mcp │   ↓              │
      headers:                            │ port 3200        │
        Authorization: Bearer <JWT> ────► │ tealus-mcp       │
                                          │ --transport=http │
                                          └──────────────────┘
```

**サーバ側起動** (Tealus と同マシンで):

```bash
TEALUS_USER_ID=bot-id \
TEALUS_PASSWORD=bot-pass \
JWT_SECRET=<Tealus 本体と同値> \
MCP_HTTP_PORT=3200 \
node src/index.js --transport=http
```

または `.env` ファイルに集約 (v0.12.1+):

```bash
cp .env.example .env
# .env を編集して TEALUS_USER_ID / TEALUS_PASSWORD / JWT_SECRET / MCP_HTTP_PORT を埋める
node src/index.js --transport=http
```

> 💡 dotenv は **parent process の env を override しない** ため、stdio mode (npx 経由で MCP client が env を渡す) には影響なし。HTTP host mode で運用する時の便利機能。

Tealus 本体側 (port 3000) で `/mcp/*` proxy が必要 (`createProxyMiddleware` で `localhost:3200` に転送、tealus#264 参照)。

**クライアント側設定** (MCP client の url-based config、JWT は Tealus 本体と shared):

```json
{
  "mcpServers": {
    "tealus": {
      "url": "https://tealus.example.com/mcp",
      "headers": { "Authorization": "Bearer <JWT>" }
    }
  }
}
```

**現在の scope**: HTTP request/response のみ。SSE event broker (server → client wake-up) は Phase 2 で別途。stdio transport は **後方互換のため維持**、既存採用者は影響なし。

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `TEALUS_API_URL` | × | Tealus サーバの URL (default: `http://localhost:3000`) |
| `TEALUS_USER_ID` | ○ | Tealus 上の bot ユーザ ID (旧 `TEALUS_BOT_ID` も互換) |
| `TEALUS_PASSWORD` | ○ | bot ユーザのパスワード (旧 `TEALUS_BOT_PASS` も互換) |
| `JWT_SECRET` | △ | `--transport=http` の場合のみ必須。Tealus 本体 server / agent-server と **完全に同じ値**にする (proxy で pass-through、検証は本 server 側) |
| `MCP_HTTP_PORT` | × | HTTP transport の listen port (default: `3200`)、`--transport=http` 時のみ effect |

bot ユーザは Tealus 管理画面 (`/admin`) の「Bot ユーザ」から作成する。

> ⚠️ **採用者が踏みやすい trap — env 名は `TEALUS_` prefix 必須**
>
> ```json
> // ❌ 間違い (silent fail、localhost にフォールバックして「reach できない」エラー)
> "env": {
>   "API_URL": "http://192.168.x.x:3000",   // ← prefix なし
>   "USER_ID": "AI_AGENT",
>   "PASSWORD": "..."
> }
>
> // ✅ 正しい
> "env": {
>   "TEALUS_API_URL": "http://192.168.x.x:3000",
>   "TEALUS_USER_ID": "AI_AGENT",
>   "TEALUS_PASSWORD": "..."
> }
> ```
>
> tealus-mcp は **`TEALUS_` prefix 付き env のみ** 読み込む (multi-MCP 環境で他 server の env と衝突回避のため)。短い名前 (`API_URL` 等) を書くと無視されて default `http://localhost:3000` に fallback、ローカルに Tealus server がないと「`http://localhost:3000/api/auth/login` に reach できない」エラーが出る。
>
> エラーが出たらまず **env 名を確認**。直したら MCP クライアント (Claude Code / Cursor 等) を **再起動** (MCP config は startup 時のみ読込)。

## 提供ツール

| Tool | 用途 |
|---|---|
| `send_message` | ルームにテキストメッセージを送信 |
| `send_image` | ルームに画像を送信 (base64) |
| `get_messages` | ルームのメッセージ履歴を取得。voice の transcription は default で `formatted_text` のみ inline (`include_raw=true` で raw 追加 / `include_transcription=false` で id+status+version のみ) |
| `get_message_media` | メッセージのメディア取得 (画像は AI が直接視認可、音声は文字起こし優先) |
| `search_messages` | キーワード / タグ / 期間 / 発言者でメッセージ全文検索 (snippet ハイライト付) |
| `list_tags` | Bot メンバー全 room の tag 一覧を usage 順で返す discovery primitive (search_messages の前段で tag 名を発見) |
| `mark_tag_done` | メッセージのタグ完了状態 (is_done) を更新 |
| `create_room` | 新しいグループルームを作成 (bot は admin として自動追加) |
| `delete_room` | グループルームを削除 (creator + solo member のみ、CASCADE で関連データも削除) |
| `list_rooms` | 参加中ルーム一覧 |
| `join_room` | ルームへ参加 |
| `mark_read` | 既読化 |
| `read_document` | メッセージ添付の PDF/DOCX/XLSX を text 化 (`get_message_media` がメタ情報のみなのに対し、本 tool は文書本文を抽出)。scan PDF は Gemini API fallback で対応 (要 `GOOGLE_API_KEY`、tealus#233) |

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
npm test                    # 83 件 jest
npm run fixtures            # __tests__/fixtures/ の sample.pdf/docx/xlsx 再生成 (任意)

# stdio transport (default、既存動作)
TEALUS_USER_ID=... TEALUS_PASSWORD=... node src/index.js

# HTTP transport (v0.12.0+、cross-machine 用)
TEALUS_USER_ID=... TEALUS_PASSWORD=... JWT_SECRET=... \
  node src/index.js --transport=http
```

## バージョン履歴

このパッケージは元々 [tealus](https://github.com/gamasenninn/tealus) monorepo の `mcp-server/` ディレクトリで開発されていたが、独立配布のため v0.1.0 から本 repo に分離された ([#187](https://github.com/gamasenninn/tealus/issues/187))。

詳細は [CHANGELOG.md](CHANGELOG.md) を参照。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。

## 関連

- [Tealus 本体](https://github.com/gamasenninn/tealus)
- [Model Context Protocol](https://modelcontextprotocol.io/)
