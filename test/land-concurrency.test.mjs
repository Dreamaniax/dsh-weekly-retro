// S 审计 P1 回归：10 个独立进程同时 land 不同 key，必须 10/10 落盘。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-land-'));
const weekly = path.join(tmp, 'weekly');
fs.mkdirSync(weekly, { recursive: true });
const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
fs.writeFileSync(path.join(weekly, 'proposals.json'), JSON.stringify({
  week: '2026-W46',
  proposals: keys.map((k) => ({ key: k, title: `候选${k}`, verdict: 'skill' })),
}));
fs.writeFileSync(path.join(weekly, 'decisions.json'), JSON.stringify({ decisions: [] }));

const dataUrl = new URL('../lib/data.js', import.meta.url).href;
const child = `
const m = await import(process.env.DATA_URL);
const r = await m.land(process.env.KEY, { sync: false });
process.stdout.write(JSON.stringify(r));
`;

let ok = 0;
await Promise.all(keys.map((k) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--input-type=module', '-e', child], {
    env: { ...process.env, DSH_LEARNING: tmp, DATA_URL: dataUrl, KEY: k },
  });
  let out = '';
  let err = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { err += b; });
  p.on('close', (code) => {
    try { if (code === 0 && JSON.parse(out).ok) ok += 1; else if (code !== 0) console.error('[child]', k, code, err.slice(0, 200)); } catch {}
    resolve();
  });
})));

const dec = JSON.parse(fs.readFileSync(path.join(weekly, 'decisions.json'), 'utf8'));
const landed = new Set(dec.decisions.map((d) => d.key));
const missing = keys.filter((k) => !landed.has(k));
fs.rmSync(tmp, { recursive: true, force: true });

assert.equal(ok, 10, `子进程成功数 ${ok}/10`);
assert.equal(dec.decisions.length, 10, `落盘 ${dec.decisions.length}/10，缺 ${missing.join(',') || '无'}`);
assert.deepEqual(missing, []);
console.log(JSON.stringify({ ok: true, processes: 10, landed: dec.decisions.length, lost: 0 }));
