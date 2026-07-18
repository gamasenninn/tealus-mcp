/**
 * #336 汎用フォーム primitive: フォーム定義 → メッセージ content 文字列。
 *
 * content = 可読ヘッダ (title/intro/質問一覧の箇条書き) + fenced ```tealus-form JSON。
 * fence が機械可読 source of truth、可読ヘッダは fallback / 検索 / organon 可読性用。
 * 純関数 (Jest 対象)。
 */

/**
 * @param {{title:string, intro?:string, reply_mention?:string, submit_label?:string, fields:Array}} form
 * @returns {string} メッセージ content
 */
function buildFormContent(form) {
  const { title, intro, reply_mention, submit_label, fields } = form;
  if (!title || !Array.isArray(fields) || fields.length === 0) {
    throw new Error('buildFormContent: title と fields(1件以上) が必要です');
  }

  // 可読ヘッダ (fence 非対応環境でも質問が読める)
  const header = [`📋 ${title}`];
  if (intro) header.push('', intro);
  header.push('', '以下に回答して「回答する」を押してください。', '');
  fields.forEach((f, i) => {
    const opts = f.type === 'radio' && Array.isArray(f.options)
      ? ` [${f.options.map((o) => o.label).join(' / ')}]`
      : '';
    header.push(`- Q${i + 1}. ${f.label}${opts}`);
  });

  // 機械可読 schema
  const schema = { version: 1, title, fields };
  if (intro) schema.intro = intro;
  if (reply_mention) schema.reply_mention = reply_mention;
  if (submit_label) schema.submit_label = submit_label;

  return `${header.join('\n')}\n\n\`\`\`tealus-form\n${JSON.stringify(schema)}\n\`\`\``;
}

module.exports = { buildFormContent };
