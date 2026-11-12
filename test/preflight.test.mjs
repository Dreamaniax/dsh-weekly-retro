// 启动安全门：禁止任何会让宿主 / web 启动挂起的声明。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildToolDefs } from '../lib/index.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const mod = await import('../lib/index.js');

// 1) client 半：必须先过静态安全门（历史事故：inject 写错拖死 web 启动）
assert.ok(pkg.dsh.client, '必须声明 dsh.client');
assert.equal(pkg.dsh.client.platform, 'web');
const CLIENT_KNOWN = new Set([
  '@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-slots',
]);
assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0, 'inject 不能为空');
for (const dep of pkg.dsh.client.inject) {
  assert.ok(CLIENT_KNOWN.has(dep), `client inject 未在已知宿主服务白名单：${dep}`);
}
assert.equal(pkg.exports['./client']?.default, './lib/client.js');
const clientPath = new URL('../lib/client.js', import.meta.url);
assert.ok(fs.existsSync(clientPath), 'client.js 必须存在');
const clientSrc = fs.readFileSync(clientPath, 'utf8');
assert.ok(clientSrc.includes('window.__ModuleLoader__.load({'), 'client 必须用宿主 ModuleLoader 包装');
assert.ok(/exports\.apply\s*=/.test(clientSrc) && /exports\.inject\s*=/.test(clientSrc));
// 历史事故：客户端 DI 只认短服务名，写包名会 pending 拖死 web 启动
assert.match(clientSrc, /const inject = \['slots', 'locale'\]/, 'client 导出的 inject 必须是短服务名 slots + locale');
assert.ok(clientSrc.includes("reg('main', 'weekly-retro'"), 'sidebar.panellist 必须有同 id 的 main 面板');
// P4：a11y 与单一入口回归门
assert.ok((clientSrc.match(/role: 'img'/g) || []).length >= 5, '所有图表必须带 role="img" + aria-label');
assert.ok(clientSrc.includes("role: 'tablist'") && clientSrc.includes("'aria-selected'"), 'Tab 必须有 tablist/tab/aria-selected 语义');
assert.ok(!clientSrc.includes('sidebar.right.pane.tab'), '入口收敛：不得再注册右侧 pane tab');
assert.ok(clientSrc.includes("const inject = ['slots', 'locale']"), 'client 必须接入 locale 服务');
const chk = spawnSync(process.execPath, ['--check', clientPath.pathname], { encoding: 'utf8' });
assert.equal(chk.status, 0, `client.js 语法错误：${chk.stderr}`);

// 2) export inject 只允许已验证的宿主服务
const KNOWN = new Set(['tools', 'webServer', 'settings', 'llm', 'systemPrompt', 'attachments', 'credentials']);
for (const svc of mod.inject) assert.ok(KNOWN.has(svc), `未知宿主服务：${svc}`);

// 3) 入口契约
assert.equal(typeof mod.apply, 'function');
assert.equal(mod.name, 'dsh-weekly-retro');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.ok(pkg.dsh.engines.dsh, '必须声明 dsh 兼容区间');

// 4) 工具定义完整，且踩过的两个坑必须回归拦截
const defs = buildToolDefs();
assert.deepEqual(defs.map((d) => d.name), ['weekly_status', 'weekly_run', 'weekly_land', 'weekly_validate']);
for (const d of defs) {
  assert.equal(typeof d.output?.render, 'function', `${d.name} 缺 output.render（defineTool 会崩）`);
  assert.ok(d.output?.schema, `${d.name} 缺 output.schema`);
  assert.equal(typeof d.parameters, 'object', `${d.name} 的 parameters 必须是对象（空也要给 {}）`);
  assert.equal(d.output.schema.type, 'object', `${d.name} 的 output.schema 必须是 object（execute 必须返回对象，不能返回 JSON 字符串）`);
}

// 4b) /weekly 命令只能聊天触发，但文案函数必须可测（与 /summary 同源）
const text = mod.formatStatus({ week: '2026-W46', sessions: 12, mainSessions: 7, turns: 84, turnsAll: 174, portrait: 5, repeats: 5, candidates: [], compactions: 3, corrections: 2 });
assert.ok(text.includes('全量 174 轮'), '文案必须包含全量轮次');
assert.ok(text.includes('上下文压缩 3 次'), '文案必须包含压缩次数');

// 5) apply 在服务缺失时也必须不抛
const calls = [];
const ctx = {
  effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined); },
  webServer: { register: (r) => { calls.push(r.path); return () => {}; } },
  slots: { inject: () => () => {}, register: () => () => {} },
  inject: () => { throw new Error('service missing'); },
  logger: { warn: () => {} },
};
assert.doesNotThrow(() => mod.apply(ctx));
assert.equal(calls.length, 12);

console.log(JSON.stringify({ ok: true, inject: mod.inject, routes: calls.length, client: 'declared' }));
