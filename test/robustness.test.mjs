// 稳定性回归：损坏数据拒绝覆盖、缺文件不抛、异步不阻塞、状态码映射、写操作门。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-rob-'));
const weekly = path.join(tmp, 'weekly');
const scripts = path.join(tmp, 'scripts');
fs.mkdirSync(weekly, { recursive: true });
fs.mkdirSync(scripts, { recursive: true });
fs.writeFileSync(path.join(weekly, 'proposals.json'), JSON.stringify({
  week: '2026-W46',
  proposals: [{ key: 'k1', title: '候选一', verdict: 'skill' }],
}));
fs.writeFileSync(path.join(weekly, 'decisions.json'), '{"decisions": [ BROKEN');

process.env.DSH_LEARNING = tmp;
process.env.DSH_WEEKLY_SCRIPTS = scripts; // 强制空脚本目录，验证 missing-script 分支（不受内置 pipeline 影响）
const data = await import(`../lib/data.js?rob=${Date.now()}`);
const mod = await import('../lib/index.js');

// 1) 损坏的 decisions.json：拒绝写入，原文件一字不改
const before = fs.readFileSync(path.join(weekly, 'decisions.json'), 'utf8');
const bad = await data.land('k1');
assert.equal(bad.ok, false);
assert.equal(bad.kind, 'decisions-corrupt');
assert.equal(fs.readFileSync(path.join(weekly, 'decisions.json'), 'utf8'), before, '损坏文件被覆盖 = 静默丢历史');
assert.deepEqual(fs.readdirSync(weekly).filter((f) => f.includes('.bak')), [], '拒绝写入时不应产生备份垃圾');

// 2) 缺 digest：summary 不抛，ok=false
const s = data.summary();
assert.equal(s.ok, false);
assert.equal(s.portrait, null);
assert.ok(Array.isArray(s.candidates));

// 3) 缺脚本：runPipeline 返回 missing-script 而非抛异常（两种模式）
const full = await data.runPipeline({ mode: 'full' });
assert.equal(full.kind, 'missing-script');
const rep = await data.runPipeline({ mode: 'report' });
assert.equal(rep.kind, 'missing-script');

// 4) 非法 windowEnd 早失败
const badWin = await data.runPipeline({ mode: 'full', windowEnd: 'not-a-date' });
assert.equal(badWin.kind, 'bad-windowEnd');

// 5) 状态码映射：失败不再 200（含 busy）
assert.equal(mod.httpStatus({ ok: true }), 200);
assert.equal(mod.httpStatus({ ok: false, kind: 'unknown-key' }), 400);
assert.equal(mod.httpStatus({ ok: false, kind: 'locked' }), 409);
assert.equal(mod.httpStatus({ ok: false, kind: 'busy' }), 409);
assert.equal(mod.httpStatus({ ok: false, kind: 'no-sessions' }), 422);
assert.equal(mod.httpStatus({ ok: false, kind: 'missing-script' }), 503);
assert.equal(mod.httpStatus({ ok: false, kind: 'timeout' }), 504);
assert.equal(mod.httpStatus({ ok: false, kind: 'whatever' }), 500);

