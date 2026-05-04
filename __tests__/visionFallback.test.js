/**
 * visionFallback.js unit tests
 *
 * Gemini SDK は jest.mock で簡易モック (network 呼び出しなし)。
 */

describe('isVisionEnabled', () => {
  const origKey = process.env.GOOGLE_API_KEY;
  const origProvider = process.env.DOCUMENT_VISION_PROVIDER;

  afterEach(() => {
    if (origKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = origKey;
    if (origProvider === undefined) delete process.env.DOCUMENT_VISION_PROVIDER;
    else process.env.DOCUMENT_VISION_PROVIDER = origProvider;
    jest.resetModules();
  });

  test('GOOGLE_API_KEY あり、provider 未設定 → enabled', () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    delete process.env.DOCUMENT_VISION_PROVIDER;
    const { isVisionEnabled } = require('../src/lib/visionFallback');
    expect(isVisionEnabled()).toBe(true);
  });

  test('GOOGLE_API_KEY なし → disabled', () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.DOCUMENT_VISION_PROVIDER;
    const { isVisionEnabled } = require('../src/lib/visionFallback');
    expect(isVisionEnabled()).toBe(false);
  });

  test('DOCUMENT_VISION_PROVIDER=none → disabled (key あっても)', () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    process.env.DOCUMENT_VISION_PROVIDER = 'none';
    const { isVisionEnabled } = require('../src/lib/visionFallback');
    expect(isVisionEnabled()).toBe(false);
  });

  test('DOCUMENT_VISION_PROVIDER=gemini + key なし → disabled', () => {
    delete process.env.GOOGLE_API_KEY;
    process.env.DOCUMENT_VISION_PROVIDER = 'gemini';
    const { isVisionEnabled } = require('../src/lib/visionFallback');
    expect(isVisionEnabled()).toBe(false);
  });
});

describe('extractTextWithGemini', () => {
  const origKey = process.env.GOOGLE_API_KEY;
  const origMaxPages = process.env.DOCUMENT_VISION_MAX_PAGES;

  afterEach(() => {
    if (origKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = origKey;
    if (origMaxPages === undefined) delete process.env.DOCUMENT_VISION_MAX_PAGES;
    else process.env.DOCUMENT_VISION_MAX_PAGES = origMaxPages;
    jest.resetModules();
  });

  test('GOOGLE_API_KEY なし → enabled: false で返す', async () => {
    delete process.env.GOOGLE_API_KEY;
    const { extractTextWithGemini } = require('../src/lib/visionFallback');
    const r = await extractTextWithGemini({ data_base64: 'AAAA', mime_type: 'application/pdf' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/GOOGLE_API_KEY/);
  });

  test('page count 上限超過 → truncated: true で skip', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    process.env.DOCUMENT_VISION_MAX_PAGES = '5';
    const { extractTextWithGemini } = require('../src/lib/visionFallback');
    const r = await extractTextWithGemini(
      { data_base64: 'AAAA', mime_type: 'application/pdf' },
      { pages: 10 }
    );
    expect(r.enabled).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.warning).toMatch(/exceeds DOCUMENT_VISION_MAX_PAGES/);
    expect(r.text).toBe('');
  });

  test('Gemini SDK 成功 → text 返却', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    jest.resetModules();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: 'これは PDF の本文です',
          }),
        },
      })),
    }));
    const { extractTextWithGemini } = require('../src/lib/visionFallback');
    const r = await extractTextWithGemini({
      data_base64: Buffer.from('%PDF-1.4').toString('base64'),
      mime_type: 'application/pdf',
    });
    expect(r.enabled).toBe(true);
    expect(r.provider).toBe('gemini');
    expect(r.model).toMatch(/gemini-2\.5/);
    expect(r.text).toBe('これは PDF の本文です');
    jest.dontMock('@google/genai');
  });

  test('Gemini SDK error → warning 付きで empty text 返却', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    jest.resetModules();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockRejectedValue(new Error('rate limit exceeded')),
        },
      })),
    }));
    const { extractTextWithGemini } = require('../src/lib/visionFallback');
    const r = await extractTextWithGemini({
      data_base64: 'AAAA',
      mime_type: 'application/pdf',
    });
    expect(r.enabled).toBe(true);
    expect(r.text).toBe('');
    expect(r.warning).toMatch(/Gemini API error.*rate limit/);
    jest.dontMock('@google/genai');
  });
});
