'use strict';

// Exercises the real ffmpeg/ffprobe chunking path with a generated tone.
// Skips cleanly if ffmpeg is not installed.

const { tmp } = require('./_env');
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getAudioDuration, chunkAudio, MAX_CHUNK_DURATION_SEC } = require('../src/transcribe');

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function makeTone(file, seconds) {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-ac', '1', '-ar', '8000', '-c:a', 'aac', '-b:a', '16k', file,
  ], { stdio: 'ignore' });
}

describe('transcribe: audio chunking', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, () => {
  const dir = path.join(tmp, 'audio');
  before(() => fs.mkdirSync(dir, { recursive: true }));

  it('reads duration with ffprobe', () => {
    const f = path.join(dir, 'short.m4a');
    makeTone(f, 3);
    assert.ok(Math.abs(getAudioDuration(f) - 3) < 0.5);
  });

  it('leaves short recordings as a single chunk', () => {
    const f = path.join(dir, 'single.m4a');
    makeTone(f, 5);
    assert.deepStrictEqual(chunkAudio(f), [f]);
  });

  it('splits recordings longer than the per-chunk limit, losslessly', () => {
    const f = path.join(dir, 'long.m4a');
    const seconds = MAX_CHUNK_DURATION_SEC + 120; // just over one chunk
    makeTone(f, seconds);
    const chunks = chunkAudio(f);
    assert.strictEqual(chunks.length, 2);
    const total = chunks.reduce((s, c) => s + getAudioDuration(c), 0);
    // Each chunk carries a 2 s overlap so words at the seam are not lost.
    assert.ok(total >= seconds - 2, `chunks cover the recording (${total}s of ${seconds}s)`);
  });

  it('reports 0 for an unreadable file instead of throwing', () => {
    const f = path.join(dir, 'garbage.m4a');
    fs.writeFileSync(f, 'not audio');
    assert.strictEqual(getAudioDuration(f), 0);
  });
});
