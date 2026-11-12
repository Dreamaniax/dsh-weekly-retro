#!/usr/bin/env node
// 把 digest + proposals 渲染成单文件 HTML 周报（可视化 + 候选解释/成色 + checklist）。
// 用法: node report-html.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeFileAtomic } from './atomic-write.mjs';

const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
let digest;
try {
  digest = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'digest.json'), 'utf8'));
} catch (e) {
  console.error(`❌ 读不到或解析不了 digest.json：${e.message}`);
  process.exit(2);
}
// 回填模式只写 <周>.proposals.json：优先读该周自己的，避免把本周候选画进旧周页面
const digestWeek = isoWeek(new Date(digest.windowEnd || digest.generatedAt));
const weekProp = path.join(WEEKLY, `${digestWeek}.proposals.json`);
const propFile = fs.existsSync(weekProp) ? weekProp : path.join(WEEKLY, 'proposals.json');
const props = fs.existsSync(propFile) ? JSON.parse(fs.readFileSync(propFile, 'utf8')) : { week: '?', proposals: [], corrections: 0 };

const parsedNow = new Date(digest.windowEnd || digest.generatedAt);
const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
// 回填判定只认显式开关（DSH_WINDOW_END）：否则历史 digest 重放也会误判成回填
const isBackfill = !!process.env.DSH_WINDOW_END;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (p) => String(p).replace(os.homedir(), '~');

// ---------- findings 模式：没有 findings 时页面必须与旧版逐字节一致 ----------
const F = props.findings || null;
const hasF = !!F;
const N = hasF
  ? { ws: 1, portrait: 2, repeats: 3, tools: 4, files: 5, cand: 6, corr: 7 }
  : { ws: 1, tools: 2, files: 3, cand: 4, corr: 5 };

const portraitCards = hasF ? (F.portrait || []).map((p) => `
  <div class="pcard">
    <div class="pmain">${esc(p.mainline || '（未命名主线）')}</div>
    ${p.goal ? `<div class="pgoal">目标：${esc(p.goal)}</div>` : ''}
    ${p.outputs && p.outputs.length ? `<div class="pout">产出：${p.outputs.map((o) => `<code>${esc(o)}</code>`).join(' ')}</div>` : ''}
    ${p.sessions && p.sessions.length ? `<div class="pevid">依据会话：${p.sessions.length} 个</div>` : ''}
  </div>`).join('') : '';

const repeatsTable = hasF && (F.repeats || []).length
  ? `<div class="panel"><table>
    <thead><tr><th>重复动作</th><th style="width:64px">次数</th><th>每次成本</th><th>建议形态</th><th style="width:88px">依据会话</th></tr></thead>
    <tbody>${F.repeats.map((r) => `<tr><td>${(r.weeks && r.weeks.length) ? `<span class="rep">🔁 第 ${r.weeks.length + 1} 周</span> ` : ''}${esc(r.pattern)}</td><td>${(r.count)}</td><td>${esc(r.cost || '—')}</td><td>${esc(r.status || '—')}</td><td>${(r.evidence || []).length}</td></tr>`).join('')}</tbody>
  </table></div>`
  : '<div class="empty">分析环节未识别到稳定重复动作</div>';

const findingsSections = hasF ? `
<section>
  <h2>${N.portrait} · 本周工作流画像</h2>
  <p class="sub">由分析环节从 ${digest.totalSessions} 个会话的诉求与工具骨架归纳，每条都能回溯到具体会话。</p>
  ${portraitCards || '<div class="empty">分析环节未产出画像</div>'}
</section>

<section>
  <h2>${N.repeats} · 重复劳动清单</h2>
  <p class="sub">同类动作重复出现、且能固定成流程的那些。形态建议：script（进流水线）/ skill / rule / plugin。</p>
  ${repeatsTable}
</section>` : '';

