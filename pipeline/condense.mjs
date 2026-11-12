#!/usr/bin/env node
// 把 digest.json 压成一份「分析包」packet.md：给模型读的工作流上下文，不调模型、不存正文。
// 用法: node condense.mjs [--budget=24000] [--check]
//   --check  只校验 digest 是否 ≥v2 且字段齐全（手动排查用；run-weekly 不再调用），不写文件
//
// 分配策略（自适应，不是固定截断）：
//   1) 先给每个主会话一个「简版」块（3 条诉求 + 3 条轮骨架 + 命令/产物摘要）
//   2) 剩余预算按轮数从高到低，把会话逐个升级成「富版」（7 条诉求 + 12 条骨架 + 更多产物）
//   3) 简版都塞不下时，逐步压低简版参数；仍超则硬截断并明确声明
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readHistory, trendOf } from './history.mjs';
import { writeFileAtomic } from './atomic-write.mjs';

const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
const argv = process.argv.slice(2);
const BUDGET = Number((argv.find((a) => a.startsWith('--budget=')) || '--budget=24000').split('=')[1]);
if (!Number.isFinite(BUDGET) || BUDGET < 1000) { console.error(`--budget 非法（需 ≥1000 的数字）`); process.exit(2); }
const CHECK_ONLY = argv.includes('--check');

const d2 = (n) => String(n).padStart(2, '0');
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d2(d.getMonth() + 1)}-${d2(d.getDate())} ${d2(d.getHours())}:${d2(d.getMinutes())}`;
};
const home = (p) => String(p || '').replace(os.homedir(), '~');
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

// ---------- 读入 ----------
let digest;
try {
  digest = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'digest.json'), 'utf8'));
} catch (e) {
  console.error(`❌ 读不到 digest.json：${e.message}\n先跑 node collect.mjs`);
  process.exit(1);
}
const S = Array.isArray(digest.sessions) ? digest.sessions : [];
const V2 = (digest.schema || 1) >= 2 && S.some((s) => Array.isArray(s.turnShapes));

if (CHECK_ONLY) {
  const miss = [];
  if (!S.length) miss.push('sessions 为空');
  if (!(digest.schema >= 2)) miss.push('schema < 2（旧 digest，请重跑 collect.mjs）');
  if (S.length && !S.some((s) => Array.isArray(s.turnShapes))) miss.push('turnShapes 缺失');
  if (S.length && !S.some((s) => Array.isArray(s.intentMessages))) miss.push('intentMessages 缺失');
  if (miss.length) { console.error(`❌ digest 校验失败：${miss.join('；')}`); process.exit(1); }
  console.log(`✅ digest v2 校验通过：${S.length} 会话，${S.reduce((a, s) => a + (s.turnShapes || []).length, 0)} 条轮骨架`);
  process.exit(0);
}

let decisions = [];
try { decisions = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'decisions.json'), 'utf8')).decisions || []; } catch {}
// 优先用 key（与 findings 同一口径）；老数据只有 candidate 时才退回简写
const landed = [...new Set(decisions.map((d) => String(d.key || d.candidate || '').trim()).filter(Boolean))];

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};
const parsedNow = new Date(digest.windowEnd || digest.generatedAt || Date.now());
const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
// 回填（窗口终点明显在过去）时不要把本周的 packet.md 覆盖成旧周内容
// 回填判定只认显式开关（DSH_WINDOW_END）：否则历史 digest 重放也会误判成回填
const isBackfill = !!process.env.DSH_WINDOW_END;
const week = isoWeek(now);

// ---------- 排序与热力 ----------
const main = S.filter((s) => s.origin === 'user').sort((a, b) => b.turns - a.turns);
const subs = S.filter((s) => s.origin !== 'user').sort((a, b) => b.turns - a.turns);
const toolHeat = {}, cmdHeat = {};
for (const s of S) for (const [n, c] of Object.entries(s.tools || {})) toolHeat[n] = (toolHeat[n] || 0) + c;
for (const s of S) for (const c of s.cmdClusters || []) cmdHeat[c.cmd] = (cmdHeat[c.cmd] || 0) + c.n;
const hourHeat = new Array(24).fill(0);
for (const s of S) for (let i = 0; i < 24; i++) hourHeat[i] += (s.hourHits || [])[i] || 0;
const rank = (m, n, f) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(f).join(' · ');

const intentOf = (s) => (s.intentMessages?.length ? s.intentMessages : [...(s.userMessages || []), ...(s.recentMessages || [])]);
const allShapes = (s) => (Array.isArray(s.turnShapes) ? s.turnShapes : []);

// ---------- 头部与全局 ----------
function header(alloc) {
  return [
    `# 周报分析包 · ${week}`,
    '',
    `生成 ${now.toLocaleString('zh-CN', { hour12: false }).slice(0, 16)} · 窗口 ${digest.windowDays || 7} 天 · digest schema ${digest.schema || 1}`,
    `会话 ${S.length}（主 ${main.length} / 被委派 ${subs.length}）· 主会话轮数 ${main.reduce((a, s) => a + s.turns, 0)}`,
    ...(digest.skippedFiles ? [`⚠️ ${digest.skippedFiles} 个会话文件无法解析（数据不完整；归档态会话不计入此项）`] : []),
    `预算分配：富 ${alloc.rich} / 简 ${alloc.simple} · 预算 ${BUDGET} 字符${alloc.level ? ` · ${alloc.level}` : ''}`,
    `已落地候选（不要重复推荐）：${landed.length ? landed.join('、') : '无'}`,
    '',
    '> 本包只含：用户诉求、每轮工具骨架、命令聚类、写入产物。不含 assistant 正文、工具输出、文件内容。',
    '> **看不到 ≠ 没发生**；证据不足时明确写「证据不足」，不要补全成故事。',
  ].join('\n');
}

