'use strict';

/**
 * Renders examples/field-notes.sample.json into the email SiteScribe would send, using the real
 * renderer and the same layout as the local file transport. The input is invented; no API calls.
 *
 *   node examples/render-sample.js > examples/sample-email.txt
 */

const path = require('path');
const { renderToPlainText } = require('../src/structure/renderer');
const { sanitizeSubjectToFilename } = require('../src/email/filename');

function renderSampleEmail(sample = require(path.join(__dirname, 'field-notes.sample.json'))) {
  const body = renderToPlainText(sample.mode, sample.structured);
  const files = [sanitizeSubjectToFilename(sample.subject), ...sample.attachments];
  const attached = files.map((a) => `  - ${a}`).join('\n');
  return `To: ${sample.to}\nSubject: ${sample.subject}\nAttachments:\n${attached}\n\n${body}\n`;
}

if (require.main === module) process.stdout.write(renderSampleEmail());

module.exports = { renderSampleEmail };
