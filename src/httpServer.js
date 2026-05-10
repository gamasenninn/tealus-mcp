/**
 * HTTP transport for tealus-mcp (#264 Phase 1 alpha)
 *
 * StreamableHTTPServerTransport を **stateful session management** で運用。
 *
 * 設計:
 *   - initialize 時: 新 transport + 新 McpServer instance を作成、Map に保存
 *   - 後続 request: Mcp-Session-Id header で同 transport へ dispatch
 *   - transport.onclose で auto cleanup (Map から削除)
 *
 * SDK 制約 (`shared/protocol.js:219-222`):
 *   `Protocol.connect()` は `_transport` 既設時に throw。
 *   → 1 McpServer = 1 transport の関係を厳守、session ごとに **新 McpServer instance** を生成。
 *   → 高頻度 session の場合、tool registration の cost を許容する設計 (Phase 1 alpha 範囲では問題なし)。
 *
 * 5/10 Test 6 で Claude Code の `/mcp` で「tools fetch failed」が出た真因:
 *   v0.12.0-v0.12.2 は per-request transport (stateless) で、initialize と
 *   tools/list が **別 transport instance** になり SDK が「initialized 状態じゃない」と reject。
 *   curl/supertest は単発 request で完結するので問題なかったが、proper MCP client
 *   (Claude Code 等) は initialize → tools/list 連続呼びで失敗する。
 *
 * Phase 1 alpha scope: HTTP request/response (stateful session)。
 * SSE event broker (server → client wake-up) は Phase 2 で別途。
 */
const express = require('express');
const { randomUUID } = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { createJwtAuth } = require('./middleware/jwtAuth');

/**
 * @param {object} opts
 * @param {() => object} opts.mcpServerFactory - 呼ぶたびに新 McpServer instance を返す factory。tools 登録済の状態で返すこと
 * @param {number} opts.port - listen port
 * @param {string} opts.jwtSecret - Tealus 本体と共有する JWT secret
 * @param {object} [opts.logger]
 * @returns {Promise<{ app, httpServer, transports }>}
 */
async function startHttpServer({ mcpServerFactory, port, jwtSecret, logger }) {
  if (typeof mcpServerFactory !== 'function') throw new Error('startHttpServer: mcpServerFactory is required (function returning McpServer)');
  if (!jwtSecret) throw new Error('startHttpServer: jwtSecret is required');
  const log = logger || { info: (m) => console.error(m), error: (m) => console.error(m) };

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // /health (root) と /mcp/health (proxy 経由) 両方を expose、no auth
  const healthHandler = (req, res) => {
    res.json({ status: 'ok', transport: 'http', server: 'tealus-mcp' });
  };
  app.get('/health', healthHandler);
  app.get('/mcp/health', healthHandler);

  const jwtAuth = createJwtAuth(jwtSecret);

  // sessionId -> transport (stateful session 管理)
  const transports = new Map();

  app.all('/mcp', jwtAuth, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && transports.has(sessionId)) {
        // 既存 session の継続 request
        transport = transports.get(sessionId);
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        // 新規 session: 新 transport + 新 McpServer instance を作成
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            log.info(`[mcp] session initialized: ${id}`);
          },
        });
        // transport.onclose は connect() 内で chain される (既存 callback も保持される)
        transport.onclose = () => {
          if (transport.sessionId && transports.has(transport.sessionId)) {
            transports.delete(transport.sessionId);
            log.info(`[mcp] session closed: ${transport.sessionId}`);
          }
        };
        const sessionMcpServer = mcpServerFactory();
        await sessionMcpServer.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error(`[mcp] handleRequest error: ${err.stack || err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
          id: null,
        });
      }
    }
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, () => {
      log.info(`[tealus-mcp] HTTP transport listening on :${port}`);
      log.info(`[tealus-mcp] POST /mcp (JWT required), GET /health (no auth)`);
      resolve({ app, httpServer, transports });
    });
    httpServer.on('error', reject);
  });
}

module.exports = { startHttpServer };