// 技能遥测：库有多大、本周真用了哪些、失败几次
function skillHeatLines() {
  const used = {};
  let fails = 0;
  for (const s of S) {
    for (const [k, v] of Object.entries(s.skillsCalled || {})) used[k] = (used[k] || 0) + v;
    for (const v of Object.values(s.skillFails || {})) fails += v;
  }
  const lib = digest.skillLibraryCount || 0;
  const names = Object.keys(used);
  if (!names.length && !lib) return [];
  const top = Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(' · ') || '（本周没有显式调用技能）';
  return [`- 技能：${top}${lib ? ` · 库 ${lib} 个里用到 ${names.length} 个` : ''}${fails ? ` · 失败 ${fails} 次` : ''}`];
}

// 跨周趋势：把前几周的结论作为这一周的输入（只标注，不自动改分级）
function trendBlock() {
  const rows = readHistory(WEEKLY);
  const t = trendOf(rows, week);
  const prev = t.prev;
  if (!prev.length) return '';
  const lines = ['## 跨周趋势（前几周记忆）', ''];
  const brief = prev.slice(-4).map((r) => `${r.week}: ${r.mainSessions} 主会话/${r.turns} 轮 · 候选 ${(r.candidates || []).length} · 重复 ${(r.repeats || []).length}`);
  lines.push(`- 已有记忆：${brief.join('；')}`);
  const cands = [...t.candWeeks.entries()].slice(0, 12).map(([k, v]) => `${k}（${v.lastWeek} 判 ${v.last}）`);
  if (cands.length) lines.push(`- 提过的候选（别当新发现；要提就写清这周多出的证据）：${cands.join('、')}`);
  const reps = [...t.repeatWeeks.entries()].filter(([, ws]) => ws.length).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  if (reps.length) lines.push(`- 出现过的重复模式：${reps.map(([k, ws]) => `${k}（${ws.join('/')}）`).join('、')}`);
  lines.push('- 规则：只标注复现，不自动提级；是否提级由用户拍板。');
  return lines.join('\n');
}

// 上下文侧热力（借鉴 dsh-context 的事件视角：模型、压缩、按天）
function ctxHeatLines() {
  const out = [];
  const models = {};
  let compTotal = 0, windowHi = 0;
  for (const s of S) {
    if (s.model) models[s.model] = (models[s.model] || 0) + 1;
    compTotal += s.compactions || 0;
    windowHi = Math.max(windowHi, s.contextWindow || 0);
  }
  if (Object.keys(models).length) out.push(`- 模型：${Object.entries(models).map(([m, n]) => `${m}×${n}`).join(' · ')}${windowHi ? ` · 上下文窗口上限 ${(windowHi / 1024).toFixed(0)}k` : ''}`);
  if (compTotal) out.push(`- 上下文压缩合计：${compTotal} 次（被压缩说明单次任务撑爆过窗口）`);
  const days = {};
  for (const s of S) for (const [d, n] of Object.entries(s.dayHits || {})) days[d] = (days[d] || 0) + n;
  const dayStr = Object.entries(days).sort().map(([d, n]) => `${d.slice(5)}:${n}`).join(' ');
  if (dayStr) out.push(`- 按天事件量：${dayStr}`);
  return out;
}

