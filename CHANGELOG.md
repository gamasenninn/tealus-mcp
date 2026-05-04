# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

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
