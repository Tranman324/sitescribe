'use strict';

/**
 * email/graph: send mail through Microsoft Graph with app-only (client credentials) auth.
 * Requires an Entra ID app registration with the Mail.Send application permission,
 * ideally scoped to one mailbox with an application access policy.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const { tenantId, clientId, clientSecret } = config.mail;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Graph token failed (${res.status})`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

function toAttachment(filePath) {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: path.basename(filePath),
    contentBytes: fs.readFileSync(filePath).toString('base64'),
  };
}

async function sendViaGraph({ to, subject, body, attachPaths = [] }) {
  const token = await getToken();
  const message = {
    subject,
    body: { contentType: 'Text', content: body },
    toRecipients: [{ emailAddress: { address: to } }],
    attachments: attachPaths.map(toAttachment),
  };
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(config.mail.from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${err.slice(0, 300)}`);
  }
  return { to, attachments: attachPaths.length, via: 'graph' };
}

module.exports = { sendViaGraph };
