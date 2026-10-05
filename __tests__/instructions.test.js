/**
 * tealus#484 返し方の決まりを MCP の案内文 (instructions) に置く
 *
 * ★ 以前は Tealus の listen-tealus skill の中にだけあり、skill を使わない受け手
 *   (PaneDeck のペインや、別のエージェント) には届かなかった。MCP の案内文は、つないだ
 *   session が最初に必ず読むので、受け取り方にもエージェントにも依らずに届く。
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../src/server');
const { INSTRUCTIONS } = require('../src/instructions');

describe('MCP の案内文 (tealus#484)', () => {
  it('★★ つないだ client に案内文が届く (stdio / http の両方が同じ createMcpServer を使う)', async () => {
    const server = createMcpServer({});   // 案内文の受け渡しだけを見る (道具は呼ばない)
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    await client.close();
  });

  // ★ 決まりの中身。言い回しは変えてよいが、この 5 つが抜けたら落とす
  it.each([
    ['mention は行頭に素で (飾りで囲うと起こさない)', /行頭/],
    ['飾りで囲った mention は起こさない', /\*\*@cc-/],
    ['同報への返信は発信者 1 人に', /発信者/],
    ['@cc- を付けるのは 1 日遅れて困る便だけ', /1 日遅れ/],
    ['起こされたら本文は道具で取りに行く', /get_messages/],
  ])('★ %s', (_label, re) => {
    expect(INSTRUCTIONS).toMatch(re);
  });

  it('案内文は短く保つ (毎回すべての session の最初に読まれる)', () => {
    expect(INSTRUCTIONS.length).toBeLessThan(1500);
  });
});
