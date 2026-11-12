#!/usr/bin/env node
// 校验 findings.json（周报分析环节的产物）。不通过 → 退出码 1，报告环节会回退旧规则。
// 用法:
//   node check-findings.mjs                # 校验 ~/.dsh/learning/weekly/findings.json
//   node check-findings.mjs path/to.json   # 校验指定文件
//   node check-findings.mjs --list         # 列出本周 digest 里的会话 id（方便填 evidenceSessions）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateFindings } from './findings-lib.mjs';

const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
const argv = process.argv.slice(2);

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

let digest;
try {
  digest = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'digest.json'), 'utf8'));
} catch (e) {
  console.error(`❌ 读不到 digest.json：${e.message}（先跑 collect.mjs）`);
  process.exit(1);
}
const week = isoWeek(new Date(digest.windowEnd || digest.generatedAt || Date.now()));
const sessions = digest.sessions || [];

if (argv.includes('--list')) {
  console.log(`本周 ${week} · ${sessions.length} 个会话（${sessions.filter((s) => s.origin === 'user').length} 主会话）`);
  for (const s of sessions.filter((x) => x.origin === 'user').sort((a, b) => b.turns - a.turns)) {
    console.log(`${s.id}\t${s.turns}轮\t${(s.title || '(无标题)').slice(0, 40)}`);
  }
  process.exit(0);
}

const file = argv.find((a) => !a.startsWith('-')) || path.join(WEEKLY, 'findings.json');
let findings;
try {
  findings = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`❌ 读不到 ${file}：${e.message}`);
  process.exit(1);
}

const errs = validateFindings(findings, { week, sessionIds: sessions.map((s) => s.id) });
const cands = (findings && Array.isArray(findings.candidates)) ? findings.candidates : [];
const byShape = {};
for (const c of cands) byShape[c.verdict] = (byShape[c.verdict] || 0) + 1;

if (errs.length) {
  console.error(`❌ findings 校验失败（${errs.length} 个问题）· 文件 ${file}`);
  for (const e of errs) console.error(`   - ${e}`);
  console.error('\n报告环节遇到这种 findings 会直接回退旧规则并在周报里写明原因。');
  process.exit(1);
}

console.log(`✅ findings 合法 · ${week} · 文件 ${file}`);
console.log(`   画像 ${(findings.portrait || []).length} 条 · 重复清单 ${(findings.repeats || []).length} 条 · 候选 ${cands.length} 条（${Object.entries(byShape).map(([k, v]) => `${k}×${v}`).join(' / ') || '无'}）`);
const plugins = cands.filter((c) => c.verdict === 'plugin');
if (plugins.length) console.log(`   插件候选 ${plugins.length} 条：${plugins.map((p) => `${p.key}(${p.plugin_spec?.trigger}, ${p.persist ? '常驻' : '按需'})`).join('、')}`);
process.exit(0);
