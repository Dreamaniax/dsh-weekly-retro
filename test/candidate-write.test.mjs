// 重复动作 → proposals.json 候选：写入、幂等、备份、权限。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-candidate-'));
const weekly = path.join(root, 'weekly');
fs.mkdirSync(weekly, { recursive: true });
fs.writeFileSync(path.join(weekly, 'findings.json'), JSON.stringify({
  week: '2026-W99',
  repeats: [{ key: 'r1', pattern: '重复整理', count: 4, cost: '每次 10 分钟', evidence: ['s1', 's2'] }],
}, null, 2));
fs.writeFileSync(path.join(weekly, 'proposals.json'), JSON.stringify({ week: '2026-W99', proposals: [] }, null, 2));
process.env.DSH_LEARNING = root;

const { createCandidateFromRepeat } = await import('../lib/data.js');
const first = await createCandidateFromRepeat('r1');
assert.equal(first.ok, true);
assert.equal(first.key, 'repeat-r1');
assert.equal(first.candidate.verdict, 'skill');
const saved = JSON.parse(fs.readFileSync(path.join(weekly, 'proposals.json'), 'utf8'));
assert.equal(saved.proposals.length, 1);
assert.equal(saved.proposals[0].repeatKey, 'r1');
assert.ok(fs.readdirSync(weekly).some((f) => f.startsWith('proposals.json.bak-')));
assert.equal(fs.statSync(path.join(weekly, 'proposals.json')).mode & 0o777, 0o600);
const again = await createCandidateFromRepeat('r1');
assert.equal(again.ok, true);
assert.equal(again.already, true);
assert.equal(JSON.parse(fs.readFileSync(path.join(weekly, 'proposals.json'), 'utf8')).proposals.length, 1);
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, key: first.key, idempotent: again.already, mode: '0600' }));
