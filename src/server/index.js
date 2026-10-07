'use strict';

/**
 * server: HTTP entrypoint. Binds to 127.0.0.1:<port>; put a TLS reverse proxy
 * (Caddy, nginx) in front for public traffic.
 */

const http = require('http');
const config = require('../config');
const log = require('../logger').child({ mod: 'server' });
const { dispatch } = require('./routes');

function createServer() {
  return http.createServer((req, res) => {
    const maybe = dispatch(req, res);
    if (maybe && typeof maybe.catch === 'function') maybe.catch((err) => {
      log.error('dispatch unexpected error', { error: err.message });
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      } catch {
        /* socket may be closed */
      }
    });
  });
}

function startServer() {
  const server = createServer();
  server.listen(config.port, '127.0.0.1', () => {
    log.info('listening', {
      host: '127.0.0.1',
      port: config.port,
      version: config.version,
    });
  });

  // Graceful shutdown
  const stop = (signal) => {
    log.info('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  return server;
}

module.exports = { startServer, createServer };
