/**
 * Unit tests for JWT auth middleware (#264 Phase 1 alpha)
 */
const jwt = require('jsonwebtoken');
const { createJwtAuth } = require('../src/middleware/jwtAuth');

const SECRET = 'test-secret-jwt-264';

function makeMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('createJwtAuth', () => {
  test('throws when secret is missing', () => {
    expect(() => createJwtAuth()).toThrow(/secret is required/);
    expect(() => createJwtAuth('')).toThrow(/secret is required/);
  });

  test('returns 401 when Authorization header is missing', () => {
    const middleware = createJwtAuth(SECRET);
    const req = { headers: {} };
    const res = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringMatching(/Authorization header missing or malformed/),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header lacks Bearer prefix', () => {
    const middleware = createJwtAuth(SECRET);
    const req = { headers: { authorization: 'Basic xxx' } };
    const res = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when JWT is invalid', () => {
    const middleware = createJwtAuth(SECRET);
    const req = { headers: { authorization: 'Bearer not-a-real-jwt' } };
    const res = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringMatching(/JWT verification failed/),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when JWT is signed with a different secret', () => {
    const middleware = createJwtAuth(SECRET);
    const wrongToken = jwt.sign({ userId: 'u1' }, 'different-secret');
    const req = { headers: { authorization: `Bearer ${wrongToken}` } };
    const res = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and sets req.tealusUser when JWT is valid', () => {
    const middleware = createJwtAuth(SECRET);
    const token = jwt.sign({ userId: 'u1', sub: 'spike' }, SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.tealusUser).toEqual(expect.objectContaining({ userId: 'u1', sub: 'spike' }));
  });
});
