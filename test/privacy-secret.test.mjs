// 周报产物密钥兜底：digest/report/log 中的 Bearer / sk- 都必须被替换。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-secret-'));
const weekly = path.join(root, 'weekly');
const logs = path.join(root, 'logs');
fs.mkdirSync(weekly, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
const fakeKey = 'as_sk_' + 'A'.repeat(24);
const fakeSk = 'sk-' + 'B'.repeat(24);
fs.writeFileSync(path.join(weekly, 'digest.json'), JSON.stringify({ sessions: [{ id: 's1', title: 'Demo', userMessages: ['Bearer ' + fakeKey, 'key=' + fakeSk] }] }));
fs.writeFileSync(path.join(weekly, 'latest.md'), '# report\n\nBearer ' + fakeKey + '\n');
fs.writeFileSync(path.join(logs, 'run.log'), 'token ' + fakeSk + '\n');
const script = path.join(process.cwd(), 'pipeline', 'privacy-scrub.mjs');
const r = spawnSync(process.execPath, [script, '--secrets-only'], { env: { ...process.env, DSH_LEARNING: root }, encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr);
const report = fs.readFileSync(path.join(weekly, 'latest.md'), 'utf8');
const digest = fs.readFileSync(path.join(weekly, 'digest.json'), 'utf8');
const log = fs.readFileSync(path.join(logs, 'run.log'), 'utf8');
assert.ok(!report.includes(fakeKey) && !digest.includes(fakeKey) && !log.includes(fakeSk));
assert.ok(report.includes('<secret>'));
assert.ok(digest.includes('# report') === false); // digest 不被误读成 report
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, secretRedacted: true, reportPreserved: true }));
