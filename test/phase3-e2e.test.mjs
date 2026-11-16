// Phase 3：隔离 DSH_LEARNING + 合成 digest/packet，走完 9 步的代码路径。
// 真实模型只在步骤 3/6/7 介入；这里用固定 findings 代替模型写作，验证其余环节真的闭环。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-phase3-'));
const weekly = path.join(root, 'weekly');
fs.mkdirSync(weekly, { recursive: true, mode: 0o700 });
process.env.DSH_LEARNING = root;
delete process.env.DSH_WEEKLY_SCRIPTS;

const ids = ['session-syn-a', 'session-syn-b', 'session-syn-c'];
const cwd = '/tmp/weekly-demo';
const t0 = Date.parse('2026-11-09T09:00:00+08:00');
const sessions = ids.map((id, i) => ({
  id,
  cwd,
  origin: 'user',
  parent: null,
  created: t0 + i * 3600_000,
  last: t0 + i * 3600_000 + 30 * 60_000,
  title: `合成会话 ${String.fromCharCode(65 + i)}：批量整理与周报`,
  turns: 6 + i,
  assistant: 18 + i,
  errors: i,
  userMessages: ['把三份材料整理成一份带结论的周报', '再检查一下路径和权限'],
  userMessageCount: 2,
  recentMessages: ['再检查一下路径和权限'],
  intentMessages: ['整理材料并出周报'],
  turnShapes: ['bash', 'edit'],
  turnShapeTotal: 2,
  skillsCalled: { 'weekly-retro': 1 },
  skillFails: 0,
  steps: 12 + i,
  model: 'synthetic',
  contextWindow: 128000,
  compactions: i === 0 ? 1 : 0,
  preWindowTurns: 0,
  dayHits: [1, 2],
  hourHits: [9, 10],
  cmdClusters: [{ cmd: 'node', n: 3 }],
  tools: { bash: 5 + i, edit: 2, write: 1 },
  filesWritten: [{ path: `${cwd}/docs/week-${i}.md`, n: 1 }],
}));
const digest = {
  schema: 'weekly-digest/v3',
  generatedAt: '2026-11-15T14:00:00.000Z',
  windowEnd: '2026-11-15T14:00:00.000Z',
  skillLibraryCount: 2,
  windowDays: 7,
  sessionFilesScanned: 3,
  skippedFiles: 0,
  idleSessions: 0,
  totalSessions: sessions.length,
  byWorkspace: { [cwd]: { sessions: sessions.length, turns: 21, userMessages: 6, topTools: [['bash', 18], ['edit', 6]] } },
  sessions,
};
fs.writeFileSync(path.join(weekly, 'digest.json'), JSON.stringify(digest, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(weekly, 'packet.md'), `# 2026-W46 分析包\n\n## 元信息\n- 周：2026-W46\n- 会话：${ids.length}\n- 会话 id：${ids.join(' / ')}\n\n## 会话\n${ids.map((id) => `### ${id}\n用户诉求：整理材料并出周报\n`).join('\n')}`, { mode: 0o600 });

const { buildToolDefs } = await import('../lib/index.js');
const { summary } = await import('../lib/data.js');
const defs = buildToolDefs();
const tool = (name) => {
  const d = defs.find((x) => x.name === name);
  assert.ok(d, `缺工具 ${name}`);
  return d;
};
const call = (name, args = {}) => tool(name).execute(args);

const findings = {
  week: '2026-W46',
  generatedAt: '2026-11-15T22:10:00+08:00',
  mode: 'live',
  portrait: [
    { mainline: '把三份材料整理成周报', goal: '减少手工汇总', outputs: ['docs/week-0.md'], sessions: [ids[0]], note: '核对路径最费劲' },
    { mainline: '检查路径和权限', goal: '避免发布后返工', outputs: ['docs/week-1.md'], sessions: [ids[1]] },
    { mainline: '生成可回溯候选', goal: '把重复动作固化', outputs: ['findings.json'], sessions: [ids[2]] },
  ],
  repeats: [
    { pattern: '整理材料 → 查路径 → 生成周报', count: 3, cost: '每次 3-5 轮', evidence: [ids[0]], status: 'skill' },
    { pattern: '发布前手工检查权限', count: 2, cost: '每次 2 轮', evidence: [ids[1]], status: 'rule' },
  ],
  candidates: [
    { key: 'skill-synthetic-weekly', title: '合成周报整理技能', what: '把材料整理成可回溯周报', evidence: '3 个会话', steps: ['收集', '校验'], saving: '少一次返工', effort: '低', shape: 'skill', verdict: 'skill', scores: { freq: 2, trigger: 2, capability: 2, verifiable: 1 }, evidenceSessions: [ids[0]] },
    { key: 'plugin-synthetic-guide', title: '合成分析桥插件', what: '只读返回分析包与模板', evidence: '3 个会话', steps: ['注册工具', '校验'], saving: '模型少读无关数据', effort: '中', shape: 'plugin', verdict: 'plugin', scores: { freq: 2, trigger: 2, capability: 2, verifiable: 2 }, plugin_spec: { trigger: 'tool', persist: false, minimal_scope: '只读 packet/template' }, evidenceSessions: [ids[2]] },
  ],
};
fs.writeFileSync(path.join(weekly, 'findings.json'), JSON.stringify(findings, null, 2), { mode: 0o600 });

try {
  // 1. 先看数据
  const status = await call('weekly_status');
  assert.equal(status.ok, true);
  assert.equal(status.sessions, 3);
  assert.equal(status.week, '2026-W46'); // 即使尚未生成 proposals，也要能从 digest 读出周

  // 2. 读分析包；非法 topic 不能变成任意文件读取
  const packet = await call('weekly_guide', { topic: 'packet' });
  assert.equal(packet.ok, true);
  assert.match(packet.content, /session-syn-a/);
  assert.equal((await call('weekly_guide', { topic: '../../etc/passwd' })).kind, 'invalid-topic');

  // 3. 模板可读（模型据此写 findings）
  const tpl = await call('weekly_guide', { topic: 'findings-template' });
  assert.equal(tpl.ok, true);
  assert.match(tpl.content, /evidenceSessions/);

  // 4. findings 校验
  const valid = await call('weekly_validate');
  assert.equal(valid.ok, true, valid.text || valid.error);
  assert.match(valid.text, /画像 3 条/);

  // 5. 重跑报告；必须出现画像/重复/候选，而不是回退成空壳
  const run = await call('weekly_run', { mode: 'report' });
  assert.equal(run.ok, true, run.tail || run.kind);
  const reportPath = path.join(weekly, 'latest.html');
  const mdPath = path.join(weekly, '2026-W46.md');
  assert.ok(fs.existsSync(reportPath));
  const html = fs.readFileSync(reportPath, 'utf8');
  const md = fs.readFileSync(mdPath, 'utf8');
  for (const s of ['工作流画像', '重复劳动清单', '合成周报整理技能', '合成分析桥插件']) {
    assert.ok(html.includes(s), `报告缺 ${s}`);
  }
  assert.ok(md.includes('合成会话 A'), '报告应保留合成会话主线');
  const after = summary();
  assert.equal(after.portrait, 3);
  assert.equal(after.repeats, 2);
  assert.equal(after.candidates.length, 2);

  // 6/7 是模型对用户汇报与确认；此处断言给用户看的材料已齐备
  assert.ok(html.includes('候选'));

  // 8. 采纳一条，显式 sync=false，必须明确“未同步”
  const landed = await call('weekly_land', { key: 'skill-synthetic-weekly', note: 'Phase 3 隔离验收', sync: false });
  assert.equal(landed.ok, true, landed.error || landed.kind);
  assert.equal(landed.synced, false);
  assert.match(landed.where, /未同步/);

  // 9. decisions 留痕
  const decisions = JSON.parse(fs.readFileSync(path.join(weekly, 'decisions.json'), 'utf8'));
  assert.equal(decisions.decisions.length, 1);
  assert.equal(decisions.decisions[0].key, 'skill-synthetic-weekly');
  assert.match(decisions.decisions[0].where, /未同步/);

  // 坏 findings：校验失败，且校验本身不改报告
  const beforeBad = fs.readFileSync(reportPath);
  const bad = structuredClone(findings);
  bad.portrait[0].sessions = ['session-unknown'];
  fs.writeFileSync(path.join(weekly, 'findings.json'), JSON.stringify(bad, null, 2), { mode: 0o600 });
  const invalid = await call('weekly_validate');
  assert.equal(invalid.ok, false);
  assert.match(invalid.text, /未知会话/);
  assert.deepEqual(fs.readFileSync(reportPath), beforeBad, '校验失败不应改报告');

  // 显式重跑时，坏 findings 回退旧规则，但报告不能被写成空壳
  const fallback = await call('weekly_run', { mode: 'report' });
  assert.equal(fallback.ok, true, fallback.tail || fallback.kind);
  const fallbackSummary = summary();
  assert.ok(fallbackSummary.findingsRejected, '报告应标记 findings 被拒收');
  assert.ok(fs.statSync(reportPath).size > 1000, '回退报告不能是空壳');
  assert.ok(fs.readFileSync(reportPath, 'utf8').includes('2026-W46'));

  console.log(JSON.stringify({
    ok: true,
    steps: 9,
    sessions: status.sessions,
    portrait: after.portrait,
    repeats: after.repeats,
    candidates: after.candidates.length,
    unsyncedWhere: landed.where,
    badFindingsRejected: Boolean(fallbackSummary.findingsRejected),
  }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
