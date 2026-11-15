// Phase 1：插件内置技能的注册面。不依赖宿主，只验证 runtime skill 定义与包内文件。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { apply, readSkillBody } from '../lib/index.js';

const skills = [];
const routes = [];
const ctx = {
  effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined); },
  webServer: { register: (r) => { routes.push(r.path); return () => {}; } },
  inject: (names, cb) => {
    const svc = {
      effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined); },
    };
    if (names.includes('skills')) svc.skills = { register: (s) => { skills.push(s); return () => {}; } };
    if (names.includes('commands')) svc.commands = { register: (c) => { routes.push(`cmd:${c.name}`); return () => {}; } };
    if (names.includes('tools')) svc.tools = { register: () => () => {} };
    cb(svc);
  },
  logger: { warn: () => {} },
};

apply(ctx);

assert.equal(skills.length, 1, '应注册一个 runtime skill');
const s = skills[0];
assert.equal(s.name, 'weekly-retro');
assert.match(s.description, /周报复盘/);
assert.match(s.whenToUse, /跑周报/);
assert.equal(s.invocation.modelInvocable, true);
assert.equal(s.invocation.userInvocable, true);
assert.equal(s.resourceBase.kind, 'directory');
assert.ok(existsSync(s.resourceBase.path), 'resourceBase 目录应存在');
assert.ok(s.content.startsWith('# Weekly Retro'), 'content 应是正文，不含 frontmatter');
assert.ok(!/^---\r?$/m.test(s.content), 'content 不应包含 YAML frontmatter');
assert.match(s.content, /findings\.json/);
assert.equal(readSkillBody().startsWith('# Weekly Retro'), true);

console.log(JSON.stringify({
  ok: true,
  skill: s.name,
  bytes: Buffer.byteLength(s.content),
  root: s.resourceBase.path,
  routes: routes.filter((x) => x.startsWith('/dsh-weekly-retro')).length,
}));
