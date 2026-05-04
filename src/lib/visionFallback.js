/**
 * Vision API fallback (Phase 2 — scan PDF / image-only PDF 対応)
 *
 * Approach 1 (pdf-parse 等の library) で text が取れなかった PDF を
 * Gemini API (multimodal) に渡して text 化する。
 *
 * Default provider: Gemini 2.5 Flash-Lite (free tier 1,000 RPD / 15 RPM)
 * SDK: @google/genai (公式 Node.js)
 *
 * 採用者は GOOGLE_API_KEY env を設定すれば自動で有効化、
 * unset / DOCUMENT_VISION_PROVIDER=none で disable。
 *
 * **Privacy note**: Gemini free tier は Google が製品改善に利用、
 * human reviewer が input/output を処理する可能性あり。社内文書を
 * 扱う場合は paid billing account の API key を使うこと。
 */
const MAX_PAGES_DEFAULT = 20;
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const PROMPT = 'この PDF / 画像の本文 (日本語含む) を抽出してください。' +
  '整形・要約なしで、見えるテキストをそのまま返してください。' +
  '画像のみで本文がない場合は「(本文なし)」と返してください。';

/**
 * vision fallback が有効か判定
 */
function isVisionEnabled() {
  const provider = process.env.DOCUMENT_VISION_PROVIDER;
  if (provider === 'none') return false;
  if (provider === 'gemini') return !!process.env.GOOGLE_API_KEY;
  // default: GOOGLE_API_KEY があれば有効、なければ無効
  return !!process.env.GOOGLE_API_KEY;
}

/**
 * Gemini API で PDF / 画像から text 抽出
 *
 * @param {Object} media - { data_base64, mime_type, file_name }
 * @param {Object} options - { pages: number } (page count、既知なら渡す)
 * @returns {Object} { enabled, text, model, provider, truncated, warning }
 */
async function extractTextWithGemini(media, options = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      enabled: false,
      reason: 'GOOGLE_API_KEY not set',
    };
  }

  const model = process.env.DOCUMENT_VISION_MODEL || DEFAULT_MODEL;
  const maxPages = parseInt(
    process.env.DOCUMENT_VISION_MAX_PAGES || String(MAX_PAGES_DEFAULT),
    10
  );

  // page count check (Approach 1 で既知なら渡してもらう)
  if (options.pages !== undefined && options.pages > maxPages) {
    return {
      enabled: true,
      provider: 'gemini',
      model,
      text: '',
      truncated: true,
      warning: `PDF page count ${options.pages} exceeds DOCUMENT_VISION_MAX_PAGES=${maxPages}。cost 保護のため vision 呼び出しを skip しました`,
    };
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: media.mime_type || 'application/pdf',
              data: media.data_base64,
            },
          },
          { text: PROMPT },
        ],
      }],
    });
    const text = result.text || '';
    return {
      enabled: true,
      provider: 'gemini',
      model,
      text,
    };
  } catch (err) {
    return {
      enabled: true,
      provider: 'gemini',
      model,
      text: '',
      warning: `Gemini API error: ${err.message}`,
    };
  }
}

module.exports = {
  isVisionEnabled,
  extractTextWithGemini,
  // exports for testing
  MAX_PAGES_DEFAULT,
  DEFAULT_MODEL,
};
