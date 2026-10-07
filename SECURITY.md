# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
GitHub: **Security** tab → **Report a vulnerability**. I aim to reply within 7 days.

## Scope

SiteScribe is a single-tenant webhook. The parts most worth a look:

- `src/server/auth.js`: shared-token check on the `x-auth-token` header (constant-time compare)
- `src/server/rate-limit.js` and the `TRUST_PROXY` handling of `X-Forwarded-For`
- `src/upload/`: multipart limits (file count, size caps) and filename sanitizing

Secrets belong in `.env` (git-ignored). `.env.example` holds names only, never values.
