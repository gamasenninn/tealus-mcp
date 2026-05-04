/**
 * documentReader.js unit tests
 *
 * fixtures は __tests__/fixtures/ の sample.pdf / sample.docx / sample.xlsx を使用。
 * fixtures が無い場合は generate.js で再生成可能。
 */
const fs = require('fs');
const path = require('path');
const { extractText, detectFormat } = require('../src/lib/documentReader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function readFixtureAsMedia(filename, mimeType) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, filename));
  return {
    type: 'file',
    data_base64: buffer.toString('base64'),
    mime_type: mimeType,
    file_name: filename,
    file_size: buffer.length,
  };
}

describe('detectFormat', () => {
  test('PDF: mime + ext で判定', () => {
    expect(detectFormat({ mime_type: 'application/pdf', file_name: 'a.pdf' })).toBe('pdf');
    expect(detectFormat({ mime_type: '', file_name: 'a.pdf' })).toBe('pdf');
    expect(detectFormat({ mime_type: 'application/pdf', file_name: '' })).toBe('pdf');
  });

  test('DOCX: openxml mime + .docx ext', () => {
    expect(detectFormat({
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_name: 'a.docx',
    })).toBe('docx');
    expect(detectFormat({ mime_type: '', file_name: 'report.DOCX' })).toBe('docx');
  });

  test('XLSX: openxml mime + .xlsx ext', () => {
    expect(detectFormat({
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file_name: 'a.xlsx',
    })).toBe('xlsx');
    expect(detectFormat({ mime_type: '', file_name: 'data.xlsx' })).toBe('xlsx');
  });

  test('未対応 format', () => {
    expect(detectFormat({ mime_type: 'video/mp4', file_name: 'movie.mp4' })).toBe('unsupported');
    expect(detectFormat({ mime_type: 'image/png', file_name: 'icon.png' })).toBe('unsupported');
    expect(detectFormat({ mime_type: '', file_name: '' })).toBe('unsupported');
  });
});

describe('extractText - PDF', () => {
  test('digital PDF を text 化、pages を返す', async () => {
    const media = readFixtureAsMedia('sample.pdf', 'application/pdf');
    const result = await extractText(media);
    expect(result.format).toBe('pdf');
    expect(result.text).toContain('Hello PDF World');
    expect(result.text).toContain('Tealus');
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeUndefined();
  });
});

