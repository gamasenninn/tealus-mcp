#!/usr/bin/env node
/**
 * Tealus MCP Server
 * Tealus Bot API を MCP ツールとして公開
 *
 * Transport (#264 Phase 1 alpha):
 *   stdio (default、後方互換): node src/index.js
 *   http  (cross-machine):     node src/index.js --transport=http
 *
 * Env source 優先順 (dotenv default = no-override):
 *   1. parent process env (npx stdio 起動時 MCP client が渡す env はここで先に set される)
 *   2. cwd の .env (HTTP host mode で運用する時の便利機能、なければ silent skip)
 */
require('dotenv').config();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { TealusClient } = require('./tealusClient');
const { registerTools } = require('./tools');

// --- args (minimal parse、no extra dep) ---
function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--transport=')) args.transport = a.slice('--transport='.length);
  }
  return args;
}
const args = parseArgs(process.argv);
const transport = args.transport || 'stdio';
if (!['stdio', 'http'].includes(transport)) {
  console.error(`Unknown --transport=${transport} (expected: stdio | http)`);
  process.exit(1);
}

// --- env (stdio / http 共通) ---
const apiUrl = process.env.TEALUS_API_URL || 'http://localhost:3000';
const userId = process.env.TEALUS_USER_ID || process.env.TEALUS_BOT_ID;
const password = process.env.TEALUS_PASSWORD || process.env.TEALUS_BOT_PASS;

if (!userId || !password) {
  console.error('TEALUS_USER_ID and TEALUS_PASSWORD are required');
  process.exit(1);
}

const server = new McpServer({
  name: 'tealus',
  version: '1.0.0',
});

const client = new TealusClient({ apiUrl, userId, password });

registerTools(server, client);

async function main() {
  if (transport === 'http') {
    // http branch でのみ JWT_SECRET 必須
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET is required for --transport=http (must match tealus server / agent-server)');
      process.exit(1);
    }
    const port = parseInt(process.env.MCP_HTTP_PORT || '3200', 10);
    const { startHttpServer } = require('./httpServer');
    await startHttpServer({ mcpServer: server, port, jwtSecret });
  } else {
    // stdio (default、既存動作不変)
    const stdio = new StdioServerTransport();
    await server.connect(stdio);
    console.error('Tealus MCP Server running on stdio');
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
