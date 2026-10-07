'use strict';

/**
 * rate-limit — simple in-memory rate limiter.
 * Tracks requests per IP and rejects above threshold.
 * Resets on service restart (fine for a single-instance, low-traffic service).
 *
 * No external dependencies.
 */

const log = require('../logger').child({ mod: 'rate-limit' });

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_PER_WINDOW = 10;   // 10 requests per IP per minute

class RateLimiter {
  constructor({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_PER_WINDOW } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // ip → { count, resetAt }
  }

  _getOrCreate(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    return entry;
  }

  check(ip) {
    const entry = this._getOrCreate(ip);
    entry.count++;
    if (entry.count > this.max) {
      log.warn('rate limit exceeded', { ip, count: entry.count, max: this.max });
      return false;
    }
    return true;
  }

  // Periodic cleanup to avoid memory leak from abandoned IPs
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now >= entry.resetAt) this.hits.delete(key);
    }
  }
}

const limiter = new RateLimiter({ windowMs: 60_000, max: 10 });

// Cleanup every 5 minutes
setInterval(() => limiter.cleanup(), 5 * 60_000).unref();

module.exports = { limiter, RateLimiter };
