'use strict';

/**
 * structure — two-call flow: classify → structure → render.
 *   1. classifyMode   (Haiku) — fast mode detection from transcript snippet
 *   2. structureNote  (Sonnet) — fill the mode's JSON schema
 *   3. generateSubject (Sonnet) — short descriptive subject line
 *   4. renderToPlainText — JSON → email body (via renderer.js)
 *
 * Export: structureAndRender({ transcript, photoNotes, emphasis, senderName, receivedAt })
 *         → { subject, body, mode }
 */

const path = require('path');
const config = require('../config');
const log = require('../logger').child({ mod: 'structure' });
const {
  CLASSIFIER_SYSTEM, SUBJECT_SYSTEM,
  buildClassifierUser, buildSubjectUser,
  buildStructureSystem, buildStructureUser,
} = require('./prompts');
const { renderToPlainText } = require('./renderer');

const API_URL = 'https://api.anthropic.com/v1/messages';
const SCHEMAS_DIR = path.join(__dirname, 'schemas');

// Load all schemas at module init time
const SCHEMA_NAMES = [
  'meeting', 'voice_note', 'presentation', 'interview', 'lecture',
  'one_on_one', 'customer_call', 'brainstorm', 'field_notes',
  'journal', 'unclassified', 'punch_list',
];
const schemas = {};
for (const name of SCHEMA_NAMES) {
  schemas[name] = require(path.join(SCHEMAS_DIR, `${name}.json`));
}

// ─── API helper ──────────────────────────────────────────────────────────────

async function callClaude({ system, user, maxTokens, model }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || config.models.smart,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude call failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

// ─── Step 1: Classify ────────────────────────────────────────────────────────

// Check if emphasis explicitly names a mode — code-level override, not prompt-dependent
function detectModeFromEmphasis(emphasis) {
  if (!emphasis) return null;
  const lower = emphasis.toLowerCase();
  const modeKeywords = {
    meeting: ['meeting', 'group meeting', 'team meeting', 'staff meeting'],
    voice_note: ['voice note', 'voice memo', 'personal note', 'quick note'],
    presentation: ['presentation', 'conference', 'keynote', 'info session', 'lecture', 'webinar', 'training'],
    field_notes: ['field note', 'site visit', 'walkthrough', 'inspection'],
    punch_list: ['punch list', 'punchlist', 'snag list', 'defect list', 'qc walk'],
  };
  for (const [mode, keywords] of Object.entries(modeKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return { mode, confidence: 1.0, reasoning: `User emphasis explicitly named mode: "${emphasis}"` };
    }
  }
  return null;
}

async function classifyMode(transcript, emphasis) {
  // Code-level override: if user explicitly names a mode, trust them
  const override = detectModeFromEmphasis(emphasis);
  if (override) {
    log.info('classified (user override)', override);
    return override;
  }
  const snippet = (transcript || '').slice(0, 2000);
  try {
    const raw = await callClaude({
      system: CLASSIFIER_SYSTEM,
      user: buildClassifierUser(snippet, emphasis),
      maxTokens: 200,
      model: config.models.fast,
    });
    const result = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
    log.info('classified', { mode: result.mode, confidence: result.confidence });
    return { mode: result.mode || 'unclassified', confidence: result.confidence || 0 };
  } catch (err) {
    log.warn('classify failed, defaulting to unclassified', { error: err.message });
    return { mode: 'unclassified', confidence: 0 };
  }
}

// ─── Step 2: Structure ───────────────────────────────────────────────────────

async function structureNote(transcript, photoNotes, emphasis, senderName, mode) {
  const schema = schemas[mode] || schemas.unclassified;
  const raw = await callClaude({
    system: buildStructureSystem(mode, schema),
    user: buildStructureUser({ transcript, photoNotes, emphasis, senderName }),
    maxTokens: 8000,
    model: config.models.smart,
  });
  // Strip accidental markdown fences
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    log.warn('JSON parse failed, attempting repair', { error: parseErr.message });
    // Try truncating to last complete object
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
      try { return JSON.parse(cleaned.slice(0, lastBrace + 1)); } catch { /* fall through */ }
    }
    throw parseErr;
  }
}

// ─── Step 3: Subject ─────────────────────────────────────────────────────────

function formatTimestamp(date) {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: config.timeZone,
  });
}

async function generateSubject({ transcript, photoNotes, emphasis, receivedAt }) {
  try {
    const raw = await callClaude({
      system: SUBJECT_SYSTEM,
      user: buildSubjectUser({ transcript, photoNotes, emphasis }),
      maxTokens: 60,
      model: config.models.smart,
    });
    const subject = raw.replace(/^["'""]+|["'""]+$/g, '').replace(/[.!?]+$/g, '').trim();
    if (!subject || /sitescribe/i.test(subject)) {
      return `Voice note — ${formatTimestamp(receivedAt)}`;
    }
    return `${subject} — ${formatTimestamp(receivedAt)}`;
  } catch (err) {
    log.warn('subject generation failed', { error: err.message });
    return `Voice note — ${formatTimestamp(receivedAt)}`;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

async function structureAndRender({ transcript, photoNotes, emphasis, senderName, receivedAt }) {
  const { mode, confidence } = await classifyMode(transcript, emphasis);
  log.info('structure start', { mode, confidence });

  const [subject, jsonOutput] = await Promise.all([
    generateSubject({ transcript, photoNotes, emphasis, receivedAt }),
    structureNote(transcript, photoNotes, emphasis, senderName, mode).catch((err) => {
      log.error('structureNote failed, using fallback', { error: err.message });
      return { summary: '(structuring failed — see attached transcript)', mode };
    }),
  ]);

  const body = renderToPlainText(mode, jsonOutput);
  log.info('structured', { mode, subjectLen: subject.length, bodyLen: body.length });
  return { subject, body, mode };
}

module.exports = { structureAndRender, generateSubject, formatTimestamp, detectModeFromEmphasis };
