/**
 * HTTP transport integration tests (#264 Phase 1 alpha)
 *
 * supertest で request-level test。実 port listen はせず、Express app のみ test。
 * StreamableHTTPServerTransport の SSE response 形式 (text/event-stream) は parse helper で扱う。
 */
const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { createJwtAuth } = require('../src/middleware/jwtAuth');

const SECRET = 'test-jwt-secret-264';

/**
 * httpServer.js の startHttpServer() と同じ shape の Express app を build (port listen 無し)。
 * 実 listen を避けつつ supertest で request 投下できる形。
 */
function buildTestApp(mcpServer) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const healthHandler = (req, res) => {
    res.json({ status: 'ok', transport: 'http', server: 'tealus-mcp' });
  };
  app.get('/health', healthHandler);
  app.get('/mcp/health', healthHandler);
  const jwtAuth = createJwtAuth(SECRET);
  app.all('/mcp', jwtAuth, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => transport.close().catch(() => {}));
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
  return app;
}

/**
 * SSE response (text/event-stream) を JSON-RPC payload に parse。
 * 形式: "event: message\ndata: {...}\n\n"
 */
function parseSseResponse(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice('data: '.length));
    }
  }
  // 通常の JSON response かもしれない (event-stream を要求しない場合)
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makeTestMcpServer() {
  const server = new McpServer({ name: 'tealus-test', version: '0.0.0-test' });
  // 1 件 dummy tool を register、tools/list で返る事を確認するだけが目的
  server.tool('echo', 'echo back', { text: z.string() }, async ({ text }) => ({
    content: [{ type: 'text', text }],
  }));
  return server;
}

describe('HTTP transport — /health', () => {
  let app;
  beforeAll(() => { app = buildTestApp(makeTestMcpServer()); });

  test('GET /health returns 200 (no auth)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'ok',
      transport: 'http',
    }));
  });

  test('GET /mcp/health returns 200 (no auth) — for through-proxy access', async () => {
    const res = await request(app).get('/mcp/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'ok',
      transport: 'http',
    }));
  });
});

describe('HTTP transport — /mcp auth', () => {
  let app;
  beforeAll(() => { app = buildTestApp(makeTestMcpServer()); });

  test('POST /mcp without Authorization returns 401', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization header missing/);
  });

  test('POST /mcp with invalid Bearer returns 401', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/JWT verification failed/);
  });
});

describe('HTTP transport — /mcp MCP protocol', () => {
  let app;
  let token;
  beforeAll(() => {
    app = buildTestApp(makeTestMcpServer());
    token = jwt.sign({ userId: 'test-user' }, SECRET);
  });

  test('initialize handshake succeeds', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'jest-test', version: '0.0' },
        },
      });
    expect(res.status).toBe(200);
    const payload = parseSseResponse(res.text);
    expect(payload).not.toBeNull();
    expect(payload.result).toEqual(expect.objectContaining({
      protocolVersion: expect.any(String),
      serverInfo: expect.objectContaining({ name: 'tealus-test' }),
    }));
  });

  test('tools/list returns registered tools', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    const payload = parseSseResponse(res.text);
    expect(payload).not.toBeNull();
    expect(payload.result.tools).toBeInstanceOf(Array);
    const names = payload.result.tools.map((t) => t.name);
    expect(names).toContain('echo');
  });
});

describe('HTTP transport — per-request transport lifecycle', () => {
  test('multiple requests do not share transport state (no session ID leakage)', async () => {
    const app = buildTestApp(makeTestMcpServer());
    const token = jwt.sign({ userId: 'u1' }, SECRET);

    // 連続 3 件 request を投げて、すべて独立に処理される事を確認
    // (shared transport では tools/list で 500 になる、spike L1 で実証済の制約)
    const responses = await Promise.all([
      request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const payload = parseSseResponse(res.text);
      expect(payload).not.toBeNull();
      expect(payload.result.tools).toBeInstanceOf(Array);
    }
  });
});
