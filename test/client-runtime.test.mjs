// client 运行时沙箱：真正执行宿主 ModuleLoader 工厂，断言导出与 slot 注册。
// 这道门专门拦“语法正确、运行到才炸”的 client 错误（import failed: exports is not defined）。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// 假 React：只提供模块级用到的 API（渲染不执行）
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  Fragment: 'Fragment',
};

const loaders = [];
const fakeWindow = { __ModuleLoader__: { load: (def) => loaders.push(def) } };

// 模拟宿主加载：脚本顶层调用 window.__ModuleLoader__.load({id,factory})
new Function('window', 'require', src)(fakeWindow, () => React);

assert.equal(loaders.length, 1, 'client.js 必须且只能调用一次 __ModuleLoader__.load');
const def = loaders[0];
assert.equal(def.id, 'dsh-weekly-retro', 'ModuleLoader id 必须是包名');
assert.equal(typeof def.factory, 'function');

const mod = def.factory(() => React);
assert.equal(typeof mod.apply, 'function', '必须导出 apply');
assert.deepEqual(mod.inject, ['slots', 'locale'], 'client inject 必须是短服务名 slots + locale');
assert.ok(Array.isArray(mod.inject) && mod.inject.length > 0, 'inject 不能为空');

// apply 必须能在 stub ctx 上完成三个 slot 注册（真实宿主缺 slots 时也只 warn 不抛）
const registered = [];
const ctx = {
  slots: {
    inject: (name, fn) => { fn(); },
    register: (opts) => { registered.push(opts.name); return () => {}; },
  },
};
mod.apply(ctx);
assert.deepEqual(registered.sort(), [
  'main',
  'sidebar.panellist',
]);

// slots 缺失时 apply 不得抛（面板坏掉不能拖垮宿主）
const mod2 = def.factory(() => React);
assert.doesNotThrow(() => mod2.apply({ slots: undefined }));

console.log(JSON.stringify({ ok: true, id: def.id, exports: ['apply', 'inject'], slots: registered.length }));
