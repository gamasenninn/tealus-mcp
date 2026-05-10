/**
 * HTTP transport integration tests (#264 Phase 1 alpha)
 *
 * v0.12.3+: stateful session management。initialize で session ID を発行 → 後続 request で
 * Mcp-Session-Id header 経由で同 transport へ dispatch する pattern。
 */
const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { createJwtAuth } = require('../src/middleware/jwtAuth');

const SECRET = 'test-jwt-secret-264';

/**
 * httpServer.js の startHttpServer() と同じ shape の Express app を build (port listen 無し)。
 * stateful session 管理 + session ごとに新 McpServer instance (SDK の single-transport 制約)。
 */
function buildTestApp(mcpServerFactory) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const healthHandler = (req, res) => {
    res.json({ status: 'ok', transport: 'http', server: 'tealus-mcp' });
  };
  app.get('/health', healthHandler);
  app.get('/mcp/health', healthHandler);
  const jwtAuth = createJwtAuth(SECRET);
  const transports = new Map();

  app.all('/mcp', jwtAuth, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport;
      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => transports.set(id, transport),
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
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
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
  return { app, transports };
}

/**
 * SSE response (text/event-stream) を JSON-RPC payload に parse。
 */
function parseSseResponse(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice('data: '.length));
    }
  }
  try { return JSON.parse(text); } catch { return null; }
}

function makeTestMcpServer() {
  const server = new McpServer({ name: 'tealus-test', version: '0.0.0-test' });
  server.tool('echo', 'echo back', { text: z.string() }, async ({ text }) => ({
    content: [{ type: 'text', text }],
  }));
  return server;
}

const initBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'jest-test', version: '0.0' },
  },
};

describe('HTTP transport — /health', () => {
  let app;
  beforeAll(() => { app = buildTestApp(makeTestMcpServer).app; });

  test('GET /health returns 200 (no auth)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ok', transport: 'http' }));
  });

  test('GET /mcp/health returns 200 (no auth) — for through-proxy access', async () => {
    const res = await request(app).get('/mcp/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ok', transport: 'http' }));
  });
});

describe('HTTP transport — /mcp auth', () => {
  let app;
  beforeAll(() => { app = buildTestApp(makeTestMcpServer).app; });

  test('POST /mcp without Authorization returns 401', async () => {
    const res = await request(app).post('/mcp').send(initBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization header missing/);
  });

  test('POST /mcp with invalid Bearer returns 401', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer not-a-jwt')
      .send(initBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/JWT verification failed/);
  });
});

describe('HTTP transport — /mcp MCP protocol (stateful session)', () => {
  let app;
  let token;
  beforeAll(() => {
    app = buildTestApp(makeTestMcpServer).app;
    token = jwt.sign({ userId: 'test-user' }, SECRET);
  });

  test('initialize handshake returns session ID in response header', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initBody);
    expect(res.status).toBe(200);
    // Mcp-Session-Id header should be present
    expect(res.headers['mcp-session-id']).toBeDefined();
    expect(res.headers['mcp-session-id']).toMatch(/^[0-9a-f-]{36}$/i); // UUID
    const payload = parseSseResponse(res.text);
    expect(payload).not.toBeNull();
    expect(payload.result.serverInfo.name).toBe('tealus-test');
  });

  test('tools/list with session ID returns registered tools', async () => {
    // 1. initialize で session 取得
    const init = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initBody);
    const sessionId = init.headers['mcp-session-id'];
    expect(sessionId).toBeDefined();

    // 2. tools/list を session ID 付きで送信
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Mcp-Session-Id', sessionId)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    const payload = parseSseResponse(res.text);
    expect(payload).not.toBeNull();
    expect(payload.result.tools).toBeInstanceOf(Array);
    const names = payload.result.tools.map((t) => t.name);
    expect(names).toContain('echo');
  });

  test('non-initialize request without session ID returns 400', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No valid session ID/);
  });

  test('request with unknown session ID returns 400 (not in transports map)', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Mcp-Session-Id', 'unknown-session-id-not-registered')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    // 既存 session に居ない + 非 initialize → 400
    expect(res.status).toBe(400);
  });
});

describe('HTTP transport — session lifecycle', () => {
  test('two separate initialize calls produce different session IDs', async () => {
    const { app } = buildTestApp(makeTestMcpServer);
    const token = jwt.sign({ userId: 'u1' }, SECRET);

    const r1 = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initBody);
    const r2 = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initBody);

    expect(r1.headers['mcp-session-id']).toBeDefined();
    expect(r2.headers['mcp-session-id']).toBeDefined();
    expect(r1.headers['mcp-session-id']).not.toBe(r2.headers['mcp-session-id']);
  });
});
