'use strict';

/**
 * auth: shared-token check for POST /api/meeting-notes.
 * Header only (query-string tokens leak into proxy logs). Constant-time compare.
 */

const crypto = require('crypto');
const config = require('../config');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkToken(req) {
  const token = req.headers['x-auth-token'];
  return Boolean(token) && safeEqual(token, config.authToken);
}

module.exports = { checkToken, safeEqual };
