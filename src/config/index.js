'use strict';

/**
 * config: load and validate environment. Fails fast on boot if required vars are missing.
 * Reads .env from the working directory (see .env.example).
 */

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function intOr(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return n;
}

const mailTransport = (process.env.MAIL_TRANSPORT || 'file').toLowerCase();
if (!['graph', 'file'].includes(mailTransport)) {
  throw new Error(`MAIL_TRANSPORT must be "graph" or "file", got: ${mailTransport}`);
}

const config = Object.freeze({
  port: intOr('PORT', 3479),
  authToken: required('WEBHOOK_TOKEN'),
  uploadDir: process.env.UPLOAD_DIR || '/tmp/sitescribe-uploads',
  maxPhotos: intOr('MAX_PHOTOS', 5),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY === 'true',
  timeZone: process.env.TIME_ZONE || 'America/New_York',
  anthropicKey: required('ANTHROPIC_API_KEY'),
  openaiKey: required('OPENAI_API_KEY'),
  models: Object.freeze({
    fast: process.env.MODEL_FAST || 'claude-haiku-4-5',
    smart: process.env.MODEL_SMART || 'claude-sonnet-4-6',
    transcribe: process.env.MODEL_TRANSCRIBE || 'gpt-4o-mini-transcribe',
  }),
  mail: Object.freeze({
    transport: mailTransport,
    from: process.env.MAIL_FROM || '',
    outboxDir: process.env.MAIL_OUTBOX_DIR || '/tmp/sitescribe-outbox',
    tenantId: process.env.MS_TENANT_ID || '',
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
  }),
  version: require('../../package.json').version,
});

if (config.mail.transport === 'graph') {
  for (const k of ['from', 'tenantId', 'clientId', 'clientSecret']) {
    if (!config.mail[k]) throw new Error(`MAIL_TRANSPORT=graph requires mail.${k} (see .env.example)`);
  }
}

module.exports = config;
