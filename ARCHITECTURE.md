# Architecture

SiteScribe receives an upload from an iOS Shortcut (one audio recording plus up to five photos of
handwritten notes), turns it into structured notes, and emails the result back to the sender with the
full transcript attached.

## Principles

- **Handwritten notes are primary.** Photos of a notepad are transcribed in full; audio adds context.
- **Feature folders.** Each module lives in its own folder with a public `index.js`.
- **Small files.** No file in `src/` over 200 lines. Split before crossing it.
- **Direct vendor calls.** Anthropic, OpenAI, and Microsoft Graph are called over plain `fetch`.
  No SDKs, no agent gateway in the request path.
- **Stateless.** Nothing is kept in memory between requests. Temp files are deleted per request.
- **Fail fast on boot.** A missing required variable stops the process before it listens.

## Data flow

```
iOS Shortcut (record audio + photos + optional emphasis text, then POST)
        │
        ▼
┌──────────────────────────────────────────────┐
│ POST /api/meeting-notes                      │
│   rate limit (per IP, sliding window)        │
│   auth (x-auth-token, constant-time compare) │
│   busboy multipart parse → stage to disk     │
│   validate fields / audio / photo cap        │
│   202 Accepted returned immediately          │
└──────────────────────────────────────────────┘
        │ async, after the response
        ▼
┌──────────────────────┐   ┌──────────────────────┐
│ transcribe           │   │ ocr                  │
│ ffprobe/ffmpeg split │   │ Claude vision        │
│ into ≤24 MB, ≤20 min │   │ one call per photo,  │
│ chunks (lossless),   │   │ in parallel          │
│ OpenAI transcription │   │                      │
└──────────┬───────────┘   └──────────┬───────────┘
           └────────────┬─────────────┘
                        ▼
           ┌──────────────────────────┐
           │ structure                │
           │ 1. classify mode (fast)  │
           │ 2. fill mode's JSON      │
           │    schema (smart)        │
           │ 3. subject line (smart)  │
           │ 4. render to plain text  │
           └────────────┬─────────────┘
                        ▼
           ┌──────────────────────────┐
           │ email                    │
           │ Graph sendMail, or local │
           │ outbox in development    │
           │ + transcript .txt        │
           │ + original photos        │
           └────────────┬─────────────┘
                        ▼
                cleanup temp files
```

If any step fails, the sender gets a short failure email with a request ID instead of silence.

## Modes

The classifier picks one of twelve note shapes, each with its own JSON schema in
`src/structure/schemas/`: meeting, voice note, presentation, interview, lecture, one-on-one,
customer call, brainstorm, field notes, punch list, journal, and unclassified. A sender can force a
mode by saying so in the emphasis field ("this is a punch list").

## Modules

- `config/`: load and validate environment; frozen config object.
- `logger/`: dependency-free JSON-lines logger.
- `server/`: HTTP server, routing, token auth, rate limiter.
- `upload/`: multipart parsing, staging to `UPLOAD_DIR`, validation.
- `transcribe/`: probe, repair, and chunk audio; call the transcription API per chunk.
- `ocr/`: vision transcription of note photos.
- `structure/`: mode classification, schema-guided structuring, subject line, plain-text renderer.
- `email/`: transport selection (Graph or file), attachments, retry on transient errors.
- `pipeline/`: orchestration and cleanup.

## HTTP interface

### `GET /health`

```json
{ "status": "ok", "service": "sitescribe", "version": "1.0.0", "uptime_s": 123 }
```

### `POST /api/meeting-notes`

`multipart/form-data` with header `x-auth-token: <WEBHOOK_TOKEN>`.

- `audio` (file, required): any format the transcription API or ffmpeg can read.
- `photo_1`…`photo_5`, `photos`, or `photo[]` (file, optional): up to `MAX_PHOTOS`.
- `sender_email` (string, required): where the notes are sent.
- `sender_name` (string, required): used in the structured output.
- `emphasis` (string, optional): free text passed to the model ("focus on schedule changes").
- `recorded_at` (string, optional): ISO-8601 or Unix time; defaults to receipt time.

Responses: `202` accepted, `400` validation failure, `401` bad token, `429` rate limited,
`500` upload error.

## Security notes

- The token is checked only from the header (query strings end up in proxy logs) and compared in
  constant time.
- `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, so clients cannot rotate it to dodge the
  rate limiter.
- Uploaded audio is deleted after transcription. Photos and the transcript file are deleted after the
  email is sent.
- Any holder of the token can make the service send email to an arbitrary address. Treat the token as
  a credential and rotate it if a shortcut leaks.

## Scale

Single process, single instance. The request path is already ack-then-process, so a durable queue
(for example a SQLite job table) can replace the in-process hand-off if volume grows. In-flight work is
lost on restart, which is acceptable at a handful of notes per day.

## Deployment

See `deploy/` for an example systemd unit and Caddy reverse-proxy block.
