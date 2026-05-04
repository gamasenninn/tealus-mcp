/**
 * 文書 binary → text 抽出
 *
 * tealus-mcp の read_document tool から呼ばれる library 層。
 * 対応 format: PDF / DOCX / XLSX。それ以外は unsupported を返す。
 *
 * 設計:
 * - get_message_media が返した media object (data_base64 + mime_type + file_name) を受ける
 * - format 判定 → 該当 library で text 抽出
 * - 失敗 / 抽出量極小 (scan PDF 等) は warning に含めて返す (例外で落とさない)
 * - size 上限を超える binary は truncated: true で返す
 */
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const visionFallback = require('./visionFallback');

const MAX_BINARY_BYTES = 10 * 1024 * 1024;   // 10MB
const MAX_TEXT_LENGTH = 1_000_000;            // 1M chars (token 換算 ~250K、prompt 上限保護)
const MIN_TEXT_LENGTH_FOR_OK = 50;            // この未満は scan PDF / 抽出失敗とみなす

function detectFormat(media) {
  const fileName = (media?.file_name || '').toLowerCase();
  const mime = (media?.mime_type || '').toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop() : '';

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('officedocument.wordprocessingml')) return 'docx';
  if (ext === 'xlsx' || mime.includes('officedocument.spreadsheetml')) return 'xlsx';
  return 'unsupported';
}

function truncateText(text) {
  if (text.length > MAX_TEXT_LENGTH) {
    return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: true };
  }
  return { text, truncated: false };
}

async function extractPdf(buffer) {
  let pages = 0;
  let rawText = '';
  let parseError = null;
  try {
    // pdf-parse の bundled pdf.js v1.10.100 は Node の Buffer 拡張と相性が悪く、
    // 一部の PDF で "Invalid PDF structure" になる。Uint8Array に変換して回避。
    const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const data = await pdfParse(u8);
    rawText = data.text || '';
    pages = data.numpages || 0;
  } catch (err) {
    parseError = err.message;
  }
  const { text, truncated } = truncateText(rawText);
  const result = { format: 'pdf', text, pages, truncated, extraction_method: 'library' };
  if (parseError) {
    result.warning = `PDF 解析エラー: ${parseError}`;
    return result;
  }

  // scan PDF / image-only PDF は pdf-parse が pages 数や構造は読めるが
  // 本文文字を抽出できず空白のみ返すケースがある (例: 270 chars で全部 \n)。
  // 生 length ではなく **空白を除いた文字数** で判定。
  const nonWsLength = text.replace(/\s/g, '').length;
  if (nonWsLength >= MIN_TEXT_LENGTH_FOR_OK) {
    return result;
  }

  // scan PDF 検出 — Phase 2: Vision API fallback (#233)
  if (visionFallback.isVisionEnabled()) {
    // pdf-parse が空白だけ返した buffer をそのまま Gemini に渡す
    // (scan PDF は内部に画像 stream を持つため、Gemini が直接 OCR 相当の処理をする)
    const vision = await visionFallback.extractTextWithGemini(
      { data_base64: buffer.toString('base64'), mime_type: 'application/pdf' },
      { pages }
    );
    if (vision.enabled && vision.text) {
      const vt = truncateText(vision.text);
      return {
        format: 'pdf',
        text: vt.text,
        pages,
        truncated: vt.truncated,
        extraction_method: `vision_${vision.provider}`,
        model: vision.model,
        ...(vision.warning ? { warning: vision.warning } : {}),
      };
    }
    // vision call 失敗 / disabled
    result.warning = `text 抽出量が極端に少ない (空白除外 ${nonWsLength} chars / pages=${pages})。scan PDF / image-only PDF と判定し Vision API fallback を試みたが失敗 (${vision.warning || vision.reason || 'unknown'})`;
  } else {
    result.warning = `text 抽出量が極端に少ない (空白除外 ${nonWsLength} chars / pages=${pages})。scan PDF / image-only PDF の可能性。Vision API fallback は GOOGLE_API_KEY 未設定のため無効 (${process.env.DOCUMENT_VISION_PROVIDER || 'auto'})`;
  }
  return result;
}

async function extractDocx(buffer) {
  let rawText = '';
  let parseError = null;
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    rawText = value || '';
  } catch (err) {
    parseError = err.message;
  }
  const { text, truncated } = truncateText(rawText);
  const result = { format: 'docx', text, truncated, extraction_method: 'library' };
  if (parseError) {
    result.warning = `DOCX 解析エラー: ${parseError}`;
  }
  return result;
}

async function extractXlsx(buffer) {
  const sheets = [];
  let parseError = null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    wb.eachSheet((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        // row.values は 1-indexed、空のセルは undefined。filter で詰める
        const values = (row.values || []).slice(1).map(v => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') {
            // formula 等は { result } を持つことがある
            if ('result' in v) return String(v.result);
            if ('text' in v) return String(v.text);
            return JSON.stringify(v);
          }
          return String(v);
        });
        rows.push(values.join(','));
      });
      sheets.push({ name: ws.name, rows: rows.join('\n') });
    });
  } catch (err) {
    parseError = err.message;
  }

  const combined = sheets.map(s => `=== sheet: ${s.name} ===\n${s.rows}`).join('\n\n');
  const { text, truncated } = truncateText(combined);
  const result = { format: 'xlsx', text, sheets, truncated, extraction_method: 'library' };
  if (parseError) {
    result.warning = `XLSX 解析エラー: ${parseError}`;
  }
  return result;
}

async function extractText(media) {
  const format = detectFormat(media);
  const buffer = Buffer.from(media?.data_base64 || '', 'base64');

  if (buffer.length > MAX_BINARY_BYTES) {
    return {
      format,
      text: '',
      truncated: true,
      warning: `binary が ${MAX_BINARY_BYTES} bytes を超過 (実 size: ${buffer.length})`,
    };
  }

  switch (format) {
    case 'pdf':  return await extractPdf(buffer);
    case 'docx': return await extractDocx(buffer);
    case 'xlsx': return await extractXlsx(buffer);
    default:
      return {
        format: 'unsupported',
        text: '',
        warning: `未対応の format: mime=${media?.mime_type || '(なし)'} / file=${media?.file_name || '(なし)'}`,
      };
  }
}

module.exports = {
  extractText,
  detectFormat,
  // exports for testing
  MAX_BINARY_BYTES,
  MAX_TEXT_LENGTH,
  MIN_TEXT_LENGTH_FOR_OK,
};