describe('extractText - DOCX', () => {
  test('DOCX の paragraph を text 化', async () => {
    const media = readFixtureAsMedia(
      'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const result = await extractText(media);
    expect(result.format).toBe('docx');
    expect(result.text).toContain('Hello DOCX World');
    expect(result.text).toContain('Tealus');
    expect(result.truncated).toBe(false);
  });
});

describe('extractText - XLSX', () => {
  test('XLSX の各 sheet を CSV 形式で返す', async () => {
    const media = readFixtureAsMedia(
      'sample.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const result = await extractText(media);
    expect(result.format).toBe('xlsx');
    expect(result.sheets).toHaveLength(2);
    expect(result.sheets[0].name).toBe('Members');
    expect(result.sheets[1].name).toBe('Inventory');
    // combined text should contain key values from both sheets
    expect(result.text).toContain('Alice');
    expect(result.text).toContain('apple');
    // sheet ごと csv (sheet header マーカーが入ってる)
    expect(result.text).toContain('=== sheet: Members ===');
    expect(result.text).toContain('=== sheet: Inventory ===');
    expect(result.truncated).toBe(false);
  });
});

describe('extractText - 未対応 format', () => {
  test('video は unsupported を返し warning 付き', async () => {
    const media = {
      type: 'video',
      data_base64: 'AAAA',
      mime_type: 'video/mp4',
      file_name: 'movie.mp4',
      file_size: 4,
    };
    const result = await extractText(media);
    expect(result.format).toBe('unsupported');
    expect(result.text).toBe('');
    expect(result.warning).toContain('未対応');
  });
});

describe('extractText - size 上限', () => {
  test('binary が MAX_BINARY_BYTES を超える時 truncated + warning', async () => {
    // 11MB の dummy buffer (PDF と装う)
    const big = Buffer.alloc(11 * 1024 * 1024, 0);
    const media = {
      type: 'file',
      data_base64: big.toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'huge.pdf',
      file_size: big.length,
    };
    const result = await extractText(media);
    expect(result.truncated).toBe(true);
    expect(result.warning).toMatch(/binary/);
    expect(result.text).toBe('');
  });
});

describe('extractText - scan PDF heuristic', () => {
  test('text 抽出量が極端に少ない PDF は warning 付き', async () => {
    // pdf-parse が text 取れない (or 50 chars 未満) PDF を simulate するため、
    // pdf-parse をモックして "" 返すケースを test
    jest.resetModules();
    jest.doMock('pdf-parse', () => async () => ({ text: '', numpages: 3 }));
    const { extractText: extractTextMocked } = require('../src/lib/documentReader');
    const result = await extractTextMocked({
      type: 'file',
      data_base64: Buffer.from('%PDF-1.0\n').toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'scan.pdf',
      file_size: 9,
    });
    expect(result.format).toBe('pdf');
    expect(result.warning).toMatch(/scan PDF|image-only|抽出量/);
    jest.dontMock('pdf-parse');
  });

  test('text が改行/空白のみの PDF (実 scan PDF パターン) も warning 付き', async () => {
    // pdf-parse が pages や構造は取れるが本文は \n だけ返すケース
    // (実 scan PDF / image-only PDF で観測された)
    jest.resetModules();
    jest.doMock('pdf-parse', () => async () => ({ text: '\n'.repeat(270), numpages: 7 }));
    const { extractText: extractTextMocked } = require('../src/lib/documentReader');
    const result = await extractTextMocked({
      type: 'file',
      data_base64: Buffer.from('%PDF-1.4\n').toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'scan-7pages.pdf',
      file_size: 9,
    });
    expect(result.format).toBe('pdf');
    expect(result.pages).toBe(7);
    expect(result.warning).toMatch(/scan PDF|image-only|抽出量/);
    expect(result.warning).toMatch(/空白除外/);
    jest.dontMock('pdf-parse');
  });
});

describe('extractText - vision fallback chain (#233)', () => {
  const origKey = process.env.GOOGLE_API_KEY;
  afterEach(() => {
    if (origKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = origKey;
    jest.resetModules();
  });

  test('scan PDF + GOOGLE_API_KEY あり → vision fallback が呼ばれて text が返る', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    jest.resetModules();
    // pdf-parse: scan PDF を simulate (空白だけ返す)
    jest.doMock('pdf-parse', () => async () => ({ text: '\n\n\n', numpages: 5 }));
    // Gemini: 成功応答
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: 'スキャン PDF から抽出した本文です',
          }),
        },
      })),
    }));
    const { extractText } = require('../src/lib/documentReader');
    const result = await extractText({
      data_base64: Buffer.from('%PDF-1.4\n').toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'scan.pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.extraction_method).toBe('vision_gemini');
    expect(result.text).toBe('スキャン PDF から抽出した本文です');
    expect(result.pages).toBe(5);
    jest.dontMock('pdf-parse');
    jest.dontMock('@google/genai');
  });

  test('scan PDF + GOOGLE_API_KEY なし → warning で fallback 案内', async () => {
    delete process.env.GOOGLE_API_KEY;
    jest.resetModules();
    jest.doMock('pdf-parse', () => async () => ({ text: '\n\n\n', numpages: 7 }));
    const { extractText } = require('../src/lib/documentReader');
    const result = await extractText({
      data_base64: Buffer.from('%PDF-1.4\n').toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'scan.pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.extraction_method).toBe('library');
    expect(result.warning).toMatch(/GOOGLE_API_KEY 未設定/);
    jest.dontMock('pdf-parse');
  });

  test('digital PDF (text 取れる) → vision fallback 呼ばれない', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    jest.resetModules();
    const generateContentMock = jest.fn();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: { generateContent: generateContentMock },
      })),
    }));
    const { extractText } = require('../src/lib/documentReader');
    // 実 sample.pdf (Hello PDF World) で digital
    const fs = require('fs');
    const path = require('path');
    const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.pdf'));
    const result = await extractText({
      data_base64: buffer.toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'sample.pdf',
    });
    expect(result.extraction_method).toBe('library');
    expect(result.text).toContain('Hello PDF World');
    expect(generateContentMock).not.toHaveBeenCalled();
    jest.dontMock('@google/genai');
  });
});

describe('extractText - error handling', () => {
  test('破損 PDF は format pdf + warning で返す (例外を上に投げない)', async () => {
    const media = {
      type: 'file',
      data_base64: Buffer.from('not a real pdf').toString('base64'),
      mime_type: 'application/pdf',
      file_name: 'broken.pdf',
      file_size: 14,
    };
    const result = await extractText(media);
    expect(result.format).toBe('pdf');
    // 抽出失敗 → warning 付き返却
    expect(result.warning).toBeDefined();
  });
});
