'use strict';

/**
 * logger — tiny structured JSON logger. Writes one JSON object per line to stdout.
 * Shape: { ts, level, msg, ...fields }
 * No dependencies. Swappable for pino/winston later if needed.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[envLevel] ?? LEVELS.info;

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields && typeof fields === 'object' ? fields : {}),
  };
  try {
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch {
    // Fallback for unserializable fields
    process.stdout.write(JSON.stringify({ ts: record.ts, level, msg, err: 'log-serialize-failed' }) + '\n');
  }
}

function child(bindings = {}) {
  return {
    debug: (msg, f) => emit('debug', msg, { ...bindings, ...f }),
    info: (msg, f) => emit('info', msg, { ...bindings, ...f }),
    warn: (msg, f) => emit('warn', msg, { ...bindings, ...f }),
    error: (msg, f) => emit('error', msg, { ...bindings, ...f }),
    child: (more) => child({ ...bindings, ...more }),
  };
}

module.exports = child({ service: 'sitescribe' });
module.exports.child = child;
