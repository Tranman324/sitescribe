'use strict';

/**
 * filename: sanitize a subject line into a safe filename for the transcript attachment.
 * Strips filesystem-unsafe characters, collapses whitespace, caps length.
 */

// Commas are stripped too: some mail clients and CLI senders treat them as
// list separators in attachment names.
const UNSAFE = /[/\\:*?"<>|,\x00-\x1f]/g;

function sanitizeSubjectToFilename(subject) {
  if (!subject || typeof subject !== 'string') return 'transcript.txt';
  let out = subject.replace(UNSAFE, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > 150) out = out.slice(0, 150).trim();
  if (!out) out = 'transcript';
  return `${out}.txt`;
}

module.exports = { sanitizeSubjectToFilename };
