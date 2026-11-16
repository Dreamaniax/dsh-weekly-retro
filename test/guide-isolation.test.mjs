// Phase 2 隔离验收：临时 DSH_LEARNING + 伪造 packet，验证 weekly_guide 的脱敏与截断路径。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(path.join(tmpdir(), 'dsh-guide-'));
const weekly = path.join(root, 'weekly');
mkdirSync(weekly, { recursive: true });
writeFileSync(path.join(weekly, 'packet.md'), [
  '# packet',
  'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\t3轮\t做周报',
  'workspace: /Users/dreamania/secret/project',
  'token: Authorization: Bearer as_sk_123456789012345678901234',
  '重复动作：批量归档',
].join('\n'), { mode: 0o600 });

const dataUrl = new URL('../lib/data.js', import.meta.url).href;
const script = `
import { guide } from ${JSON.stringify(dataUrl)};
const packet = guide('packet');
const tmpl = guide('findings-template');
const crit = guide('plugin-criteria');
const bad = guide('digest.json');
console.log(JSON.stringify({ packet, tmpl, crit, bad }));
`;
const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  env: { ...process.env, DSH_LEARNING: root },
  encoding: 'utf8',
});
rmSync(root, { recursive: true, force: true });
assert.equal(r.status, 0, r.stderr || 'guide isolation child failed');
const out = JSON.parse(r.stdout);
assert.equal(out.packet.ok, true);
assert.equal(out.packet.topic, 'packet');
assert.ok(out.packet.path.startsWith('<path>') || out.packet.path.startsWith('~'), `unexpected packet path: ${out.packet.path}`);
assert.ok(!out.packet.content.includes('/Users/'), 'packet 绝对路径必须脱敏');
assert.ok(!out.packet.content.includes('as_sk_123456789012345678901234'), 'packet token 必须脱敏');
assert.ok(out.packet.content.includes('<path>'));
assert.ok(out.packet.content.includes('<secret>'));
assert.equal(out.tmpl.ok, true);
assert.equal(out.tmpl.path.startsWith('<plugin>/'), true);
assert.match(out.tmpl.content, /"week"/);
assert.equal(out.crit.ok, true);
assert.match(out.crit.content, /决策树/);
assert.equal(out.bad.ok, false);
assert.equal(out.bad.kind, 'invalid-topic');
console.log(JSON.stringify({ ok: true, isolated: true, packetPath: out.packet.path, templatePath: out.tmpl.path }));
