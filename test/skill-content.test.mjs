// Phase 2：包内技能规范不得再依赖旧脚本路径，且必须保留关键约束。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSkillBody } from '../lib/index.js';

const body = readSkillBody();
const oldPaths = [
  /learning\/scripts/,
  /run-weekly\.sh/,
  /land-sync\.sh/,
  /check-findings\.mjs/,
  /report\.mjs/,
  /report-html\.mjs/,
  /findings\.template\.json/,
  /PLUGIN-CRITERIA\.md/,
  /selftest\.sh/,
  /history-merge\.mjs/,
];
for (const re of oldPaths) assert.doesNotMatch(body, re, `旧脚本路径残留：${re}`);

assert.doesNotMatch(body, /\/Users\/|\/home\//, '规范不得含绝对家目录路径');
assert.match(body, /唯一权威来源/, '必须声明唯一权威来源');
assert.match(body, /weekly_guide/);
assert.match(body, /0 会话 fail-closed/);
assert.match(body, /单实例锁/);
assert.match(body, /回填模式/);
assert.match(body, /evidenceSessions/);
assert.match(body, /≤6/);
assert.match(body, /synced=true/);
assert.match(body, /≤15 行/);
assert.match(body, /已落地但未同步/);
assert.match(body, /不把会话原文贴进周报/);
assert.equal(Buffer.byteLength(body) > 8000, true);

const raw = readFileSync(new URL('../skills/weekly-retro/SKILL.md', import.meta.url), 'utf8');
assert.ok(raw.trim().length > 0);
console.log(JSON.stringify({ ok: true, bytes: Buffer.byteLength(body), oldPaths: 0, constraints: 8 }));
