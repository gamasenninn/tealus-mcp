/**
 * McpServer を組み立てる (stdio / http 共通)。
 * ★ tealus#484 案内文 (instructions) を渡す。index.js から切り出したのは、
 *   env の確認や process.exit を通らずにテストから組み立てるため。
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerTools } = require('./tools');
const { INSTRUCTIONS } = require('./instructions');

function createMcpServer(client) {
  const s = new McpServer({ name: 'tealus', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  registerTools(s, client);
  return s;
}

module.exports = { createMcpServer };
