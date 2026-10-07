'use strict';

// End-to-end: real HTTP server, real multipart upload, real ffmpeg, file mail transport.
// Only the two AI vendor APIs are stubbed (global fetch), so this runs offline with no keys.

const { tmp } = require('./_env');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const realFetch = global.fetch;
const calls = [];

function stubFetch(url, opts = {}) {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  calls.push(u);
  const json = (obj) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }));
  if (u.includes('api.openai.com')) {
    return json({ text: 'Okay team, we agreed to move the pour to Friday. Sam will call the supplier.' });
  }
  if (u.includes('api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    const isVision = Array.isArray(body.messages[0].content);
    if (isVision) return json({ content: [{ text: 'Pour -> Friday\nSam: supplier' }] });
    if (body.max_tokens === 60) return json({ content: [{ text: 'Pour date moved to Friday' }] });
    if (body.max_tokens === 200) return json({ content: [{ text: '{"mode":"meeting","confidence":0.9}' }] });
    return json({ content: [{ text: JSON.stringify({
      summary: 'Schedule review. Pour moved because of rain.',
      decisions: [{ decision: 'Move pour to Friday', context: 'rain forecast' }],
      action_items: [{ owner: 'Sam', task: 'Call the concrete supplier' }],
    }) }] });
  }
  return Promise.reject(new Error(`unexpected fetch ${u}`));
}

async function waitFor(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

describe('POST /api/meeting-notes', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, () => {
  let server;
  let base;
  const audio = path.join(tmp, 'memo.m4a');
  const photo = path.join(tmp, 'notes.jpg');

  before(async () => {
    global.fetch = stubFetch;
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'aac', audio], { stdio: 'ignore' });
    fs.writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal JPEG markers
    const { createServer } = require('../src/server');
    server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    global.fetch = realFetch;
    server.close();
  });

  function form() {
    const fd = new FormData();
    fd.append('sender_email', 'pat@example.com');
    fd.append('sender_name', 'Pat Lee');
    fd.append('emphasis', 'focus on schedule changes');
    fd.append('audio', new Blob([fs.readFileSync(audio)]), 'memo.m4a');
    fd.append('photo_1', new Blob([fs.readFileSync(photo)]), 'notes.jpg');
    return fd;
  }

  it('health endpoint responds without auth', async () => {
    const res = await realFetch(`${base}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).service, 'sitescribe');
  });

  it('rejects uploads without a valid token', async () => {
    const res = await realFetch(`${base}/api/meeting-notes`, { method: 'POST', body: form() });
    assert.strictEqual(res.status, 401);
  });

  it('rejects uploads with no audio', async () => {
    const fd = new FormData();
    fd.append('sender_email', 'pat@example.com');
    fd.append('sender_name', 'Pat Lee');
    const res = await realFetch(`${base}/api/meeting-notes`, {
      method: 'POST', body: fd, headers: { 'x-auth-token': process.env.WEBHOOK_TOKEN },
    });
    assert.strictEqual(res.status, 400);
  });

  it('accepts, processes, and emails structured notes with attachments', async () => {
    const res = await realFetch(`${base}/api/meeting-notes`, {
      method: 'POST', body: form(), headers: { 'x-auth-token': process.env.WEBHOOK_TOKEN },
    });
    assert.strictEqual(res.status, 202);

    const outbox = process.env.MAIL_OUTBOX_DIR;
    const msgDir = await waitFor(() => fs.existsSync(outbox) && fs.readdirSync(outbox)[0]);
    const dir = path.join(outbox, msgDir);
    const message = await waitFor(() => fs.existsSync(path.join(dir, 'message.txt'))
      && fs.readFileSync(path.join(dir, 'message.txt'), 'utf8'));

    assert.match(message, /^To: pat@example\.com/m);
    assert.match(message, /^Subject: Pour date moved to Friday/m);
    assert.match(message, /DECISIONS\n- Move pour to Friday/);
    assert.match(message, /Sam → Call the concrete supplier/);

    const files = fs.readdirSync(dir);
    assert.ok(files.some((f) => f.endsWith('.txt') && f !== 'message.txt'), 'transcript attached');
    assert.ok(files.includes('notes.jpg') || files.some((f) => f.endsWith('.jpg')), 'photo attached');

    assert.ok(calls.some((u) => u.includes('openai')), 'transcription called');
    assert.ok(calls.filter((u) => u.includes('anthropic')).length >= 3, 'ocr + classify + structure + subject');

    // Uploaded audio is deleted after processing.
    await waitFor(() => !fs.readdirSync(process.env.UPLOAD_DIR).some((f) => f.endsWith('.m4a')));
  });
});
