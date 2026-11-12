// 无宿主依赖的冒烟测试：数据层 + 工具定义 + apply 的路由/命令注册。
import assert from 'node:assert/strict';
import { summary, reportHtml } from '../lib/data.js';
import { buildToolDefs } from '../lib/index.js';

const s = summary();
assert.equal(typeof s.ok, 'boolean');
assert.ok(Array.isArray(s.candidates), 'candidates 应为数组');
assert.ok(s.sessions >= 0 && s.turns >= 0);

const defs = buildToolDefs();
assert.deepEqual(defs.map((d) => d.name), ['weekly_status', 'weekly_run', 'weekly_land', 'weekly_validate']);
assert.deepEqual(Object.keys(defs[2].parameters), ['key', 'note', 'sync']);
assert.equal(defs[2].parameters.key.required, true);

const status = await defs[0].execute();
assert.equal(typeof status, 'object');
assert.ok(typeof status.summary === 'string' && status.summary.includes('会话'));

const html = reportHtml();
assert.ok(html === null || html.includes('<!doctype html>'), 'reportHtml 返回 HTML 或 null');

// apply 的注册面：4 条路由 + 1 条命令
const routes = [], commands = [];
const ctx = {
  effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined); },
  // 真宿主里 webServer 是 export inject 声明的服务，直接挂在 ctx 上
  webServer: { register: (r) => { routes.push(r.path); return () => {}; } },
  inject: (names, cb) => {
    const svc = {};
    if (names.includes('commands')) svc.commands = { register: (c) => { commands.push(c.name); return () => {}; } };
    if (names.includes('tools')) svc.tools = { register: () => () => {} };
    cb(svc);
  },
  logger: { warn: () => {} },
};
const { apply } = await import('../lib/index.js');
apply(ctx);
assert.deepEqual(routes.sort(), [
  '/dsh-weekly-retro/diagnostics', '/dsh-weekly-retro/land', '/dsh-weekly-retro/report',
  '/dsh-weekly-retro/run', '/dsh-weekly-retro/summary',
  '/dsh-weekly-retro/ui/candidates', '/dsh-weekly-retro/ui/findings',
  '/dsh-weekly-retro/ui/history', '/dsh-weekly-retro/ui/job',
  '/dsh-weekly-retro/ui/metrics', '/dsh-weekly-retro/ui/overview',
  '/dsh-weekly-retro/ui/repeat-candidate', '/dsh-weekly-retro/ui/run',
]);
assert.deepEqual(commands, ['weekly']);
console.log(JSON.stringify({ ok: true, week: s.week, sessions: s.sessions, candidates: s.candidates.length, routes: routes.length, commands: commands.length }));