function globalBlock() {
  const ws = Object.entries(digest.byWorkspace || {})
    .map(([k, w]) => `${home(k)}（${w.sessions} 会话/${w.turns} 轮）`).join('；') || '无';
  return [
    '## 全局热力',
    '',
    `- 工作区：${ws}`,
    `- 工具：${rank(toolHeat, 12, ([k, v]) => `${k}×${v}`)}`,
    `- 命令：${rank(cmdHeat, 12, ([k, v]) => `${k}×${v}`)}`,
    `- 活跃时段：${hourHeat.map((v, i) => (v ? `${d2(i)}:${v}` : '')).filter(Boolean).join(' ')}`,
    ...ctxHeatLines(),
    ...skillHeatLines(),
  ].join('\n');
}

// ---------- 会话块 ----------
function shapeLines(s, cap, len) {
  const rows = allShapes(s);
  if (!cap || !rows.length) return [];
  let pick;
  if (rows.length <= cap) pick = rows.map((r, i) => [i + 1, r]);
  else pick = [...rows.slice(0, cap - 2).map((r, i) => [i + 1, r]), [0, `…省略 ${rows.length - cap} 轮…`], ...rows.slice(-2).map((r, i) => [rows.length - 1 + i, r])];
  return pick.map(([i, r]) => `  ${i ? `t${i}` : '  '}: ${trim(r, len)}`);
}

function sessionBlock(s, P) {
  const out = [];
  out.push(`### ${P.rich ? '★' : '·'} ${s.title || '(无标题)'}`);
  const tools = Object.values(s.tools || {}).reduce((a, b) => a + b, 0);
  const ctxBits = [
    s.steps ? `步 ${s.steps}` : '',
    s.model ? `模型 ${s.model}` : '',
    s.compactions ? `压缩 ${s.compactions} 次` : '',
  ].filter(Boolean).join(' · ');
  out.push(`- 元信息：${s.id} · ${fmt(s.created)} → ${fmt(s.last)} · ${s.turns} 轮 · 工具 ${tools} 次${s.errors ? ` · 错误 ${s.errors}` : ''}${ctxBits ? ` · ${ctxBits}` : ''}`);
  if (s.preWindowTurns) out.push(`- 窗口外历史：${s.preWindowTurns} 轮（archive，本包未含其诉求与骨架 —— 别把整段会话当本周）`);
  const intents = intentOf(s);
  const pick = intents.slice(0, P.intents);
  out.push(`- 用户诉求（${pick.length}/${intents.length}）：`);
  for (const [j, m] of pick.entries()) out.push(`  ${j + 1}. ${trim(m, P.intentLen)}`);
  const cmds = (s.cmdClusters || []).slice(0, P.cmds);
  if (cmds.length) out.push(`- 命令：${cmds.map((c) => `${c.cmd}×${c.n}`).join(' · ')}`);
  const files = (s.filesWritten || []).slice(0, P.files);
  if (files.length) out.push(`- 写入产物：${files.map((f) => `${path.basename(f.path)}×${f.n}`).join(' · ')}`);
  const shapes = shapeLines(s, P.shapes, P.shapeLen);
  if (shapes.length) out.push(`- 轮骨架（${allShapes(s).length} 轮）：`, ...shapes);
  return out.join('\n');
}

function subsBlock(cap) {
  if (!subs.length) return '';
  const list = subs.slice(0, cap).map((s) => {
    const t = rank(s.tools || {}, 3, ([k, v]) => `${k}×${v}`);
    const f = allShapes(s)[0];
    return `- ${s.title || '(无标题)'} · ${s.turns} 轮 · ${t}${f ? ` · 首轮 ${trim(f, 90)}` : ''}`;
  });
  return [`## 被委派的子会话（${subs.length} 个）`, '', ...list].join('\n');
}

const SIMPLE = { rich: false, intents: 3, intentLen: 120, shapes: 3, shapeLen: 120, cmds: 4, files: 2 };
const RICH = { rich: true, intents: 7, intentLen: 150, shapes: 12, shapeLen: 140, cmds: 8, files: 4 };

function assemble(richIds, simpleP = SIMPLE, subsCap = 20) {
  const body = main.map((s) => sessionBlock(s, richIds.has(s.id) ? RICH : simpleP)).join('\n\n');
  const sub = subsBlock(subsCap);
  return { body, sub };
}

