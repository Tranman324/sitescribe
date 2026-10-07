'use strict';

/**
 * routes — dispatches incoming HTTP requests to handlers.
 * Keeps the HTTP entry point thin and the per-route logic isolated.
 */

const config = require('../config');
const log = require('../logger').child({ mod: 'server' });
const { receiveSubmission, ValidationError } = require('../upload');
const { processSubmission } = require('../pipeline');
const { checkToken } = require('./auth');
const { limiter } = require('./rate-limit');

const BOOT_TIME = Date.now();

// Only trust X-Forwarded-For behind a known reverse proxy; otherwise clients could
// rotate the header to dodge the rate limiter.
function clientIp(req, trustProxy = config.trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

function jsonResponse(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function handleHealth(_req, res) {
  jsonResponse(res, 200, {
    status: 'ok',
    service: 'sitescribe',
    version: config.version,
    uptime_s: Math.floor((Date.now() - BOOT_TIME) / 1000),
  });
}

async function handleMeetingNotes(req, res) {
  const ip = clientIp(req);
  if (!limiter.check(ip)) {
    return jsonResponse(res, 429, { error: 'Too many requests. Try again in a minute.' });
  }

  if (!checkToken(req)) {
    return jsonResponse(res, 401, { error: 'Invalid or missing auth token' });
  }

  let submission;
  try {
    submission = await receiveSubmission(req);
  } catch (err) {
    if (err instanceof ValidationError) {
      log.warn('validation rejected', { error: err.message, status: err.status });
      return jsonResponse(res, err.status, { error: err.message });
    }
    log.error('upload error', { error: err.message });
    return jsonResponse(res, 500, { error: 'Upload failed' });
  }

  // Ack immediately; process in background.
  jsonResponse(res, 202, {
    status: 'processing',
    message: 'Received. Notes will be emailed to you.',
    reqId: submission.reqId,
  });

  // Fire-and-forget — pipeline handles its own errors + cleanup
  setImmediate(() => {
    processSubmission(submission).catch((err) => {
      log.error('pipeline uncaught', { reqId: submission.reqId, error: err.message });
    });
  });
}

function dispatch(req, res) {
  // iOS Shortcuts sends no Origin header; answering preflight is harmless and keeps
  // browser-based testing tools working.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-auth-token, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && url === '/health') return handleHealth(req, res);
  if (req.method === 'POST' && url === '/api/meeting-notes') return handleMeetingNotes(req, res);

  jsonResponse(res, 404, { error: 'Not found' });
}

module.exports = { dispatch, clientIp };
