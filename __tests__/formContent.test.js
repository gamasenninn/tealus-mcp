/**
 * #336 buildFormContent unit tests。
 * content = 可読ヘッダ + fenced tealus-form JSON。fence が有効 JSON かも検証。
 */
const { buildFormContent } = require('../src/lib/formContent');

const FORM = {
  title: 'Day59 Q0',
  reply_mention: '@cc-organon',
  fields: [
    { id: 'q1', type: 'radio', label: '笹沼さんは?', required: true,
      options: [{ value: 'record', label: '記録のみ' }, { value: 'issue', label: '起票' }] },
    { id: 'q2', type: 'text', label: '記録方針', multiline: true },
  ],
};

function extractFence(content) {
  const m = content.match(/```tealus-form\s*\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
}

describe('buildFormContent', () => {
  it('可読ヘッダに title と各質問が出る', () => {
    const c = buildFormContent(FORM);
    expect(c).toContain('📋 Day59 Q0');
    expect(c).toContain('Q1. 笹沼さんは?');
    expect(c).toContain('Q2. 記録方針');
    expect(c).toContain('[記録のみ / 起票]'); // radio の選択肢が可読ヘッダに
  });

  it('fenced tealus-form が有効 JSON で schema を含む', () => {
    const schema = extractFence(buildFormContent(FORM));
    expect(schema).not.toBeNull();
    expect(schema.version).toBe(1);
    expect(schema.title).toBe('Day59 Q0');
    expect(schema.reply_mention).toBe('@cc-organon');
    expect(schema.fields).toHaveLength(2);
  });

  it('reply_mention 省略時は schema に含めない', () => {
    const schema = extractFence(buildFormContent({ ...FORM, reply_mention: undefined }));
    expect(schema.reply_mention).toBeUndefined();
  });

  it('title/fields 欠如はエラー', () => {
    expect(() => buildFormContent({ fields: [] })).toThrow();
    expect(() => buildFormContent({ title: 'x', fields: [] })).toThrow();
  });

  it('client の parseForm 正規表現と互換 (fence が抽出できる)', () => {
    // client/src/utils/parseForm.ts の FENCE_RE と同じパターン
    const FENCE_RE = /```tealus-form\s*\n([\s\S]*?)\n```/;
    expect(FENCE_RE.test(buildFormContent(FORM))).toBe(true);
  });
});