const extraCss = hasF ? `
.stats.five{grid-template-columns:repeat(5,1fr)}
.ghead{font-size:13px;color:#aab3c8;margin:22px 0 10px;font-weight:700;display:flex;align-items:center;gap:8px}
.gcount{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.08);color:#8b95ad;font-weight:600}
.pcard{padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));margin-bottom:10px}
.pmain{font-size:14.5px;font-weight:700;margin-bottom:6px}
.pgoal{font-size:13px;color:#aab3c8;margin-bottom:4px}
.pout{font-size:12.5px;color:#8b95ad;margin-bottom:4px}
.pevid{font-size:11.5px;color:#6b7590}
.pspec{font-size:12.5px;color:#c6cfe2;background:rgba(124,92,255,.08);border-left:2px solid rgba(124,92,255,.45);padding:6px 10px;border-radius:0 8px 8px 0;margin-bottom:8px}
.evidsub{font-size:11.5px;color:#6b7590;margin:-4px 0 8px}
.v-plugin{background:rgba(124,92,255,.16);color:#c4b5fd}
.v-sched{background:rgba(56,189,248,.14);color:#7dd3fc}
.v-watch{background:rgba(244,114,182,.14);color:#f9a8d4}
.rep{display:inline-block;font-size:11px;padding:1px 6px;border-radius:6px;background:rgba(251,191,36,.14);color:#fcd34d;margin-right:6px}
@media(max-width:820px){.stats.five{grid-template-columns:1fr 1fr}}` : '';

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
const week = props.week && props.week !== '?' ? props.week : isoWeek(now);

const S = digest.sessions;
const toolRank = {};
for (const s of S) for (const [n, c] of Object.entries(s.tools)) toolRank[n] = (toolRank[n] || 0) + c;
const topTools = Object.entries(toolRank).sort((a, b) => b[1] - a[1]).slice(0, 10);
const maxTool = topTools[0]?.[1] || 1;

const fileRank = {};
for (const s of S) for (const f of s.filesWritten) fileRank[f.path] = (fileRank[f.path] || 0) + f.n;
const topFiles = Object.entries(fileRank).sort((a, b) => b[1] - a[1]).slice(0, 10);

const wsRows = Object.entries(digest.byWorkspace).map(([ws, w]) => {
  const mains = S.filter((s) => (s.cwd || '') === ws && s.origin === 'user').length;
  return `<tr><td><code>${esc(short(ws))}</code></td><td>${mains}</td><td>${w.sessions - mains}</td><td>${w.turns}</td><td>${w.userMessages}</td>
  <td>${w.topTools.slice(0, 3).map(([n, c]) => `${esc(n)}×${c}`).join(' · ')}</td></tr>`;
}).join('');

const toolBars = topTools.map(([n, c]) => `
  <div class="barrow"><span class="bl">${esc(n)}</span><span class="bar"><i style="width:${(c / maxTool * 100).toFixed(1)}%"></i></span><span class="bv">${c}</span></div>`).join('');

