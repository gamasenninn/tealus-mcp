/**
 * HTTP transport for tealus-mcp (#264 Phase 1 alpha)
 *
 * StreamableHTTPServerTransport を Express でラップ。per-request transport instance pattern
 * (spike L1 で実証済、shared transport は tools/list で 500 になる)。
 *
 * Phase 1 alpha scope: HTTP request/response のみ。SSE event broker (server → client wake-up)
 * は Phase 2 で別途。
 */
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createJwtAuth } = require('./middleware/jwtAuth');

/**
 * @param {object} opts
 * @param {object} opts.mcpServer - 構築済 McpServer instance (tools 登録済)
 * @param {number} opts.port - listen port (default 3200)
 * @param {string} opts.jwtSecret - Tealus 本体と共有する JWT secret
 * @param {object} [opts.logger] - { info, error } を持つ optional logger (default console)
 * @returns {Promise<{ app: import('express').Express, httpServer: import('http').Server }>}
 */
async function startHttpServer({ mcpServer, port, jwtSecret, logger }) {
  if (!mcpServer) throw new Error('startHttpServer: mcpServer is required');
  if (!jwtSecret) throw new Error('startHttpServer: jwtSecret is required');
  const log = logger || { info: (m) => console.error(m), error: (m) => console.error(m) };

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // /health は no auth (採用者の reachability check 用、proxy 経由では /mcp/health で見える)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', transport: 'http', server: 'tealus-mcp' });
  });

  const jwtAuth = createJwtAuth(jwtSecret);

  // MCP endpoint — per-request transport instance (spike L1 で確認済の必須 pattern)
  app.all('/mcp', jwtAuth, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      // request 終了で transport も close (memory leak 防止)
      res.on('close', () => {
        transport.close().catch((err) => log.error(`[mcp] transport close error: ${err.message}`));
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error(`[mcp] handleRequest error: ${err.stack || err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, () => {
      log.info(`[tealus-mcp] HTTP transport listening on :${port}`);
      log.info(`[tealus-mcp] POST /mcp (JWT required), GET /health (no auth)`);
      resolve({ app, httpServer });
    });
    httpServer.on('error', reject);
  });
}

module.exports = { startHttpServer };
