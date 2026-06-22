# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

## [0.14.4] - 2026-06-22

### Fixed

- **画像生成モデルを `dall-e-3` → `gpt-image-1` に変更（env 上書き可）** ([tealus#313](https://github.com/gamasenninn/tealus/issues/313) follow-up、6/22 dogfood で発覚)
  - v0.14.3（response_format 除去）の後、`The model 'dall-e-3' does not exist.` で失敗。当該アカウントの利用可能画像モデルを確認したところ **dall-e-3 は廃止済**で `gpt-image-1` / `gpt-image-1.5` / `gpt-image-2` 等が利用可能だった。
  - 修正: default model を `gpt-image-1` に変更し、env **`OPENAI_IMAGE_MODEL`** で上書き可能に（escape hatch）。size enum も gpt-image-1 系（`1024x1024` / `1536x1024` / `1024x1536` / `auto`）に更新。応答は v0.14.3 の b64_json/url 両対応のまま。
  - tests: `tools.test.js` に model default / env 上書きの検証を追加、全 115 green。

## [0.14.3] - 2026-06-22

### Fixed

- **`generate_and_send_image` が `response_format` で失敗する問題を修正** ([tealus#313](https://github.com/gamasenninn/tealus/issues/313)、6/21 アイコン生成 dogfood で発覚)
  - 現行 OpenAI Images API が `response_format` パラメータを拒否（`Unknown parameter: 'response_format'`）。これにより /deep・/light 双方で画像生成が失敗していた。
  - 修正: リクエスト body から `response_format` を除去。応答が **`b64_json`（gpt-image-1 等）でも `url`（dall-e-3 default）でも処理**できるよう両対応化（url の場合は画像を fetch して bytes 化）。
  - tests: `tools.test.js` に +4（response_format 不送出 / b64_json 処理 / url 処理 / API error）、TDD Red→Green、全 114 green。

## [0.14.2] - 2026-06-20

### Fixed

- **HTTP client (`tealusClient`) の silent fail を排除** ([tealus#303](https://github.com/gamasenninn/tealus/issues/303) 同型、6/18 サポート班指摘の MCP 自律 send_message 経路)
  - 旧挙動: `request()` が `res.ok` を見ず `res.json()` を返していたため、`/bot/push` 等の非2xx (= 401 token 失効含む) を握り潰し、agent が「送信成功」と扱うのに実際は届かない silent fail を招いていた。`login()` も token を一度 cache すると 401 でも再ログインせず、bot JWT 失効で全 push が静かに失敗
  - 新挙動: `request()` は (1) 2xx は従来どおり JSON 返却、(2) 401 で token 破棄 + 1 回だけ再ログイン retry (直線・再入なし)、(3) 非2xx は status/body 付き Error を throw。`pushImage`/`pushFile` の multipart 経路も `_sendForm()` 共通化で同型 hardening (form は再送時 rebuild)
  - 動機: agent-server `botApi.request()` は #303 で修正済だったが、tealus-mcp 側の同型 HTTP client は未対応だった (= 藤井さん環境 6/18 dogfood で観測された agent 自律投函経路の silent fail)
  - tests: `__tests__/tealusClient.test.js` 新規 6 件 (2xx / 非2xx throw / 401 retry 成功 / 401 継続 throw / pushFile 同型 2 件)、TDD Red→Green、110/110 pass

## [0.14.1] - 2026-06-07

### Fixed

- **`get_message_media` の image 判定を mime_type ベースに緩和** ([tealus#292](https://github.com/gamasenninn/tealus/issues/292) 6/7 Day 22 dogfood)
  - 旧挙動 (v0.14.0): `result.type === 'image' && result.mime_type?.startsWith('image/')` AND check で、LINE Bridge が「ファイル添付」 経路で受け取った image (= `type='file'` + `mime_type='image/jpeg'`) が fall through し metadata only に倒れていた。AI agent が「画像本体にアクセスできず」と判断する原因
  - 新挙動 (v0.14.1): `result.mime_type?.startsWith('image/') && result.data_base64` ベースに緩和。`type='file'` でも mime が image/* なら MCP image content として返却し、AI vision 解析が可能になる
  - tests: `tools.test.js` に +1 test (type='file' + mime_type='image/jpeg' で image content として返る検証)、61/61 pass、regression なし
  - 動機: Tealus #292 image/video/file 転送機能 (リンク方式) 実装後 dogfood で「LINE 経由画像を AI 解析」 業務 use case の盲点として surface

## [0.14.0] - 2026-05-24

### Added

- **`get_message_edit_history` MCP tool 新規追加** (= 5/24 Day 8 user 提案、organon daily cycle で edit history 観察用)
  - 入力: `message_id`
  - 出力: text edit history (= `message_edits` table) + voice/video transcription versions (= `voice_transcriptions` table) の統合
  - 動機: organon class が raw STT vs user-corrected pair を直接観察できるようにし、別運用していた mining script (= `server/scripts/mine_transcription_aliases.js`、Issue [tealus#206](https://github.com/gamasenninn/tealus/issues/206) + [tealus#208](https://github.com/gamasenninn/tealus/issues/208) で構築済 CLOSED) の自動化代替を可能にする
  - 設計原則: organic ontology paradigm の simplicity (= 1 instrument 主義)、別 cron / 月次 run を廃止して organon の natural daily cycle に統合
  - 認可: 既存 bot endpoint と同 pattern (= Bot がそのルームの member であること)
  - 関連 server 修正: `GET /api/bot/messages/:id/edit-history` endpoint 追加 (= `server/src/routes/bot.js`)
  - tools.js: ツール数 16 → 17

### Changed

- description (= package.json) に `get_message_edit_history` を追加。

## [0.13.2] - 2026-05-18

### Changed

- **`get_message_media` の size guard 改善 — text/* 小型 file (≤ 100KB) を inline 返却 + 大型 file 拒否理由を honest 化** ([tealus#281](https://github.com/gamasenninn/tealus/issues/281) Std fix)
  - 旧挙動 (v0.13.1): 画像/音声以外の全 file を「データは base64 で取得可能ですが、MCP text 応答には大きすぎる」literal で metadata only に倒していた (実 file_size 未確認、2 KB の md でも同じ message)
  - 新挙動 (v0.13.2):
    - **text/* mime + file_size ≤ 100KB**: data_base64 を utf8 decode して inline で本文を返却 (`{file_name} ({mime}, {size} bytes)\n\n=== 内容 ===\n{text}`)
    - **text/* mime + file_size > 100KB**: 「text/* mime ですが 100 KB 上限を超過、inline 化スキップ」と honest reason を返す
    - **非 text mime (video/audio/binary)**: 「非 text mime のため inline 化対象外」と honest reason + read_document / transcribe_media への案内
  - v0.13.1 の Min fix (`read_document` の text/* 対応) と combined で、Light agent が自作 markdown attachment を **`get_message_media` 一発で直接読める + `read_document` 経由でも読める** 二重 path 確立
  - tests: `tools.test.js` に +4 test (text/markdown 小型 / text/plain 小型 / text/* 巨大 file 拒否 / 非 text mime honest message)、5 suite 99/99 pass、regression なし

## [0.13.1] - 2026-05-18

### Fixed

- **`read_document` が `text/markdown` / `text/plain` / `text/csv` 等の text/* mime を扱えない問題を fix** ([tealus#281](https://github.com/gamasenninn/tealus/issues/281))
  - 症状: Light agent (`/light`) が自作 markdown attachment を user 依頼で読み戻せず「この環境では本文の直接展開に失敗しました」と返す self-inflicted blind spot
  - 5/18 朝の朝礼ルームで再現: 動画 → 議事録 .md attach → user「内容表示」→ agent 読めず → user が手作業で再貼り付け
  - 真因: `documentReader.js` の `detectFormat` が PDF/DOCX/XLSX のみ判定、text/* は `unsupported` に倒れていた
  - 対応: `detectFormat` に `text` branch 追加 (ext `md`/`txt`/`csv` または mime `text/*`)、`extractText` の switch に `case 'text'` 追加 (`buffer.toString('utf8')` で本文返却、既存 `MAX_TEXT_LENGTH` で truncation)

### Tests

- `documentReader.test.js`: +4 test (detectFormat text 判定 / markdown 本文 / plain text / 巨大 text 切り詰め)、5 suite 95/95 pass、regression なし

### Known limitations (Std/Full fix は別 PR で予定)

- `get_message_media` は依然として画像/音声以外を一律「大きすぎる」と倒す (実 file_size 未確認)。100KB 以下の text/* を data_base64 decode して直接返す改善は別 PR
- filename mojibake (`朝礼議事録` → `æç¤¼è­°äºé²`) は上流 `tealusClient.getMessageMedia` の response decode 問題、別 follow-up

## [0.13.0] - 2026-05-12

### Added

- **`transcribe_media` 新 MCP tool — 動画/音声メッセージの文字起こし** ([tealus#271](https://github.com/gamasenninn/tealus/issues/271) follow-up)
  - tealus 本体 server に新 endpoint `POST /api/bot/messages/:id/transcribe` が追加された (tealus 本体側で実装、本 release は thin MCP wrapper)
  - 動作: tool は `message_id` + optional `force_retranscribe` を受け、tealus server に POST して transcription text を JSON で返す
  - **問題解決**: `get_message_media` の 10MB 上限で動画が取得できない問題を構造解。base64 で動画を運ばず、server 側で ffmpeg `-vn` audio 抽出 → Whisper API → AI 整形 → text のみ返却
  - voice メッセージは既存 transcription を cached 返却、video は初回 call で server-side で transcribe → cached
  - Whisper API 25MB 上限内に大半の動画が収まる (16kHz mono opus 24kbps ≈ 11MB/hour)
  - 業務無線辞書 (transcription_guideline.json) は voice / video で共有

### Why

5/12 朝に user が業務メモ ルームに動画投稿 → `/light2` `/deep` で文字起こし依頼 → `get_message_media` の 10MB 上限で fail。Deep agent が 3 戦略案を提示し、案 B (`transcribe_media` 新ツール) で決定。元の Deep 提案は tealus-mcp に ffmpeg + OpenAI を抱え込む想定だったが、tealus-mcp には依存も disk access も無く、tealus 本体 server には完成された STT pipeline (gpt-4o-transcribe + transcription_guideline.json) があったため、**server-side endpoint + thin MCP wrapper** に pivot。

### Tests

- `tools.test.js`: 15 → 16 tools registered assertion 更新、`transcribe_media` の 5 test 追加 (cached voice / fresh video / force_retranscribe / server error / throw exception)

## [0.12.3] - 2026-05-10

### Fixed

- **HTTP transport: stateful session management に変更 — Claude Code 等の proper MCP client で「tools fetch failed」になる bug を fix** ([tealus#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha follow-up)
  - 5/10 Test 6 で Claude Code の `/mcp` で「connected · tools fetch failed」になる問題が surface
  - 真因: v0.12.0-v0.12.2 は per-request transport (stateless mode) で、initialize と tools/list が **別 transport instance** に dispatch されていた。SDK の `Protocol.connect()` (`shared/protocol.js:219-222`) は **single-transport 設計** で `_transport` 既設時に throw、また「initialized 状態」を transport instance に紐付けて管理するため、別 instance で tools/list が来ると「not initialized」状態として失敗
  - curl/supertest は単発 request 完結なので問題なし、Claude Code のような proper MCP client は initialize → tools/list 連続呼びで失敗 (Test 6 で発覚)
  - **修正**: stateful session management に切替。`Map<sessionId, transport>` を保持、initialize 時に新 transport + 新 McpServer instance を生成、後続 request は `Mcp-Session-Id` header で同 transport へ dispatch、`transport.onclose` で auto cleanup
  - **設計判断**: SDK 制約 ("use a separate Protocol instance per connection") に従い session ごとに **新 McpServer instance** を生成。tool registration cost を許容、Phase 1 alpha 範囲では問題なし
  - `index.js` も `mcpServer` 直渡し → `mcpServerFactory` に変更 (stdio 側は 1 回 only で従来通り)

### Changed

- **API**: `startHttpServer({ mcpServer, ... })` → `startHttpServer({ mcpServerFactory, ... })` に signature 変更 (breaking、ただし内部 API、外部利用想定なし)
- **Tests**: httpServer.test.js を stateful pattern に合わせて書き直し、84 件 → 86 件 pass (session lifecycle 系 test 追加)

### Note

本 release は v0.12.0-v0.12.2 の **重要な fix**。HTTP transport を実利用する場合は v0.12.3 以上必須。stdio path は無影響、既存採用者は impact なし。

## [0.12.2] - 2026-05-10

### Added

- **`/mcp/health` endpoint (no auth) — through-proxy reachability check 用** ([tealus#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha follow-up)
  - 既存 `/health` (root) は standalone 直叩き用に維持、追加で `/mcp/health` も同 handler で expose
  - tealus 本体 server (Express の `app.use('/mcp', proxy + pathRewrite re-add)`) 経由では `/mcp/health` で reachability 確認可能
  - 5/10 手動テストで Test 3-a (proxy 経由 health check) が 404 になっていた問題の構造解決

### Documentation

- README に正確な path 記述 (proxy 経由は `/mcp/health` 必須を明示)

### Note

本 release は tealus 本体側の **proxy 設定 fix と組** で機能 (tealus repo b3fb3f7 → follow-up commit で `pathRewrite: (path) => '/mcp' + path` 追加)。Express の `app.use('/mcp', ...)` が req.url から `/mcp` を strip する仕様を見落とした v0.12.0 の初期 plan の修正。

## [0.12.1] - 2026-05-10

### Added

- **`.env` ファイル読み込み (dotenv)** — HTTP host mode 運用時の env 集約 ([tealus#264](https://github.com/gamasenninn/tealus/issues/264) follow-up)
  - `src/index.js` の冒頭で `require('dotenv').config()` を呼び出し、cwd の `.env` を silent load
  - **dotenv default = no-override** のため parent process env が先勝ち、stdio mode (npx 経由で MCP client が `env` で渡す setup) には **無影響** で共存
  - `.env.example` を新規追加 (TEALUS_*、JWT_SECRET、MCP_HTTP_PORT、optional Gemini/OpenAI keys)、`package.json` `files` array に含めて npm publish 経路でも届く
  - `.env` は既に `.gitignore` 済、新規 leak path なし
  - HTTP host mode 起動の煩雑な `$env:VAR=...` 列挙が `.env` 1 file に集約可能、採用者 setup の友好度向上

### Changed

- `dependencies` に `dotenv` (^16.6.1) を追加 (production deps)

## [0.12.0] - 2026-05-10

### Added

- **HTTP transport (`StreamableHTTPServerTransport`) サポート — cross-machine MCP 利用** ([tealus#264](https://github.com/gamasenninn/tealus/issues/264))
  - `node src/index.js --transport=http` で HTTP server (default port 3200) を起動、stdio path は flag 無しで従来通り (default、後方互換維持)
  - `@modelcontextprotocol/sdk` v1.29 の `StreamableHTTPServerTransport` を使用、SSE response (text/event-stream) で MCP wire 互換
  - **per-request transport instance pattern** が必須 (shared transport は tools/list で 500、5 days dogfood + spike で実証済の制約)、`McpServer` のみ shared
  - JWT auth middleware 内蔵 (`Authorization: Bearer <JWT>`)、Tealus 本体 (server / agent-server) と **同じ `JWT_SECRET` を共有**、検証は本 server 側で fail-fast 401 (anonymous fallback なし)
  - `/health` (no auth) endpoint、proxy 経由では `/mcp/health` で reachability check 可
  - 新 env: `JWT_SECRET` (HTTP mode 必須)、`MCP_HTTP_PORT` (default 3200)
  - 採用者環境 (cross-machine) で agent-server と Claude Code が別マシンに居る case (5/8 藤井さん環境で surface した 192.168.11.10 ↔ .12 構成) の構造解決の足場、Phase 2 で SSE event broker (server → client wake-up) を別途追加予定
  - 71 件 → 83 件 test (jwtAuth 6 + httpServer 6 追加)

### Changed

- **dependencies に `express` (^4.22.1) + `jsonwebtoken` (^9.0.3) を production deps として追加** — HTTP transport 用、stdio mode では import されない (lazy require、過去採用者の install 重量化を最小限に)
- **devDependencies に `supertest` (^7.2.2) 追加** — `httpServer.test.js` で request-level test に使用

## [0.11.1] - 2026-05-08

### Fixed

- **`read_document`: pdf-parse の parseError も vision fallback の trigger 条件に追加** (tealus#262 Phase 2)
  - 旧実装は `pdf-parse` が解析エラー (例: "Invalid PDF structure" / "bad XRef entry") を投げると即 return していたため、**vision fallback path が skip** されていた
  - tealus#262 (E2E harness) で発覚: pdf-lib / pdfkit / 一部の hand-crafted PDF は pdf.js v1.10.100 で parseError を起こすが、Gemini Vision なら image stream として処理可能なケースがある
  - 修正: parseError も「library で本文取れなかった」signal として扱い、vision fallback path に流す。fallback 成功時 `extraction_method=vision_gemini` を返す
  - warning text も `pdf-parse error: ... (image-only PDF / 構造破損の可能性)` 形式に拡張、診断容易に
  - 既存の「nonWsLength < 50」path と equivalent な扱い、Light v1 / v2 両方で恩恵
  - 70 件 → 71 件 test (parseError → vision fallback の専用 case 追加)

### Documentation

- **README に env 名の trap 警告 section を追加** (採用者保護、tealus#267)
  - 5/8 採用者第 1 号 (藤井さん) dogfood で `API_URL` (prefix なし) を書いて silent fail する trap を踏んだ
  - tealus-mcp は `TEALUS_` prefix 付き env のみ読込 (multi-MCP 環境での衝突回避設計) のため、短縮名は無視されて default `localhost:3000` に fallback、エラーになる
  - README の「環境変数」section に警告 callout (❌/✅ 比較 + エラー症状 + 再起動の必要性) を追加
  - 同 trap は memory `feedback_tealus_mcp_env_naming.md` でも記録 (Claude Code 側の再発防止)

## [0.11.0] - 2026-05-08

### Added

- **`send_text_as_file` tool — Light v2 機能 parity (Phase 1/2)** ([tealus#260](https://github.com/gamasenninn/tealus/issues/260))
  - 長文 text を file (.txt / .md 等) として Tealus 投稿、chat 流れを切らず添付
  - args: `room_id`, `content`, `filename`, `mime_type?`, `caption?`
  - mime_type 省略時は `.md` → `text/markdown`、それ以外 → `text/plain` auto detect
  - 背景: Light v1 の custom tool `share_text_as_file` を MCP 化、Light v2 (codex SDK) からも同じ動作で使えるようにする ([tealus#258](https://github.com/gamasenninn/tealus/issues/258) D5 で TODO 化済)

- **`generate_and_send_image` tool — Light v2 機能 parity (Phase 2/2)** ([tealus#260](https://github.com/gamasenninn/tealus/issues/260))
  - DALL-E 3 で画像生成 → Tealus 投稿の composite action
  - args: `room_id`, `prompt`, `size?` ('1024x1024' / '1792x1024' / '1024x1792')、`caption?`
  - response: `{ message, image_size, filename, revised_prompt }`
  - 背景: Light v1 の custom tool `generate_image` を MCP 化。Light v2 (codex SDK) は image gen built-in なし、5/7 dogfood で `/light2 子犬の画像を生成して` が `no final agent message captured` で fail、本 tool で解消
  - **OPENAI_API_KEY env 必須** (subscription mode の Light v2 でも image gen は API 経由、別 cost)

- **TealusClient に `pushFile` method 追加** — `POST /api/bot/push-file` の wrapper

### Changed

- tools 13 → **15** (+2: send_text_as_file, generate_and_send_image)
- package.json description に新 tool 名を反映

## [0.10.0] - 2026-05-05

### Added

- **`list_tags` tool — bot メンバー全 room の tag 一覧を usage 順で返す discovery primitive** ([tealus#254](https://github.com/gamasenninn/tealus/issues/254))
  - 背景: LLM が `search_messages` で tag_names filter を使う時、tag 名を知らないと「正解の名前を当てるゲーム」を強いられる構造的問題があった (実例: 5/5 セッションで「tealus関係」tag を 5 候補 guess して全 miss、user に教えてもらい解決)
  - 教訓: LLM 向け MCP は CRUD だけでなく **list / discovery primitive** が必須。人間 UI には autocomplete があるが MCP では明示が必要
  - **新 server endpoint** `GET /api/bot/tags?limit=N` (tealus 本体側、bot JWT scope)
  - **新 MCP tool** `list_tags({ limit })`: response `{ tags: [{ name, is_todo, total_usage }] }`
  - tools 12 → 13、tests 65 → 67 (+2 件: list_tags handler + limit 省略)
  - 既存の `search_messages` / `mark_tag_done` と組み合わせて「discover → search → mark done」の閉じた flow が完成

### Tests

- 65 → **67** (+2、list_tags の handler / optional limit)

## [0.9.0] - 2026-05-04

### Added

- **read_document に Vision API fallback (Gemini) を統合 — scan PDF / image-only PDF 対応** ([tealus#233](https://github.com/gamasenninn/tealus/issues/233))
  - v0.8.1 で scan PDF を heuristic 検出 (空白除外 < 50 chars) するようになったが、内容を読む手段がなかった
  - v0.9.0 で Gemini API multimodal を fallback として組み込み、scan PDF も自動で text 化
  - 採用者は `GOOGLE_API_KEY` env を設定すれば自動で有効化、unset / `DOCUMENT_VISION_PROVIDER=none` で disable
  - **応答 schema 拡張**: `extraction_method: "library" \| "vision_gemini"` で透過性確保。`model` field も付加
  - 自動 chain: `extractPdf` で text 取れない時のみ vision を呼ぶ (digital PDF は library で完結、cost 保護)
  - **Privacy 注意**: Gemini free tier は Google が製品改善に利用、human reviewer が input/output を処理する可能性あり。社内文書を扱う場合は paid billing account に紐付けた key 推奨
  - Default model: `gemini-2.5-flash-lite` (free tier 1,000 RPD / 15 RPM が最 generous)
  - Cost protection: `DOCUMENT_VISION_MAX_PAGES=20` (default、超過時は vision skip + warning)
  - Approach 1 (deterministic library) は依然 default、scan 検出時のみ Approach 2 (Gemini) に escalate

### Dependencies

- 追加: `@google/genai@^1.51.0` (公式 Gemini Node.js SDK、新 unified package)

### Tests

- 54 → **65** (+11、visionFallback.test.js 8 件 + documentReader.test.js chain 3 件)
- Gemini SDK は `jest.doMock` で network 呼び出しなしで mock、CI 安全

## [0.8.1] - 2026-05-04

### Fixed

- **scan PDF / image-only PDF の検出 heuristic を強化** ([tealus#232](https://github.com/gamasenninn/tealus/issues/232))
  - 実機 verify で 7 ページの scan PDF (`gold_strategy.pdf`) が観測:
    - pdf-parse は pages=7 と structure を取れたが、本文 text は **270 chars 全部 `\n` (改行のみ)** で返す
    - v0.8.0 の heuristic は **生 length** で判定 (`text.length < 50`) のため通過、warning が出ず agent が「PDF を確認したが要約できなかった」と困惑
  - **修正**: 空白を除いた non-whitespace char 数で判定 (`text.replace(/\s/g, '').length < 50`)
  - 効果: 上記 PDF で warning に「空白除外 0 chars / pages=7。scan PDF / image-only PDF の可能性」が付き、agent が「Vision API fallback (未実装) が必要」と明確に応答可能
  - test 追加: `extractText - scan PDF heuristic` に whitespace-only 検出 case (54 件 pass、回帰なし)

## [0.8.0] - 2026-05-04

### Added

- **read_document tool — PDF/DOCX/XLSX を text 化** ([tealus#232](https://github.com/gamasenninn/tealus/issues/232))
  - `get_message_media` がメタ情報のみ返すのに対し、`read_document` は文書本文を text として抽出
  - 対応 format: PDF (pdf-parse) / DOCX (mammoth) / XLSX (exceljs)
  - format 判定は mime_type + file_name extension の両方で実施
  - size 上限: binary 10MB / text 1M chars (超過時 `truncated: true`)
  - scan PDF / image-only PDF は heuristic 検出 (text < 50 chars) し warning 付きで返却 (Approach 2 = Vision API fallback は別 issue で対応予定)
  - 未対応 format (画像 / 動画 / 音声 / その他) は `format: 'unsupported'` + warning で返却 (例外で落とさない)
  - tealus-mcp tool 一覧: 11 → **12**
  - tests: 34 → **53** (documentReader.test.js 11 件 + tools.test.js read_document 5 件)

### Dependencies

- 追加: `pdf-parse@^1.1.4`, `mammoth@^1.12.0`, `exceljs@^4.4.0`
- 追加 (devDependencies): `pdf-lib@^1.17.1`, `docx@^9.6.1` (test fixtures 生成用)
- xlsx (sheet.js) は CVE 2 件 (Prototype Pollution / ReDoS、2026-01 時点 npm 配布版に fix なし) を理由に採用見送り、exceljs を選択
- exceljs の transitive dep `uuid <14.0.0` に moderate CVE (GHSA-w5hq-g745-h8pq、buffer bounds check) があるが、exceljs の uuid 利用は v4 (random ID 生成) のみで実質影響なし

### Notes

- 採用者は `npm install` で 3 deps 追加 (PDF/DOCX/XLSX 解析のため必要)
- agent-server / tealus 本体側は変更不要、新 tool が agent から自動的に拾われる
- pdf-parse の bundled pdf.js v1.10.100 が Node の Buffer 拡張と相性問題 (一部 PDF で `Invalid PDF structure`) → Buffer を `Uint8Array` に変換して回避する workaround を `extractPdf` に implement

## [0.7.0] - 2026-05-02

### Changed

- **get_messages の transcription verbosity 制御** ([tealus#219](https://github.com/gamasenninn/tealus/issues/219) / [tealus-mcp#1](https://github.com/gamasenninn/tealus-mcp/issues/1))
  - voice メッセージの transcription を default で `formatted_text` のみ inline (51K chars 問題回避)
  - `include_raw=true` で raw_text も含める
  - `include_transcription=false` で id+status+version のみのメタ情報に切り詰め

## [0.6.0] と過去

詳細は [GitHub Releases](https://github.com/gamasenninn/tealus-mcp/releases) を参照。
