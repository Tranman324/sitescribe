'use strict';

/**
 * ocr — photos → handwritten-notes text via Claude Haiku Vision.
 * Fans out across all supplied photos in parallel; returns a structured
 * per-photo result so the structuring step can preserve them in order.
 *
 * Philosophy: handwritten notes are the PRIMARY record. Capture everything,
 * even low-confidence reads (marked with [?]). Preserve emphasis cues
 * (underlines, stars, circles).
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('../logger').child({ mod: 'ocr' });

const API_URL = 'https://api.anthropic.com/v1/messages';

const OCR_PROMPT = [
  'Read every handwritten note in this image.',
  'Capture every line item, name, number, date, and detail — even scribbles.',
  'If something is underlined, starred, circled, or clearly emphasized, mark it as HIGH PRIORITY.',
  'If handwriting is unclear, make your best guess and append [?] to that token.',
  'Return a plain text list. One note item per line. No commentary, no preamble.',
].join(' ');

function mediaTypeFromExt(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

async function ocrOnePhoto(photo) {
  const imageData = fs.readFileSync(photo.path);
  const base64 = imageData.toString('base64');
  const media_type = mediaTypeFromExt(path.extname(photo.path));

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.models.fast,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: base64 } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude vision failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function ocrPhotos(photos) {
  if (!photos || photos.length === 0) return [];
  log.info('ocr starting', { count: photos.length });
  const results = await Promise.all(
    photos.map(async (photo, idx) => {
      try {
        const text = await ocrOnePhoto(photo);
        return { index: idx + 1, filename: photo.filename, text };
      } catch (err) {
        log.error('ocr-one failed', { filename: photo.filename, error: err.message });
        return { index: idx + 1, filename: photo.filename, text: '', error: err.message };
      }
    }),
  );
  log.info('ocr complete', {
    ok: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
  });
  return results;
}

module.exports = { ocrPhotos };
