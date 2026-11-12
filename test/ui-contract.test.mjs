// UI 契约测试：不启动浏览器，直接抓路由 handler，断言 JSON 结构与体积上限。
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

const handlers = new Map();
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {}; } },
  inject: (names, cb) => { cb({ tools: { register: () => () => {} }, commands: { register: () => () => {} } }); },
  logger: { warn: () => {} },
};
apply(ctx);

async function get(p) {
  const [path, query = ''] = p.split('?');
  const handler = handlers.get(path);
  assert.ok(handler, `缺路由 ${path}`);
  let code = 0; let body = '';
  const req = { method: 'GET', url: p, headers: { host: '127.0.0.1' }, on() {} };
  const res = { writeHead(c) { code = c; }, end(b) { body = b; }, writableEnded: false };
  await handler(req, res);
  return { code, raw: body, json: (() => { try { return JSON.parse(body); } catch { return null; } })() };
}

const overview = await get('/dsh-weekly-retro/ui/overview');
assert.equal(overview.code, 200);
assert.ok(overview.json.kpis);
assert.ok(overview.json.kpis.sessions >= 0);
assert.ok(['fresh', 'aging', 'stale', 'none'].includes(overview.json.freshness.level));
assert.ok(Array.isArray(overview.json.topCandidates));

const metrics = await get('/dsh-weekly-retro/ui/metrics');
assert.equal(metrics.code, 200);
for (const key of ['sessionSplit', 'turnSplit', 'compactionHistogram', 'turnHistogram', 'verdictDonut', 'repeatBars', 'portraitBars', 'sessionTurns', 'hourHeat', 'toolTop', 'weeklyTrend', 'funnel', 'scoreMatrix']) {
  assert.ok(metrics.json[key] !== undefined, `metrics 缺 ${key}`);
}
assert.equal(metrics.json.hourHeat.length, 24);
assert.ok(metrics.raw.length < 400 * 1024, `metrics 体积 ${metrics.raw.length}B 超上限`);

const cands = await get('/dsh-weekly-retro/ui/candidates');
assert.equal(cands.code, 200);
assert.ok(Array.isArray(cands.json.candidates));
for (const c of cands.json.candidates) {
  assert.ok(c.key && c.title && c.verdict);
  assert.equal(typeof c.total, 'number');
}

const findings = await get('/dsh-weekly-retro/ui/findings');
assert.equal(findings.code, 200);
assert.ok(Array.isArray(findings.json.portrait));
assert.ok(Array.isArray(findings.json.repeats));
for (const p of findings.json.portrait) assert.ok(Array.isArray(p.sessions));

const history = await get('/dsh-weekly-retro/ui/history');
assert.equal(history.code, 200);
assert.ok(Array.isArray(history.json.weeks));
assert.ok(Array.isArray(history.json.decisions));

const jobMissing = await get('/dsh-weekly-retro/ui/job?id=nope');
assert.equal(jobMissing.code, 404);

// 方法限制：GET ui/run 必须 405（写操作只允许 POST）
const runGet = await get('/dsh-weekly-retro/ui/run');
assert.equal(runGet.code, 405);

console.log(JSON.stringify({
  ok: true,
  routes: handlers.size,
  metricsBytes: metrics.raw.length,
  candidates: cands.json.candidates.length,
  portrait: findings.json.portrait.length,
  weeks: history.json.weeks.length,
}));
