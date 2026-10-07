'use strict';

/**
 * transcribe: audio → text via the OpenAI transcription API (model set by MODEL_TRANSCRIBE).
 * Direct API call with no proxy layer, so a gateway outage cannot block transcription.
 *
 * Handles large files by lossless chunking via ffmpeg (-c copy) to keep each
 * chunk under Whisper's 25 MB limit. No quality degradation.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const log = require('../logger').child({ mod: 'transcribe' });

const WHISPER_MODEL = config.models.transcribe;
const API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_CHUNK_BYTES = 24 * 1024 * 1024; // 24 MB safety margin under 25 MB limit
const MAX_CHUNK_DURATION_SEC = 20 * 60; // 20 min per chunk — gpt-4o-mini-transcribe token limit
const MAX_DURATION_SEC = 90 * 60; // 90 minutes hard cap
const SUPPORTED_EXT = new Set(['.mp3', '.wav', '.m4a', '.webm', '.mp4', '.ogg', '.flac', '.mpeg', '.mpga']);

// ── Duration + size helpers ──────────────────────────────────────────────────

function getAudioDuration(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    return parseFloat(out.toString().trim()) || 0;
  } catch {
    return 0; // if ffprobe fails, let Whisper try anyway
  }
}

function maybeConvertToSupported(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (SUPPORTED_EXT.has(ext)) return inputPath;
  const wavPath = inputPath + '.wav';
  execFileSync('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath], { stdio: 'pipe' });
  log.info('converted to wav', { from: ext });
  return wavPath;
}

// ── Lossless chunking ────────────────────────────────────────────────────────

function chunkAudio(inputPath) {
  const sizeBytes = fs.statSync(inputPath).size;
  const duration = getAudioDuration(inputPath);

  // Chunk if EITHER size exceeds limit OR duration exceeds per-chunk limit
  const needsChunkBySize = sizeBytes > MAX_CHUNK_BYTES;
  const needsChunkByDuration = duration > MAX_CHUNK_DURATION_SEC;
  if (!needsChunkBySize && !needsChunkByDuration) return [inputPath];

  if (duration <= 0) {
    // Can't get duration (possibly truncated file). Re-encode to fix container, then retry.
    log.warn('ffprobe returned 0 duration, attempting re-encode to fix container', { sizeBytes });
    const fixedPath = inputPath + '.fixed.m4a';
    try {
      execFileSync('ffmpeg', ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '64k', '-vn', fixedPath], { stdio: 'pipe' });
      const fixedDuration = getAudioDuration(fixedPath);
      if (fixedDuration > 0) {
        // Replace original with fixed version and continue with chunking
        fs.renameSync(fixedPath, inputPath);
        return chunkAudio(inputPath); // recurse with fixed file
      }
    } catch { /* re-encode failed, send as-is */ }
    try { fs.unlinkSync(fixedPath); } catch { /* ignore */ }
    return [inputPath];
  }

  // Take the stricter constraint: size-based or duration-based chunk count
  const chunksBySize = Math.ceil(sizeBytes / MAX_CHUNK_BYTES);
  const chunksByDuration = Math.ceil(duration / MAX_CHUNK_DURATION_SEC);
  const chunkCount = Math.max(chunksBySize, chunksByDuration);
  const chunkSec = Math.floor(duration / chunkCount);
  const ext = path.extname(inputPath) || '.m4a';

  log.info('chunking audio', { sizeBytes, duration, chunkCount, chunkSec });

  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSec;
    const out = inputPath + `.chunk${i}${ext}`;
    try {
      execFileSync('ffmpeg', [
        '-y', '-i', inputPath,
        '-ss', String(start),
        '-t', String(chunkSec + 2), // 2s overlap to avoid lost words at boundaries
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        out,
      ], { stdio: 'pipe' });
      chunks.push(out);
    } catch (err) {
      log.warn('chunk failed, skipping', { chunk: i, error: err.message });
    }
  }
  return chunks.length > 0 ? chunks : [inputPath];
}

// ── Whisper API call ─────────────────────────────────────────────────────────

function buildMultipart(fileData, filename) {
  const boundary = 'sitescribe-' + Date.now().toString(36);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n${WHISPER_MODEL}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, fileData, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function transcribeChunk(chunkPath) {
  const fileData = fs.readFileSync(chunkPath);
  const filename = path.basename(chunkPath);
  const { body, contentType } = buildMultipart(fileData, filename);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': contentType },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.text || '';
}

// ── Public API ───────────────────────────────────────────────────────────────

async function transcribeAudio(audioPath) {
  // Duration cap
  const duration = getAudioDuration(audioPath);
  if (duration > MAX_DURATION_SEC) {
    throw new Error(`Recording too long: ${Math.round(duration / 60)} min (max ${MAX_DURATION_SEC / 60} min)`);
  }

  const inputPath = maybeConvertToSupported(audioPath);
  const chunks = chunkAudio(inputPath);

  if (chunks.length === 1) {
    const text = await transcribeChunk(chunks[0]);
    log.info('transcribed', { chars: text.length, chunks: 1 });
    return text;
  }

  // Transcribe chunks sequentially (preserves order, avoids rate-limit slam)
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = await transcribeChunk(chunks[i]);
    parts.push(text);
    log.info('chunk transcribed', { chunk: i + 1, of: chunks.length, chars: text.length });
  }

  // Cleanup chunk temp files
  for (const c of chunks) {
    if (c !== inputPath) try { fs.unlinkSync(c); } catch { /* ignore */ }
  }

  const full = parts.join('\n');
  log.info('transcribed', { chars: full.length, chunks: chunks.length });
  return full;
}

module.exports = { transcribeAudio, getAudioDuration, chunkAudio, MAX_DURATION_SEC, MAX_CHUNK_DURATION_SEC };
