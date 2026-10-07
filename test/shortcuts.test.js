'use strict';

// Builds both iOS Shortcuts with a fake URL/token and checks the plist output.
// Skips cleanly if python3 is not installed.

const { tmp } = require('./_env');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function hasPython() {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const ROOT = path.join(__dirname, '..');
const BUILDER = path.join(ROOT, 'shortcuts', 'build_shortcuts.py');

describe('shortcut builder', { skip: !hasPython() && 'python3 not installed' }, () => {
  it('refuses to build without URL and token', () => {
    const r = spawnSync('python3', [BUILDER, tmp], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /SITESCRIBE_URL/);
  });

  it('builds both shortcuts with the configured endpoint and token', () => {
    const out = path.join(tmp, 'shortcuts');
    execFileSync('python3', [BUILDER, out], {
      env: { PATH: process.env.PATH, SITESCRIBE_URL: 'https://notes.example.com/api/meeting-notes', SITESCRIBE_TOKEN: 'fake-token-123' },
      stdio: 'ignore',
    });
    const check = `
import plistlib, sys, json
res = {}
for name in ["SiteScribe.shortcut", "SiteScribe-Share.shortcut"]:
    raw = open(sys.argv[1] + "/" + name, "rb").read()
    p = plistlib.loads(raw)
    ids = [a["WFWorkflowActionIdentifier"] for a in p["WFWorkflowActions"]]
    res[name] = {
        "actions": len(ids),
        "posts": sum(1 for a in p["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl"),
        "share": "ActionExtension" in p.get("WFWorkflowTypes", []),
        "url": b"notes.example.com" in raw,
        "token": b"fake-token-123" in raw,
    }
print(json.dumps(res))`;
    const res = JSON.parse(execFileSync('python3', ['-c', check, out], { encoding: 'utf8' }));
    const main = res['SiteScribe.shortcut'];
    const share = res['SiteScribe-Share.shortcut'];
    assert.ok(main.actions > 20 && share.actions > 20);
    assert.ok(main.posts >= 1 && share.posts >= 1, 'each shortcut uploads');
    assert.strictEqual(main.share, false);
    assert.strictEqual(share.share, true, 'share variant appears in the share sheet');
    for (const r of [main, share]) { assert.ok(r.url); assert.ok(r.token); }
  });
});
