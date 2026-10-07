'use strict';

/**
 * email/file: local-development transport. Writes each message to MAIL_OUTBOX_DIR
 * as a folder (message.txt + attachments) instead of sending it.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

async function sendToOutbox({ to, subject, body, attachPaths = [] }) {
  const dir = path.join(config.mail.outboxDir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'message.txt'), `To: ${to}\nSubject: ${subject}\n\n${body}\n`, 'utf8');
  for (const p of attachPaths) fs.copyFileSync(p, path.join(dir, path.basename(p)));
  return { to, attachments: attachPaths.length, via: 'file', dir };
}

module.exports = { sendToOutbox };
