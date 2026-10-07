'use strict';

/**
 * pipeline: orchestrates async processing of a staged submission:
 *   transcribe (audio) + ocr (photos) [parallel]
 *     → structureAndRender (classify → structure → render via Claude)
 *     → deliverNote (email: transcript + photos attached)
 *     → cleanup (audio always; transcript + photos managed by email layer)
 *
 * Runs AFTER HTTP 202 is returned to client. Errors caught + logged.
 */

const fs = require('fs');
const config = require('../config');
const { transcribeAudio } = require('../transcribe');
const { ocrPhotos } = require('../ocr');
const { structureAndRender } = require('../structure');
const { deliverNote } = require('../email');
const log = require('../logger').child({ mod: 'pipeline' });

function cleanupFiles(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

async function processSubmission(submission) {
  const started = Date.now();
  const childLog = log.child({ reqId: submission.reqId });
  const photoFiles = submission.photos.map((p) => p.path);

  try {
    childLog.info('pipeline start', {
      photoCount: submission.photos.length,
    });

    // Transcribe + OCR in parallel (photos stay on disk through email send)
    const [transcript, photoNotes] = await Promise.all([
      transcribeAudio(submission.audio.path),
      ocrPhotos(submission.photos),
    ]);

    const { subject, body, mode } = await structureAndRender({
      transcript,
      photoNotes,
      emphasis: submission.emphasis,
      senderName: submission.senderName,
      receivedAt: submission.receivedAt,
    });

    // Pass photoFiles — email layer attaches them and handles their cleanup
    await deliverNote({
      to: submission.senderEmail,
      subject,
      body,
      transcript,
      uploadDir: config.uploadDir,
      photoFiles,
    });

    const ms = Date.now() - started;
    childLog.info('pipeline complete', { ms, mode });
    return { ok: true, subject, mode, durationMs: ms };
  } catch (err) {
    childLog.error('pipeline failed', {
      error: err.message,
      stack: err.stack ? err.stack.split('\n').slice(0, 5).join(' | ') : undefined,
    });
    // Notify sender that processing failed
    try {
      const { sendErrorNotification } = require('../email');
      await sendErrorNotification({
        to: submission.senderEmail,
        error: err.message,
        reqId: submission.reqId,
      });
    } catch (notifyErr) {
      childLog.error('failed to send error notification', { error: notifyErr.message });
    }
    // Pre-email failure: clean up photos (email layer never got them)
    cleanupFiles(photoFiles);
    return { ok: false, error: err.message };
  } finally {
    // Audio is always cleaned up — already transcribed, not needed for recovery
    cleanupFiles([submission.audio.path]);
  }
}

module.exports = { processSubmission };