// 5b) 隐私边界：非回环地址默认拒绝，token/显式开关才放行
assert.equal(mod.isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
assert.equal(mod.isLoopbackRequest({ socket: { remoteAddress: '::1' } }), true);
assert.equal(mod.isLoopbackRequest({ socket: { remoteAddress: '10.0.0.8' } }), false);
assert.equal(mod.remoteAllowed({ socket: { remoteAddress: '10.0.0.8' }, headers: {} }, undefined), false, '远程默认必须拒绝');
assert.equal(mod.remoteAllowed({ socket: { remoteAddress: '10.0.0.8' }, headers: { 'x-weekly-token': 'sekret' } }, 'sekret'), true, '远程带正确 token 放行');
{
  const prev = process.env.DSH_WEEKLY_ALLOW_REMOTE;
  process.env.DSH_WEEKLY_ALLOW_REMOTE = '1';
  assert.equal(mod.remoteAllowed({ socket: { remoteAddress: '10.0.0.8' }, headers: {} }, undefined), true, '显式开关放行');
  if (prev === undefined) delete process.env.DSH_WEEKLY_ALLOW_REMOTE; else process.env.DSH_WEEKLY_ALLOW_REMOTE = prev;
}

// 6) 写操作门：跨源拒绝、同源放行、token 模式
assert.equal(mod.mutatingAllowed({ headers: {} }, undefined), true, '无 Origin（curl/工具）应放行');
assert.equal(mod.mutatingAllowed({ headers: { origin: 'https://evil.example', host: '127.0.0.1:1' } }, undefined), false, '跨源必须拒绝');
assert.equal(mod.mutatingAllowed({ headers: { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' } }, undefined), true, '同源应放行');
assert.equal(mod.mutatingAllowed({ headers: {} }, 'sekret'), true, '配了 token 时，非浏览器调用（无 Origin）仍放行');
assert.equal(mod.mutatingAllowed({ headers: { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' } }, 'sekret'), true, '配了 token 也不能锁死同源面板');
assert.equal(mod.mutatingAllowed({ headers: { origin: 'https://evil.example', host: '127.0.0.1:1' } }, 'sekret'), false, '跨源带不带 token 都必须拒');
assert.equal(mod.mutatingAllowed({ headers: { 'x-weekly-token': 'sekret' } }, 'sekret'), true);

// 7) 交互提示语义：exit 4 不是"生成失败"
assert.match(mod.kindText({ kind: 'selftest-failed', code: 4, ms: 10, tail: '' }), /报告已生成/);
assert.match(mod.kindText({ kind: 'no-sessions', code: 2, ms: 5 }), /没有可分析的会话/);
assert.match(mod.kindText({ kind: 'locked', code: 3, ms: 5 }), /单实例锁/);
assert.match(mod.kindText({ kind: 'ok', code: 0, ms: 100, tail: 'done' }), /周报已生成/);


// 8) 坏形状 JSON 不得打死状态面（C 审计 P1：一个坏 JSON 让 /summary 400）
fs.writeFileSync(path.join(weekly, 'digest.json'), '{"sessions": 5}');
fs.writeFileSync(path.join(weekly, 'proposals.json'), '{"week":"2026-W46","proposals":{"oops":1}}');
const s2 = data.summary();
assert.equal(s2.ok, false, 'sessions 不是数组时 ok 必须为 false');
assert.deepEqual(s2.candidates, [], 'proposals 非数组时必须降级为空');
assert.equal(s2.portrait, null);

// digest.sessions 含 null 元素也不得抛
fs.writeFileSync(path.join(weekly, 'digest.json'), JSON.stringify({ sessions: [null, { origin: 'user', turns: 2 }] }));
const s3 = data.summary();
assert.equal(s3.sessions, 1, 'null 元素必须被过滤');

// 9) exit 0 但不写产物 → no-artifacts（C 审计 6c 假成功）
fs.writeFileSync(path.join(scripts, 'run-weekly.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
const noArt = await data.runPipeline({ mode: 'full', timeoutMs: 5000 });
assert.equal(noArt.kind, 'no-artifacts');
assert.equal(noArt.ok, false);

// 10) 超时 → kind=timeout 且 timeout=true；超时后"已死持有者"的 .weekly.lock 必须被清理
fs.writeFileSync(path.join(scripts, 'run-weekly.sh'), '#!/bin/bash\nsleep 5\n', { mode: 0o755 });
fs.mkdirSync(path.join(weekly, '.weekly.lock'));
fs.writeFileSync(path.join(weekly, '.weekly.lock', 'pid'), '999999');
const to = await data.runPipeline({ mode: 'full', timeoutMs: 300 });
assert.equal(to.kind, 'timeout');
assert.equal(to.timeout, true);
assert.equal(fs.existsSync(path.join(weekly, '.weekly.lock')), false, '死 pid 的残留锁应被清理');

// 10b) 活 pid 的锁绝不能被插件清掉
fs.mkdirSync(path.join(weekly, '.weekly.lock'));
fs.writeFileSync(path.join(weekly, '.weekly.lock', 'pid'), String(process.pid));
const to2 = await data.runPipeline({ mode: 'full', timeoutMs: 1000 });
assert.equal(to2.kind, 'timeout');
assert.equal(fs.existsSync(path.join(weekly, '.weekly.lock')), true, '活锁必须保留');
fs.rmSync(path.join(weekly, '.weekly.lock'), { recursive: true, force: true });

// 10c) 超时参数钳制
assert.equal(data.clampTimeout(300), 1000);
assert.equal(data.clampTimeout(999999), 180000);
assert.equal(data.clampTimeout('x'), 120000);
assert.equal(data.clampTimeout(45000), 45000);

// 11) check-findings 缺失 → missing-script（而不是静默 empty text）
const outside = await data.validateFindings({ file: path.join(os.tmpdir(), 'not-weekly.json') });
assert.equal(outside.kind, 'invalid-path', 'validate 必须拒绝 weekly/ 之外的路径');
const v = await data.validateFindings();
assert.equal(v.ok, false);
assert.equal(v.kind, 'missing-script');

// 12) 并发 land 不丢更新（C 审计 P1：10 并发只落 1 条）
fs.writeFileSync(path.join(weekly, 'digest.json'), JSON.stringify({ sessions: [] }));
fs.writeFileSync(path.join(weekly, 'proposals.json'), JSON.stringify({
  week: '2026-W46',
  proposals: [{ key: 'k1', title: '候选一', verdict: 'skill' }, { key: 'k2', title: '候选二', verdict: 'skill' }],
}));
fs.writeFileSync(path.join(weekly, 'decisions.json'), JSON.stringify({ decisions: [] }));
const [l1, l2] = await Promise.all([data.land('k1', { sync: false }), data.land('k2', { sync: false })]);
assert.equal(l1.ok, true);
assert.equal(l2.ok, true);
const written = JSON.parse(fs.readFileSync(path.join(weekly, 'decisions.json'), 'utf8'));
assert.equal(written.decisions.length, 2, '并发落地必须两条都在');


// 13) proposals 形状坏：land 必须结构化拒绝（不再 TypeError 500）
fs.writeFileSync(path.join(weekly, 'proposals.json'), JSON.stringify({ week: '2026-W46', proposals: { oops: 1 } }));
const badProp = await data.land('k1', { sync: false });
assert.equal(badProp.ok, false);
assert.equal(badProp.kind, 'proposals-corrupt');

// 14) report 模式参与 .weekly.lock：锁被占时必须 locked 而不是硬跑
fs.mkdirSync(path.join(weekly, '.weekly.lock'));
fs.writeFileSync(path.join(weekly, '.weekly.lock', 'pid'), String(process.pid));
const lockedReport = await data.regenerateReport({});
assert.equal(lockedReport.ok, false);
assert.equal(lockedReport.kind, 'locked');
fs.rmSync(path.join(weekly, '.weekly.lock'), { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: 17, corruptRefused: true, asyncSpawn: true, csrfGuard: true, httpStatus: true }));
