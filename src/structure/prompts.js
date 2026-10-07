'use strict';

/**
 * prompts — classifier + structurer + subject prompt builders.
 * No API calls here — pure prompt construction only.
 */

const ACTIVE_MODES = ['meeting', 'voice_note', 'presentation', 'field_notes', 'punch_list', 'unclassified'];

const CLASSIFIER_SYSTEM = [
  'You are an audio content classifier.',
  `Classify the transcript into exactly one of: ${ACTIVE_MODES.join(', ')}.`,
  'Signals — meeting: multi-speaker, agenda, decisions, action items;',
  'voice_note: solo thinking/rambling, no clear agenda;',
  'presentation: one primary speaker informing/teaching an audience, linear structure, lectures, vendor pitches, conference talks, info sessions, training;',
  'field_notes: site visit, observations, measurements, narrating what you see;',
  'punch_list: itemized defect/issue list, trades, severities, walkthrough format;',
  'unclassified: low confidence, mixed, too short, or unclear.',
  'If SENDER EMPHASIS explicitly names a mode ("this was a meeting", "this is a presentation", etc.), that OVERRIDES transcript analysis. Trust the user over your inference.',
  'Output ONLY valid JSON — no markdown fences, no extra text:',
  '{ "mode": "<mode>", "confidence": 0.0, "reasoning": "<brief>" }',
].join(' ');

function buildClassifierUser(transcriptSnippet, emphasis) {
  let out = `TRANSCRIPT SNIPPET (first 2000 chars):\n${transcriptSnippet || '(empty)'}`;
  if (emphasis) out += `\n\nSENDER EMPHASIS: ${emphasis}`;
  out += '\n\nClassify. Output JSON only.';
  return out;
}

const SUBJECT_SYSTEM = [
  'Generate a concise, descriptive subject line for a voice note.',
  'Output ONLY the subject line — no quotes, no prefix, no trailing punctuation.',
  'Do not include "SiteScribe". Aim for 4-10 words.',
  'Examples: "Q3 planning thoughts", "Kitchen reno punch list", "Vendor call follow-up",',
  '"Site walkthrough Unit 4B", "Grocery and errands reminder". Fallback: "Voice note".',
].join(' ');

function buildSubjectUser({ transcript, photoNotes, emphasis }) {
  const parts = [];
  if (photoNotes && photoNotes.length > 0) {
    const notesText = photoNotes.map((p) => p.text || '').join('\n').slice(0, 1500);
    if (notesText.trim()) parts.push(`HANDWRITTEN NOTES:\n${notesText}`);
  }
  if (transcript) parts.push(`TRANSCRIPT (first 800 chars):\n${transcript.slice(0, 800)}`);
  if (emphasis) parts.push(`SENDER EMPHASIS: ${emphasis}`);
  parts.push('\nOutput: single subject line, 4-10 words. No quotes, no "SiteScribe", no timestamp.');
  return parts.join('\n\n');
}

function buildStructureSystem(mode, schema) {
  const schemaStr = JSON.stringify(schema, null, 2);
  return [
    'You are SiteScribe, a structured audio note assistant.',
    `Mode: ${mode}.`,
    '',
    'CRITICAL RULES:',
    '1. SENDER EMPHASIS is the PRIMARY LENS. If present, lead with it, go deepest on it. All other content is secondary.',
    '2. Handwritten photo notes are the PRIMARY record. Audio transcript is supplementary — layer context onto notes.',
    '3. Best-effort speaker inference from name mentions, self-references, turn-taking. When listing participants or attributing statements, mark names with "(best guess)" unless you are highly confident. Leave fields blank when not confident at all. Do not fabricate names.',
    '4. Output ONLY valid JSON matching the schema exactly. No markdown fences, no commentary, no extra fields.',
    '5. Follow the _instructions field in the schema.',
    '6. BE CONCISE. Target 2000-4000 characters total output. Summarize, don\'t transcribe. Key points as short bullets, not paragraphs. Details belong in the attached transcript, not the summary. Every sentence must earn its place.',
    '',
    'SCHEMA TO FILL:',
    schemaStr,
  ].join('\n');
}

function buildStructureUser({ transcript, photoNotes, emphasis, senderName }) {
  const hasNotes = photoNotes && photoNotes.length > 0
    && photoNotes.some((p) => p.text && p.text.trim());
  let out = '';

  if (hasNotes) {
    out += 'HANDWRITTEN NOTES (PRIMARY — capture 100%):\n';
    for (const p of photoNotes) {
      out += `\n[Photo ${p.index}${p.filename ? ' — ' + p.filename : ''}]\n`;
      out += (p.text && p.text.trim()) || '(no legible text)';
      out += '\n';
    }
    out += '\nAUDIO TRANSCRIPT (supplementary — layer context onto notes above):\n';
  } else {
    out += 'AUDIO TRANSCRIPT:\n';
  }
  out += transcript || '(empty)';

  if (emphasis) {
    out += `\n\n⚡ SENDER EMPHASIS (PRIMARY LENS — lead with and go deepest on this):\n${emphasis}`;
  }
  if (senderName) out += `\n\nSubmitted by: ${senderName}`;
  out += '\n\nFill the JSON schema exactly. No markdown fences. No extra fields.';
  return out;
}

module.exports = {
  ACTIVE_MODES,
  CLASSIFIER_SYSTEM,
  SUBJECT_SYSTEM,
  buildClassifierUser,
  buildSubjectUser,
  buildStructureSystem,
  buildStructureUser,
};
