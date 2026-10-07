'use strict';

// Loaded first by every test file: sets a complete, fake environment so config
// validation passes without any real keys, and never touches the network.

const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitescribe-test-'));

Object.assign(process.env, {
  WEBHOOK_TOKEN: 'test-token-0123456789',
  ANTHROPIC_API_KEY: 'test-anthropic',
  OPENAI_API_KEY: 'test-openai',
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  MAIL_TRANSPORT: 'file',
  MAIL_OUTBOX_DIR: path.join(tmp, 'outbox'),
  LOG_LEVEL: 'error',
  TIME_ZONE: 'America/New_York',
});

fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

module.exports = { tmp };
