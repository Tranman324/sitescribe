'use strict';

/**
 * upload: parse multipart/form-data, stage files to disk, normalize fields.
 * Uses busboy for robust multi-file parsing. Returns a submission object the
 * pipeline can consume.
 */

const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const config = require('../config');
const log = require('../logger').child({ mod: 'upload' });
const {
  ValidationError,
  validateSenderEmail,
  validateSenderName,
  validateAudio,
  validatePhotoCount,
} = require('./validator');

function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

function safeExt(filename, fallback) {
  const ext = path.extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext || fallback;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: config.maxPhotos + 2, // audio + photos + buffer
        fileSize: 160 * 1024 * 1024, // 160 MB per file (90 min audio can be 65-90 MB)
      },
    });

    ensureUploadDir();
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const stagedAudio = [];
    const stagedPhotos = [];
    const fields = {};
    const writePromises = [];

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (name, stream, info) => {
      const { filename, mimeType } = info;
      const isPhoto = /^photo(?:_\d+|\[\])?$/.test(name) || name === 'photos';
      const isAudio = name === 'audio';

      if (!isPhoto && !isAudio) {
        stream.resume();
        return;
      }

      const ext = safeExt(filename, isAudio ? '.m4a' : '.jpg');
      const stagedPath = path.join(
        config.uploadDir,
        `${reqId}-${name}-${stagedPhotos.length + stagedAudio.length}${ext}`,
      );

      const ws = fs.createWriteStream(stagedPath);
      stream.pipe(ws);

      const done = new Promise((res, rej) => {
        ws.on('finish', () => {
          const entry = { path: stagedPath, filename: filename || path.basename(stagedPath), mimeType };
          if (isAudio) stagedAudio.push(entry);
          else stagedPhotos.push(entry);
          res();
        });
        ws.on('error', rej);
        stream.on('error', rej);
      });
      writePromises.push(done);
    });

    bb.on('error', reject);
    bb.on('finish', async () => {
      try {
        await Promise.all(writePromises);
        resolve({ reqId, fields, audio: stagedAudio[0], photos: stagedPhotos });
      } catch (err) {
        reject(err);
      }
    });

    req.pipe(bb);
  });
}

function parseRecordedAt(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  // Try ISO-8601 / date string first
  const d1 = new Date(trimmed);
  if (!Number.isNaN(d1.getTime())) return d1;
  // Try numeric unix timestamp (seconds or ms)
  const n = Number(trimmed);
  if (Number.isFinite(n)) {
    const ms = n > 1e12 ? n : n * 1000; // heuristic: 13+ digits = ms, else seconds
    const d2 = new Date(ms);
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  return fallback;
}

async function receiveSubmission(req) {
  const parsed = await parseMultipart(req);

  // Diagnostic: log the shape of what we parsed so bad Shortcut field configs are visible
  log.info('parsed multipart', {
    reqId: parsed.reqId,
    fieldKeys: Object.keys(parsed.fields),
    fieldSizes: Object.fromEntries(
      Object.entries(parsed.fields).map(([k, v]) => [k, typeof v === 'string' ? v.length + ' chars' : 'non-string']),
    ),
    hasAudio: !!parsed.audio,
    audioSize: parsed.audio ? parsed.audio.data?.length || 'streamed' : null,
    photoCount: parsed.photos.length,
  });

  const senderEmail = validateSenderEmail(parsed.fields.sender_email || parsed.fields.sender);
  const senderName = validateSenderName(parsed.fields.sender_name);
  const emphasis = typeof parsed.fields.emphasis === 'string' ? parsed.fields.emphasis.trim() : '';
  validateAudio(parsed.audio);
  validatePhotoCount(parsed.photos);

  const now = new Date();
  const recordedAt = parseRecordedAt(parsed.fields.recorded_at, now);

  const submission = {
    reqId: parsed.reqId,
    senderEmail,
    senderName,
    emphasis,
    audio: parsed.audio,
    photos: parsed.photos,
    receivedAt: recordedAt,
    webhookReceivedAt: now,
  };

  log.info('submission staged', {
    reqId: submission.reqId,
    photoCount: submission.photos.length,
    audioBytes: fs.statSync(submission.audio.path).size,
    recordedAt: recordedAt.toISOString(),
    recordedAtSource: parsed.fields.recorded_at ? 'client' : 'webhook-receipt',
  });

  return submission;
}

module.exports = { receiveSubmission, parseRecordedAt, ValidationError };
