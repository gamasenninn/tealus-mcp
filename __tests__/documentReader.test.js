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