// ---------- 预算分配 ----------
const head = header({ rich: 0, simple: main.length });
const glob = globalBlock();
const trendTxt = trendBlock();
const fixedLen = head.length + glob.length + (trendTxt ? trendTxt.length + 2 : 0) + 2;

let simpleP = { ...SIMPLE };
let subsCap = 20;
let assembled = assemble(new Set(), simpleP, subsCap);
let level = '';
// 简版塞不下 → 逐档压低（最多 5 档），让每个主会话至少留下痕迹
const LADDER = [
  { intents: 3, intentLen: 100, shapes: 2, shapeLen: 100, cmds: 3, files: 1, subsCap: 14 },
  { intents: 2, intentLen: 90, shapes: 1, shapeLen: 90, cmds: 2, files: 1, subsCap: 10 },
  { intents: 2, intentLen: 70, shapes: 0, shapeLen: 0, cmds: 2, files: 1, subsCap: 8 },
  { intents: 1, intentLen: 70, shapes: 0, shapeLen: 0, cmds: 1, files: 0, subsCap: 5 },
];
for (let i = 0; fixedLen + assembled.body.length + assembled.sub.length > BUDGET && i < LADDER.length; i++) {
  const L = LADDER[i];
  simpleP = { ...SIMPLE, ...L };
  subsCap = L.subsCap;
  assembled = assemble(new Set(), simpleP, subsCap);
  level = `简版压到第 ${i + 1} 档`;
}

// 升级：按轮数从高到低，能塞下就升级
const richOrder = [];
for (const s of main) {
  if (s.turns < 2) continue;
  const next = new Set(richOrder).add(s.id);
  const trial = assemble(next, simpleP, subsCap);
  if (fixedLen + trial.body.length + trial.sub.length <= BUDGET) richOrder.push(s.id);
}

// 用真实分配数重建头部（头部里的「富/简」会变长度），超预算就退回最后一个富版
const buildText = () => {
  const richIds = new Set(richOrder);
  const h = header({ rich: richIds.size, simple: main.length - richIds.size, level });
  const a = assemble(richIds, simpleP, subsCap);
  return [h, glob, trendTxt, '', a.body, '', a.sub].filter((x) => x !== '').join('\n\n');
};
// 体积/成本行也占字符：拼装→回填→再判预算，超了就退一个富版，而不是把正文砍掉
const decorate = (body, truncated) => {
  const kb = (body.length / 1024).toFixed(1);
  const est = Math.round(body.length / 2.8);
  let t = body.replace(/(预算分配：[^\n]*)/, `$1 · 体积 ${kb}KB（≈${est} tokens 估算）${truncated ? ' · 已硬截断' : ''}`);
  if (!V2) t = t.replace(/(会话 \d+（主[^\n]*)/, '$1\n⚠️ digest 为 v1：缺轮骨架，建议重跑 collect.mjs');
  return t;
};
let text = decorate(buildText(), false);
while (text.length > BUDGET && richOrder.length) {
  richOrder.pop();
  text = decorate(buildText(), false);
}
let truncated = false;
if (text.length > BUDGET) {
  // 迭代收缩：每轮按当前超出量再砍，保证最终 ≤ 预算（旧实现 decorate 后仍超 35 字符）
  let body = buildText();
  text = decorate(body, true);
  for (let i = 0; i < 20 && text.length > BUDGET; i++) {
    body = body.slice(0, Math.max(0, body.length - (text.length - BUDGET) - 2));
    text = decorate(body, true);
  }
  if (text.length > BUDGET) {
    const note = `\n\n> [硬截断] 已按 ${BUDGET} 字符预算截断。\n`;
    text = decorate(text, true).slice(0, Math.max(0, BUDGET - note.length)) + note;
  }
  truncated = true;
}
const est = Math.round(text.length / 2.8);
const kb = (text.length / 1024).toFixed(1);

fs.mkdirSync(WEEKLY, { recursive: true });
writeFileAtomic(path.join(WEEKLY, `packet-${week}.md`), text);
if (!isBackfill) writeFileAtomic(path.join(WEEKLY, 'packet.md'), text);
else console.error(`[condense] 回填模式：只写 packet-${week}.md，未覆盖 packet.md`);
console.log(`[condense] ${week} · ${S.length} 会话 → ${path.join(WEEKLY, 'packet.md')}`);
console.log(`[condense] 富 ${richOrder.length} / 简 ${main.length - richOrder.length}${level ? ` · ${level}` : ''}${truncated ? ' · 硬截断' : ''} · ${text.length} 字符 / 预算 ${BUDGET} · ≈${est} tokens · ${kb}KB`);
