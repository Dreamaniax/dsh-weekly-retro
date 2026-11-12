#!/usr/bin/env node
// 跨机合并 history.jsonl（脱敏副本）：按周 union，同一周保留 generatedAt 较新的一条。
// 用法: node history-merge.mjs [本地路径] [仓库副本路径]
//   默认：~/.dsh/learning/weekly/history.jsonl 与 <repo>/weekly/history.jsonl
//   DSH_HISTORY_LOCAL / DSH_HISTORY_REPO 可覆盖
// 行为：把合并结果写回两边（内容没变就不写），打印合并摘要；两侧都可缺失。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = process.argv[2]
  || process.env.DSH_HISTORY_LOCAL
  || path.join(process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning'), 'weekly', 'history.jsonl');
// 仓库副本要真的落到 dsh-config 里：按 land-sync 同款路径探测，再退回脚本同级（播种副本）
const REPO_DIRS = [
  path.join(os.homedir(), 'dsh-config'),
  path.join(os.homedir(), 'Documents', 'deepseek-harness', 'dsh-config'),
].filter((d) => fs.existsSync(path.join(d, '.git')));
const REPO = process.argv[3]
  || process.env.DSH_HISTORY_REPO
  || (REPO_DIRS[0] ? path.join(REPO_DIRS[0], 'weekly', 'history.jsonl') : path.join(HERE, 'history.jsonl'));

function read(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function merge(a, b) {
  const byWeek = new Map();
  for (const r of [...a, ...b]) {
    if (!r || !r.week) continue;
    const prev = byWeek.get(r.week);
    if (!prev) { byWeek.set(r.week, r); continue; }
    const pa = Date.parse(prev.generatedAt || 0) || 0;
    const pb = Date.parse(r.generatedAt || 0) || 0;
    if (pb >= pa) byWeek.set(r.week, r);   // 同一周取较新的一条，避免半成品覆盖完整版
  }
  return [...byWeek.values()].sort((x, y) => String(x.week).localeCompare(String(y.week)));
}

const serialize = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

const local = read(LOCAL);
const repo = read(REPO);
const merged = merge(local, repo);
const text = serialize(merged);

// 三个目标：本机 canonical、仓库副本、部署目录里的播种副本（存在才刷，保证换机播种是最新的）
const SEED = path.join(HERE, 'history.jsonl');
const targets = [[LOCAL, local], [REPO, repo]];
if (fs.existsSync(SEED) && SEED !== REPO) targets.push([SEED, read(SEED)]);

const wrote = [];
for (const [file, rows] of targets) {
  const before = serialize(rows);
  if (text && before !== text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    wrote.push(file);
  }
}

console.log(`[history-merge] 本地 ${local.length} 周 · 仓库 ${repo.length} 周 → 合并 ${merged.length} 周`);
console.log(`[history-merge] 周：${merged.map((r) => r.week).join(', ') || '（空）'}`);
console.log(`[history-merge] ${wrote.length ? '已写：' + wrote.map((f) => path.basename(f)).join(' + ') : '两侧已一致，未写'}`);
