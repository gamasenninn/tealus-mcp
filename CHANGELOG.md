# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

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
