#!/usr/bin/env node
'use strict';

/**
 * SiteScribe: entry point.
 * Loads config (which validates env), then starts the HTTP server.
 */

require('./config'); // eager-load so we fail fast on missing env
const log = require('./logger');
const { startServer } = require('./server');

try {
  startServer();
} catch (err) {
  log.error('boot failed', { error: err.message, stack: err.stack });
  process.exit(1);
}

// Unhandled failure guards — keep the service alive, log loudly
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { error: err.message, stack: err.stack });
});
