# SiteScribe

[![ci](https://github.com/Tranman324/sitescribe/actions/workflows/ci.yml/badge.svg)](https://github.com/Tranman324/sitescribe/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Talk through a meeting or a site walk, snap photos of your handwritten notes, and get organized
notes in your inbox shortly after.

An iPhone Shortcut records the audio and photos and posts them to this small Node service. The
service transcribes the audio, reads the handwriting with a vision model, sorts the content into the
right shape (meeting, punch list, field notes, interview, and eight more), and emails the result with
the full transcript attached.

I built it in April 2026 for a construction company's field and office staff, who take notes on paper
and do not want another app. It runs there as an internal service. This repo is a cleaned copy: company names,
endpoints, and credentials are removed, and the history starts fresh.

## What is interesting here

- **Long recordings just work.** `ffprobe` checks size and duration, `ffmpeg` splits losslessly into
  chunks under the transcription API's 25 MB and 20-minute limits. Files whose length can't be read
  (common from phone recorders) are re-encoded first. See `src/transcribe/`.
- **Handwriting comes first.** The notepad photos are treated as the source of truth; the recording
  adds context under each written item instead of replacing it.
- **Twelve note shapes, schema-guided.** A fast model classifies the recording, then a stronger
  model fills that mode's JSON schema, and a plain-text renderer formats it. Saying "this is a punch
  list" in the emphasis field overrides the classifier in code, not in the prompt.
- **The phone never waits.** The service replies `202` right away and processes in the background.
  Failures send the user a short email with a reference ID rather than failing silently.
- **Shortcuts generated from code.** `shortcuts/build_shortcuts.py` builds both iOS Shortcuts
  (home-screen and share-sheet), including an offline queue that saves recordings to iCloud on cellular
  and uploads them later on Wi-Fi.
- **Small and dependency-light.** Two runtime dependencies (`busboy`, `dotenv`). Vendor APIs are called
  with plain `fetch`. No file in `src/` over 200 lines.

## Quick start

Needs Node 20+, `ffmpeg`, and Python 3 (only for building the Shortcuts).

```bash
npm ci
cp .env.example .env      # add your Anthropic and OpenAI keys and a WEBHOOK_TOKEN
npm start                 # listens on 127.0.0.1:3479
```

With the default `MAIL_TRANSPORT=file`, finished notes land in `MAIL_OUTBOX_DIR` instead of being
emailed, so you can try it without a Microsoft 365 tenant:

```bash
curl -s -H "x-auth-token: $WEBHOOK_TOKEN" \
  -F audio=@memo.m4a -F photo_1=@notes.jpg \
  -F sender_email=you@example.com -F sender_name="Your Name" \
  http://127.0.0.1:3479/api/meeting-notes
```

To send real email, set `MAIL_TRANSPORT=graph` and the Entra ID app values in `.env.example`
(the app needs the `Mail.Send` application permission).

## Build the iPhone Shortcuts

```bash
SITESCRIBE_URL=https://notes.example.com/api/meeting-notes \
SITESCRIBE_TOKEN=your-webhook-token \
python3 shortcuts/build_shortcuts.py dist/
```

The output is unsigned. Sign on a Mac with `shortcuts sign -i in.shortcut -o out.shortcut`, then
AirDrop it to the phone. `docs/manual-shortcut-build.md` walks through building them by hand instead.

## Tests

```bash
npm test
```

The suite runs offline with no real keys. It covers auth, rate limiting, upload validation, the
renderer, the email transport, real `ffmpeg` chunking of generated audio, an end-to-end HTTP upload with
the AI APIs stubbed, and the Shortcut builder. CI runs it on Node 20 and 22.

## How it was built

I designed and directed this; most of the code was written by AI coding agents working from my specs
and reviewed by me before it shipped. The Shortcut builder uses an iOS Shortcuts plist generator from
my agent skills (`shortcuts/vendor/`).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data flow, module layout, and security notes.

## License

MIT
