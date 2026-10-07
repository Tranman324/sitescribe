'use strict';

require('./_env');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { sanitizeSubjectToFilename } = require('../src/email/filename');
const { renderToPlainText, FOOTER } = require('../src/structure/renderer');
const { detectModeFromEmphasis, formatTimestamp } = require('../src/structure');
const prompts = require('../src/structure/prompts');
const { parseRecordedAt } = require('../src/upload');
const {
  validateSenderEmail, validateSenderName, validatePhotoCount, ValidationError,
} = require('../src/upload/validator');
const { checkToken } = require('../src/server/auth');
const { RateLimiter } = require('../src/server/rate-limit');

describe('validator', () => {
  it('rejects missing or malformed email', () => {
    assert.throws(() => validateSenderEmail(''), ValidationError);
    assert.throws(() => validateSenderEmail(null), ValidationError);
    assert.throws(() => validateSenderEmail('not-an-email'), ValidationError);
    assert.throws(() => validateSenderEmail('a@b'), ValidationError);
  });
  it('normalizes email to lowercase and trims', () => {
    assert.strictEqual(validateSenderEmail('  Pat.Lee@Example.COM '), 'pat.lee@example.com');
  });
  it('requires a non-blank sender name and trims it', () => {
    assert.throws(() => validateSenderName('   '), ValidationError);
    assert.strictEqual(validateSenderName('  Pat Lee  '), 'Pat Lee');
  });
  it('caps photo count', () => {
    assert.doesNotThrow(() => validatePhotoCount(new Array(5).fill({})));
    assert.throws(() => validatePhotoCount(new Array(6).fill({})), ValidationError);
  });
});

describe('auth', () => {
  const req = (h) => ({ headers: h });
  it('accepts the exact header token', () => {
    assert.strictEqual(checkToken(req({ 'x-auth-token': 'test-token-0123456789' })), true);
  });
  it('rejects wrong, missing, and length-mismatched tokens', () => {
    assert.strictEqual(checkToken(req({ 'x-auth-token': 'test-token-0123456780' })), false);
    assert.strictEqual(checkToken(req({ 'x-auth-token': 'short' })), false);
    assert.strictEqual(checkToken(req({})), false);
  });
});

describe('rate limiter', () => {
  it('allows max requests per window then rejects', () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 3 });
    assert.deepStrictEqual([1, 2, 3, 4].map(() => rl.check('1.2.3.4')), [true, true, true, false]);
    assert.strictEqual(rl.check('5.6.7.8'), true, 'limits are per client');
  });
  it('resets after the window', () => {
    const rl = new RateLimiter({ windowMs: 1, max: 1 });
    rl.check('ip');
    const until = Date.now() + 5;
    while (Date.now() < until) { /* spin */ }
    assert.strictEqual(rl.check('ip'), true);
  });
});

describe('clientIp', () => {
  const { clientIp } = require('../src/server/routes');
  const req = { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  it('ignores X-Forwarded-For unless TRUST_PROXY is set', () => {
    assert.strictEqual(clientIp(req), '127.0.0.1');
  });
  it('uses the first forwarded address behind a trusted proxy', () => {
    assert.strictEqual(clientIp(req, true), '9.9.9.9');
  });
});

describe('sanitizeSubjectToFilename', () => {
  it('produces a safe .txt name', () => {
    const out = sanitizeSubjectToFilename('Site walk: Unit 4B / punch, list?');
    assert.match(out, /\.txt$/);
    assert.doesNotMatch(out, /[/:,?]/);
  });
  it('caps length and handles empty input', () => {
    assert.ok(sanitizeSubjectToFilename('A'.repeat(300)).length <= 154);
    assert.strictEqual(sanitizeSubjectToFilename(''), 'transcript.txt');
    assert.strictEqual(sanitizeSubjectToFilename(null), 'transcript.txt');
  });
});

describe('parseRecordedAt', () => {
  const fallback = new Date('2026-01-01T00:00:00Z');
  it('parses ISO strings and unix seconds/ms', () => {
    assert.strictEqual(parseRecordedAt('2026-03-04T15:00:00Z', fallback).toISOString(), '2026-03-04T15:00:00.000Z');
    assert.strictEqual(parseRecordedAt('1772636400', fallback).toISOString(), '2026-03-04T15:00:00.000Z');
    assert.strictEqual(parseRecordedAt('1772636400000', fallback).toISOString(), '2026-03-04T15:00:00.000Z');
  });
  it('falls back on junk', () => {
    assert.strictEqual(parseRecordedAt('', fallback), fallback);
    assert.strictEqual(parseRecordedAt('yesterday-ish', fallback), fallback);
  });
});

describe('mode override from sender emphasis', () => {
  it('maps explicit phrases to modes', () => {
    assert.strictEqual(detectModeFromEmphasis('This was a team meeting').mode, 'meeting');
    assert.strictEqual(detectModeFromEmphasis('Punch list for level 2').mode, 'punch_list');
    assert.strictEqual(detectModeFromEmphasis('site visit at the north lot').mode, 'field_notes');
  });
  it('returns null when nothing is named', () => {
    assert.strictEqual(detectModeFromEmphasis('focus on the budget numbers'), null);
    assert.strictEqual(detectModeFromEmphasis(''), null);
  });
});

describe('prompts', () => {
  it('classifier lists every active mode', () => {
    for (const m of prompts.ACTIVE_MODES) assert.ok(prompts.CLASSIFIER_SYSTEM.includes(m));
  });
  it('structure prompt puts handwritten notes first and emphasis last', () => {
    const u = prompts.buildStructureUser({
      transcript: 'audio words',
      photoNotes: [{ index: 1, filename: 'p.jpg', text: 'written words' }],
      emphasis: 'budget',
      senderName: 'Pat',
    });
    assert.ok(u.indexOf('HANDWRITTEN NOTES') < u.indexOf('AUDIO TRANSCRIPT'));
    assert.ok(u.indexOf('AUDIO TRANSCRIPT') < u.indexOf('SENDER EMPHASIS'));
  });
  it('omits the notes section when OCR found nothing', () => {
    const u = prompts.buildStructureUser({ transcript: 't', photoNotes: [{ index: 1, text: '  ' }] });
    assert.ok(!u.includes('HANDWRITTEN NOTES'));
  });
});

describe('renderer', () => {
  it('renders meeting sections and skips empty ones', () => {
    const out = renderToPlainText('meeting', {
      summary: 'Reviewed schedule. Agreed to move pour date.',
      decisions: [{ decision: 'Move pour to Friday', context: 'rain forecast' }],
      action_items: [{ owner: 'Sam', task: 'Call the concrete supplier', due_date: 'Wed' }],
      open_questions: [],
    });
    assert.match(out, /DECISIONS/);
    assert.match(out, /Sam → Call the concrete supplier → Wed/);
    assert.doesNotMatch(out, /OPEN QUESTIONS/);
    assert.ok(out.endsWith(FOOTER));
  });
  it('never throws on malformed model output', () => {
    const out = renderToPlainText('meeting', { topics: 'not-an-array', summary: 'x' });
    assert.ok(typeof out === 'string' && out.length > 0);
  });
  it('falls back to generic rendering for unknown modes', () => {
    assert.ok(renderToPlainText('interview', { summary: 'hello' }).includes('hello'));
  });
});

describe('formatTimestamp', () => {
  it('formats in the configured time zone', () => {
    assert.strictEqual(formatTimestamp(new Date('2026-03-04T20:00:00Z')), 'Mar 4, 2026, 3:00 PM');
  });
});
