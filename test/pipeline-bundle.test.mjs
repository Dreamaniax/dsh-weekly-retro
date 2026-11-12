// 发布包自包含：确定性流水线必须随包，且在用户没有 ~/.dsh/learning/scripts 时回退到内置 pipeline/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const need = ['run-weekly.sh','collect.mjs','condense.mjs','report.mjs','report-html.mjs','check-findings.mjs','findings-lib.mjs','atomic-write.mjs','findings.template.json'];
for (const f of need) assert.ok(fs.existsSync(path.join(root, 'pipeline', f)), `缺少内置脚本 pipeline/${f}`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok(pkg.files.includes('pipeline'), 'package.json files 必须包含 pipeline');

const tmp = fs.mkdtempSync('/tmp/dsh-bundle-test-');
const out = execFileSync(process.execPath, ['--input-type=module', '-e', "import { SCRIPTS } from './lib/data.js'; console.log(SCRIPTS);"], {
  cwd: root,
  env: { ...process.env, DSH_LEARNING: tmp, DSH_WEEKLY_SCRIPTS: '' },
  encoding: 'utf8',
});
fs.rmSync(tmp, { recursive: true, force: true });
assert.ok(out.trim().endsWith('/pipeline'), `无本机脚本时应回退内置 pipeline，实际：${out.trim()}`);
console.log(JSON.stringify({ ok: true, bundled: need.length, fallback: 'pipeline' }));
