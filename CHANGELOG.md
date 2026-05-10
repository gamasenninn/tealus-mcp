# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

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