const VERDICT = {
  skill: { label: '✅ 做成技能', cls: 'v-skill', hint: '有触发词、输入输出稳定、可内置校验' },
  'skill-lite': { label: '🟡 轻量技能', cls: 'v-lite', hint: '值得沉淀，但触发词不够稳定' },
  rule: { label: '📝 写成规则', cls: 'v-rule', hint: '本质是纪律，写 AGENTS.md 更有效' },
  plugin: { label: '🔌 做成插件', cls: 'v-plugin', hint: '需要确定性的工具入口或原生能力' },
  schedule: { label: '⏰ 定时任务', cls: 'v-sched', hint: '按时间自动跑，交给调度比让模型记住可靠' },
  watcher: { label: '👀 监听 watcher', cls: 'v-watch', hint: '响应外部事件，需常驻，成本高' },
  skip: { label: '⏸ 先观察', cls: 'v-skip', hint: '频率或可验收性不足' },
};
const dots = (n) => Array.from({ length: 2 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

const makeCard = (p, i) => {
  const v = VERDICT[p.verdict] || VERDICT.skip;
  const s = p.scores || { freq: 0, trigger: 0, capability: 0, verifiable: 0 };
  const steps = (p.steps || []).map((x, k) => `<li>${esc(x)}</li>`).join('');
  const card = `
  <label class="cand" data-i="${i + 1}">
    <input type="checkbox" class="cb" />
    <div class="cbody">
      <div class="chead">
        <span class="idx">${i + 1}</span><b>${esc(p.title)}</b>
        <span class="verdict ${v.cls}">${v.label}</span>
        <span class="score">成色 ${p.total}/8</span>
      </div>
      <p class="what">${esc(p.what)}</p>
      <div class="evid"><span>本周依据</span>${esc(p.evidence)}</div>
      <ol class="steps">${steps}</ol>
      <div class="scores">
        <span>频率 ${dots(s.freq)}</span><span>触发可预测 ${dots(s.trigger)}</span><span>新增能力 ${dots(s.capability)}</span><span>可自动验收 ${dots(s.verifiable)}</span>
      </div>
      <div class="verdictwhy">${esc(p.verdictWhy)}</div>
      <div class="meta">预计收益：${esc(p.saving)}　·　落地成本：${esc(p.effort)}</div>
    </div>
  </label>`;
  // 只在 findings 模式才追加这两行（旧页面一个字节都不动）
  const extra = [
    p.evidenceSessions && p.evidenceSessions.length ? `<div class="evidsub">依据会话：${p.evidenceSessions.length} 个（可回溯）</div>` : '',
    p.plugin_spec ? `<div class="pspec">插件形态：<b>${esc(p.plugin_spec.trigger)}</b>${p.persist ? '（常驻）' : '（按需触发）'}${p.plugin_spec.minimal_scope ? `　最小范围：${esc(p.plugin_spec.minimal_scope)}` : ''}</div>` : '',
  ].filter(Boolean).join('');
  return extra ? card.replace('<div class="evid">', extra + '\n      <div class="evid">') : card;
};

const GROUP_DEF = [
  { key: 'skill', title: '✅ 技能', hint: '一次会话内跑完、靠模型执行' },
  { key: 'rule', title: '📝 规则', hint: '本质是纪律，写进 AGENTS.md' },
  { key: 'plugin', title: '🔌 插件', hint: '需要确定性入口或原生能力' },
  { key: 'other', title: '⏰ 定时 / 👀 监听', hint: '按时间或外部事件触发，注意常驻成本' },
  { key: 'skip', title: '⏸ 先观察', hint: '频率或可验收性不足' },
];
const groupOf = (p) => {
  const v = p.verdict || '';
  const sh = p.shape || '';
  if (v === 'plugin' || sh === 'plugin') return 'plugin';
  if (v === 'rule' || sh === 'rule') return 'rule';
  if (['skill', 'skill-lite'].includes(v) || sh === 'skill') return 'skill';
  if (['schedule', 'watcher'].includes(v) || ['schedule', 'watcher'].includes(sh)) return 'other';
  return 'skip';
};
const entries = (props.proposals || []).map((p) => ({ p }));
// 分组模式按「分组顺序」重新编号，避免卡片上的号码与视觉顺序打架
const ordered = hasF
  ? GROUP_DEF.flatMap((g) => entries.filter((e) => groupOf(e.p) === g.key))
  : entries;
const cards = ordered.map((e, idx) => ({ ...e, html: makeCard(e.p, idx) }));
const EMPTY_CAND = '<div class="empty">本周数据不足，没有候选</div>';
const groupedCards = GROUP_DEF.map((g) => {
  const items = cards.filter((c) => groupOf(c.p) === g.key);
  if (!items.length) return '';
  return `<h3 class="ghead">${g.title}<span class="gcount">${items.length}</span></h3>\n${items.map((c) => c.html).join('')}`;
}).join('');
const candCards = hasF ? (groupedCards || EMPTY_CAND) : (cards.map((c) => c.html).join('') || EMPTY_CAND);

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 周报 ${esc(week)}</title>
<meta name="theme-color" content="#05070d">
<style>
*{box-sizing:border-box}
body{margin:0;background:#05070d;color:#e9edf7;font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(900px 500px at 12% -10%,rgba(77,107,254,.25),transparent 62%),radial-gradient(800px 460px at 90% -6%,rgba(124,92,255,.18),transparent 60%)}
.wrap{position:relative;max-width:1060px;margin:0 auto;padding:0 24px 80px}
header{padding:56px 0 20px}
.badge{display:inline-flex;gap:8px;align-items:center;padding:6px 13px;border-radius:999px;border:1px solid rgba(122,162,255,.28);background:rgba(77,107,254,.1);font-size:12.5px;color:#b9c6ff}
.dot{width:6px;height:6px;border-radius:50%;background:#5eead4;box-shadow:0 0 0 4px rgba(94,234,212,.14)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.15;letter-spacing:-.02em;margin:20px 0 8px;font-weight:800}
h1 span{background:linear-gradient(100deg,#8fb2ff,#b18cff 45%,#5eead4);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{color:#9aa4bd;font-size:14.5px;margin:0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0 8px}
.stat{padding:16px 18px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.012))}
.stat .v{font-size:26px;font-weight:800;background:linear-gradient(180deg,#fff,#9db4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat .k{font-size:12px;color:#8b95ad}
section{margin-top:36px}
h2{font-size:20px;letter-spacing:-.01em;margin:0 0 6px;font-weight:750}
.sub{color:#8b95ad;font-size:13px;margin:0 0 14px}
.panel{padding:18px 20px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012))}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6b7590;font-weight:650;padding:0 10px 8px 0;border-bottom:1px solid rgba(255,255,255,.08)}
td{padding:9px 10px 9px 0;border-bottom:1px solid rgba(255,255,255,.05);color:#aab3c8;vertical-align:top}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#9db4ff;background:rgba(77,107,254,.1);padding:1px 5px;border-radius:4px}
.barrow{display:grid;grid-template-columns:200px 1fr 48px;gap:10px;align-items:center;margin-bottom:8px;font-size:12.5px}
.bl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aab3c8}
.bar{height:7px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4d6bfe,#7c5cff)}
.bv{text-align:right;color:#8b95ad;font-variant-numeric:tabular-nums}
.cand{display:flex;gap:12px;padding:18px 20px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);margin-bottom:12px;cursor:pointer;transition:.18s}
.cand:hover{border-color:rgba(122,162,255,.35)}
.cand.on{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06)}
.cand input{margin-top:5px;width:17px;height:17px;accent-color:#34d399;flex:none}
.cbody{min-width:0;flex:1}
.chead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.idx{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;background:rgba(77,107,254,.18);color:#9db4ff;font-size:11px;font-weight:700}
.chead b{font-size:15px}
.verdict{font-size:11.5px;padding:2px 8px;border-radius:6px;font-weight:600}
.v-skill{background:rgba(52,211,153,.14);color:#6ee7b7}
.v-lite{background:rgba(251,191,36,.14);color:#fcd34d}
.v-rule{background:rgba(122,162,255,.14);color:#9db4ff}
.v-skip{background:rgba(148,163,184,.14);color:#cbd5e1}
.score{font-size:11.5px;color:#8b95ad}
.what{margin:0 0 8px;font-size:13.5px;color:#c6cfe2;line-height:1.7}
.evid{font-size:12.5px;color:#8b95ad;margin-bottom:8px}
.evid span{display:inline-block;margin-right:8px;padding:1px 7px;border-radius:5px;background:rgba(255,255,255,.06);color:#9aa4bd;font-size:11px}
.steps{margin:0 0 10px;padding-left:20px;font-size:12.5px;color:#aab3c8;line-height:1.8}
.scores{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:#8b95ad;margin-bottom:8px}
.scores i{display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.12);margin-left:3px}
.scores i.on{background:#5eead4}
.verdictwhy{font-size:12.5px;color:#9aa4bd;background:rgba(255,255,255,.03);border-left:2px solid rgba(122,162,255,.4);padding:7px 10px;border-radius:0 8px 8px 0;margin-bottom:6px}
.meta{font-size:12px;color:#6b7590}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
button{font-family:inherit;font-size:13px;padding:9px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#cdd5e6;cursor:pointer;transition:.18s}
button:hover{background:rgba(122,162,255,.16);color:#fff;border-color:rgba(122,162,255,.4)}
button.primary{background:linear-gradient(135deg,#4d6bfe,#7c5cff);border-color:transparent;color:#fff;font-weight:600}
.hint{font-size:12px;color:#6b7590}
.out{margin-top:10px;padding:11px 13px;border-radius:10px;background:#070a12;border:1px solid rgba(255,255,255,.07);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#9db4ff;min-height:40px;white-space:pre-wrap}
.toast{position:fixed;left:50%;bottom:30px;transform:translate(-50%,16px);padding:10px 16px;border-radius:10px;background:rgba(52,211,153,.16);border:1px solid rgba(52,211,153,.35);color:#6ee7b7;font-size:13px;opacity:0;pointer-events:none;transition:.25s}
.toast.on{opacity:1;transform:translate(-50%,0)}
.empty{padding:24px;text-align:center;color:#6b7590;border:1px dashed rgba(255,255,255,.12);border-radius:12px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid rgba(255,255,255,.07);color:#5f6880;font-size:12px;line-height:1.8}
@media(max-width:820px){.stats{grid-template-columns:1fr 1fr}.barrow{grid-template-columns:120px 1fr 40px}}
${extraCss}</style></head>
<body><div class="wrap">
<header>
  <div class="badge"><span class="dot"></span>DSH 周报复盘 · ${esc(week)} · ${esc(now.toLocaleString('zh-CN', { hour12: false }).slice(0, 16))}</div>
  <h1>这周你让 Agent <span>做了什么</span></h1>
  <p class="lede">窗口：最近 ${digest.windowDays} 天 · 扫描 ${digest.sessionFilesScanned} 个会话文件 · 命中 ${digest.totalSessions} 个会话 · 本页纯本地确定性生成，未调用模型</p>
</header>

<div class="stats${hasF ? ' five' : ''}">
  <div class="stat"><div class="v">${digest.totalSessions}</div><div class="k">会话（含子 agent）</div></div>
  <div class="stat"><div class="v">${S.reduce((a, s) => a + s.turns, 0)}</div><div class="k">总轮次</div></div>
  <div class="stat"><div class="v">${S.reduce((a, s) => a + (s.userMessageCount ?? s.userMessages.length), 0)}</div><div class="k">你的消息</div></div>
  <div class="stat"><div class="v">${(props.proposals || []).length}</div><div class="k">固化候选</div></div>${hasF ? `
  <div class="stat"><div class="v">${(F.repeats || []).length}</div><div class="k">重复劳动</div></div>` : ''}
</div>

<section>
  <h2>${N.ws} · 工作区分布</h2>
  <div class="panel"><table>
    <thead><tr><th>工作区</th><th>主会话</th><th>子 agent</th><th>轮次</th><th>你的消息</th><th>高频工具</th></tr></thead>
    <tbody>${wsRows}</tbody>
  </table></div>
</section>
${findingsSections}
<section>
  <h2>${N.tools} · 工具使用 Top 10</h2>
  <div class="panel">${toolBars}</div>
</section>

<section>
  <h2>${N.files} · 改动最多的文件</h2>
  <div class="panel"><table><thead><tr><th>文件</th><th style="width:70px">次数</th></tr></thead><tbody>
    ${topFiles.map(([p, n]) => `<tr><td><code>${esc(short(p))}</code></td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2" style="color:#6b7590">无</td></tr>'}
  </tbody></table></div>
</section>

<section>
  <h2>${N.cand} · 候选（已附「是什么 / 依据 / 怎么落地 / 成色判断」）</h2>
  ${props.findingsRejected ? `<div style="margin:0 0 12px;padding:10px 13px;border-radius:10px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);color:#fcd34d;font-size:12.5px">⚠️ 本周 findings.json 未通过校验，本页候选来自旧规则回退（原因：${esc(props.findingsRejected)}）</div>
  ` : ''}<p class="sub">${hasF ? '候选已按技能 / 规则 / 插件分组；' : ''}勾选你要落地的 → 点「复制采纳指令」→ 粘贴回 DSH 对话，我按清单执行。</p>
  ${candCards}
  <div class="actions">
    <button id="all">全选</button>
    <button id="none">清空</button>
    <button class="primary" id="copy">复制采纳指令</button>
    <span class="hint">勾选状态存在本地，同一周刷新不丢</span>
  </div>
  <div class="out" id="out">（勾选候选后点「复制采纳指令」，这里会显示要发给我的话）</div>
</section>

<section>
  <h2>${N.corr} · 纠偏信号</h2>
  <div class="panel"><p style="margin:0;font-size:13.5px;color:#8b95ad">本周捕捉到 <b style="color:#e9edf7">${props.corrections ?? 0}</b> 处「不是这样」的反馈。${(props.corrections ?? 0) === 0 ? '没有明显纠偏，或措辞未命中规则。' : '详见同名 Markdown 周报第 4 节。'}</p></div>
</section>

<footer>
  数据：~/.dsh/learning/weekly/digest.json · 报告：${esc(week)}.md · 生成：report-html.mjs<br>
  成色评分：频率 / 触发可预测 / 是否新增能力 / 可否自动验收（各 0-2 分）。本质是规则的候选不建技能，避免技能库膨胀。<br>
  隐私：本页只含统计与短句摘录，不含完整会话；周报数据不进入任何 Git 仓库。
</footer>
</div>
<div class="toast" id="toast">已复制</div>
<script>
const KEY = 'dsh-weekly-${esc(week)}';
const cands = [...document.querySelectorAll('.cand')];
const state = JSON.parse(localStorage.getItem(KEY) || '{}');
function sync() {
  cands.forEach((el) => {
    const i = el.dataset.i, cb = el.querySelector('.cb');
    cb.checked = !!state[i];
    el.classList.toggle('on', !!state[i]);
  });
  const chosen = cands.filter((el) => state[el.dataset.i]).map((el) => ({
    i: el.dataset.i,
    name: el.querySelector('.chead b').textContent,
    verdict: el.querySelector('.verdict').textContent,
  }));
  const out = document.getElementById('out');
  out.textContent = chosen.length
    ? '周报 ${esc(week)} 采纳：' + chosen.map((c) => c.i + ') ' + c.name + '（' + c.verdict + '）').join('；') + '。请按这个清单落地。'
    : '（勾选候选后点「复制采纳指令」，这里会显示要发给我的话）';
  localStorage.setItem(KEY, JSON.stringify(state));
}
cands.forEach((el) => el.querySelector('.cb').addEventListener('change', (e) => {
  state[el.dataset.i] = e.target.checked ? 1 : 0; sync();
}));
document.getElementById('all').onclick = () => { cands.forEach((el) => (state[el.dataset.i] = 1)); sync(); };
document.getElementById('none').onclick = () => { cands.forEach((el) => delete state[el.dataset.i]); sync(); };
document.getElementById('copy').onclick = async () => {
  const t = document.getElementById('out').textContent;
  try { await navigator.clipboard.writeText(t); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  const el = document.getElementById('toast'); el.textContent = '已复制，去 DSH 粘贴'; el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1600);
};
sync();
</script>
</body></html>`;

writeFileAtomic(path.join(WEEKLY, `${week}.html`), html);
if (!isBackfill) writeFileAtomic(path.join(WEEKLY, 'latest.html'), html);
else console.error(`[html] 回填模式：只写 ${week}.html，未覆盖 latest.html`);
console.log(`[html] 生成 ${week}.html`);
