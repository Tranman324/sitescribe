'use strict';

/**
 * email: deliver structured note + transcript + photo attachments.
 * Transport is chosen by MAIL_TRANSPORT: "graph" (Microsoft Graph) or "file" (local outbox).
 * Retries transient errors. Cleans up files only after a successful send.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { sanitizeSubjectToFilename } = require('./filename');
const { FOOTER } = require('../structure/renderer');
const log = require('../logger').child({ mod: 'email' });

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const TRANSIENT = /5\d\d|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i;

function transport() {
  if (config.mail.transport === 'graph') return require('./graph').sendViaGraph;
  return require('./file').sendToOutbox;
}

function writeTranscriptFile({ uploadDir, subject, transcript }) {
  const filePath = path.join(uploadDir, sanitizeSubjectToFilename(subject));
  fs.writeFileSync(filePath, transcript || '', 'utf8');
  return filePath;
}

function cleanupFiles(paths) {
  for (const p of paths) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendWithRetry(msg, { send = transport(), baseDelayMs = BASE_DELAY_MS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try { return await send(msg); } catch (err) {
      lastErr = err;
      if (!TRANSIENT.test(err.message) || attempt === MAX_RETRIES) throw err;
      const d = baseDelayMs * Math.pow(2, attempt - 1);
      log.warn('send retry', { attempt, delayMs: d, error: err.message });
      await sleep(d);
    }
  }
  throw lastErr;
}

async function deliverNote({ to, subject, body, transcript, uploadDir, photoFiles = [] }) {
  const transcriptPath = writeTranscriptFile({ uploadDir, subject, transcript });
  const attachPaths = [transcriptPath, ...photoFiles].filter(Boolean);
  let emailOk = false;
  try {
    const result = await sendWithRetry({ to, subject, body, attachPaths });
    emailOk = true;
    log.info('email sent', { via: result.via, subjectLen: subject.length, attachments: attachPaths.length });
    return { ok: true, transcriptPath };
  } finally {
    if (emailOk) cleanupFiles(attachPaths);
    else log.warn('keeping files after email failure', { count: attachPaths.length });
  }
}

async function sendErrorNotification({ to, error, reqId }) {
  const subject = 'SiteScribe: processing failed';
  const body = `⚠️ Your SiteScribe recording could not be processed.\n\nError: ${error}\nReference: ${reqId}\n\nTry submitting again. If the problem persists, contact your administrator.\n${FOOTER}`;
  await sendWithRetry({ to, subject, body, attachPaths: [] });
  log.info('error notification sent', { reqId });
}

module.exports = { deliverNote, sendErrorNotification, writeTranscriptFile, sendWithRetry, sanitizeSubjectToFilename };
