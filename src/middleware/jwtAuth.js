/**
 * JWT auth middleware for HTTP transport (#264 Phase 1 alpha)
 *
 * Tealus 本体 (server / agent-server) と同じ JWT_SECRET を共有する前提。
 * fail-fast 401 (anonymous fallback なし、scope 厳守)。
 */
const jwt = require('jsonwebtoken');

/**
 * @param {string} secret - JWT secret (Tealus 本体と共有)
 * @returns {Function} Express middleware
 */
function createJwtAuth(secret) {
  if (!secret) {
    throw new Error('createJwtAuth: secret is required');
  }
  return function jwtAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      req.tealusUser = jwt.verify(token, secret);
      next();
    } catch (err) {
      // err.message を返すのは採用者の debug 容易化のため (stack は載せない)
      return res.status(401).json({ error: `JWT verification failed: ${err.message}` });
    }
  };
}

module.exports = { createJwtAuth };
