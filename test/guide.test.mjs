// Phase 2：weekly_guide 只读分析桥的边界与内容。
import assert from 'node:assert/strict';
import { buildToolDefs } from '../lib/index.js';

const defs = buildToolDefs();
const tool = defs.find((d) => d.name === 'weekly_guide');
assert.ok(tool, '必须注册 weekly_guide');
assert.deepEqual(Object.keys(tool.parameters), ['topic']);
assert.equal(tool.parameters.topic.required, true);

const template = await tool.execute({ topic: 'findings-template' });
assert.equal(template.ok, true);
assert.equal(template.topic, 'findings-template');
assert.match(template.content, /"week"/);
assert.ok(template.path.startsWith('<plugin>/'), '包内文件不应回传绝对路径');
assert.ok(!template.content.includes('/Users/'), '模板不应含绝对家目录路径');

const criteria = await tool.execute({ topic: 'plugin-criteria' });
assert.equal(criteria.ok, true);
assert.match(criteria.content, /决策树/);
assert.match(criteria.content, /evidenceSessions/);
assert.ok(criteria.path.startsWith('<plugin>/'));

const bad = await tool.execute({ topic: 'digest.json' });
assert.equal(bad.ok, false);
assert.equal(bad.kind, 'invalid-topic');

const packet = await tool.execute({ topic: 'packet' });
if (packet.ok) {
  assert.equal(packet.topic, 'packet');
  assert.ok(!packet.path.startsWith('/'), 'packet 路径必须是脱敏路径');
  assert.ok(!packet.content.includes('/Users/'), 'packet 不应含绝对家目录路径');
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{16,}/.test(packet.content), 'packet 不应含 token');
  assert.ok(packet.chars <= 20_100, `packet 超过 20k 字符：${packet.chars}`);
} else {
  assert.match(packet.kind, /missing-guide|read-error/);
}

console.log(JSON.stringify({ ok: true, guide: 'packet/template/criteria', packet: packet.ok ? packet.chars : packet.kind }));
