#!/usr/bin/env node
// 把 digest.json 变成「可读周报 + 带解释与成色判断的候选」。纯确定性，不调用模型。
// 用法: node report.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateFindings, normalizeCandidate } from './findings-lib.mjs';
import { readHistory, upsertHistory, trendOf, repeatKey, buildRecord } from './history.mjs';
import { writeFileAtomic } from './atomic-write.mjs';

const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
let digest;
try {
  digest = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'digest.json'), 'utf8'));
} catch (e) {
  console.error(`❌ 读不到或解析不了 digest.json（${process.env.DSH_LEARNING || ''}/weekly）：${e.message}`);
  console.error('   先跑 collect.mjs / run-weekly.sh，或检查 learning 目录是否被清空。');
  process.exit(2);
}
const parsedNow = new Date(digest.windowEnd || digest.generatedAt);
const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
// 回填判定只认显式开关（DSH_WINDOW_END）：否则历史 digest 重放也会误判成回填
const isBackfill = !!process.env.DSH_WINDOW_END;

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};
const week = isoWeek(now);
// 已落地候选：读取 decisions.json，后续不再重复推荐（W45 修）
let decisions = [];
try { decisions = JSON.parse(fs.readFileSync(path.join(WEEKLY, 'decisions.json'), 'utf8')).decisions || []; } catch {}
const landed = new Set(decisions.flatMap((d) => [d.key, d.candidate]).map((x) => String(x || '').trim()).filter(Boolean));
// 历史数据的 candidate 是简写（context-pressure），findings 的 key 带形态前缀（rule-context-pressure）
const isLanded = (key) => {
  if (!key) return false;
  if (landed.has(key)) return true;
  for (const c of landed) if (key.endsWith(`-${c}`) || c.endsWith(`-${key}`)) return true;
  return false;
};
const fmtTime = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false }).slice(0, 16);
const short = (p) => String(p).replace(os.homedir(), '~').split('/').slice(-2).join('/');

const S = digest.sessions;
const MAIN = S.filter((s) => s.origin === 'user');
const isInjected = (t) => /^(Team message|Background subagent|你是|You are an AI agent)/.test(t) || t.includes('Team message from');

// ---------- 分析环节产出（findings.json）：有且合法才用，否则回退旧规则 ----------
// 为什么默认回退：定时任务不能依赖模型；findings 过期/伪造时宁可少说，不可乱说。
const FINDINGS_FILE = path.join(WEEKLY, 'findings.json');
let findings = null;
let findingsErr = '';
try {
  if (fs.existsSync(FINDINGS_FILE)) findings = JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
} catch (e) { findingsErr = `解析失败（${e.message}）`; }

const findingsProblems = findings && !findingsErr
  ? validateFindings(findings, { week, sessionIds: S.map((x) => x.id) })
  : [];

// ---------- 基础统计 ----------
const toolRank = {};
for (const s of S) for (const [n, c] of Object.entries(s.tools)) toolRank[n] = (toolRank[n] || 0) + c;
const topTools = Object.entries(toolRank).sort((a, b) => b[1] - a[1]);

const fileRank = {};
for (const s of S) for (const f of s.filesWritten) fileRank[f.path] = (fileRank[f.path] || 0) + f.n;
const topFiles = Object.entries(fileRank).sort((a, b) => b[1] - a[1]);

const researchCalls = (toolRank['mcp__anysearch__extract'] || 0) + (toolRank['mcp__anysearch__batch_search'] || 0) + (toolRank['web_fetch'] || 0) + (toolRank['mcp__anysearch__search'] || 0);
const researchSessions = MAIN.filter((s) => (s.tools['mcp__anysearch__extract'] || 0) + (s.tools['mcp__anysearch__batch_search'] || 0) + (s.tools['web_fetch'] || 0) >= 3);

const CORRECTION = /不对|不是这个|错了|改成|重来|我要的是|理解错|不要这样|偏离|跑偏|我还是可以|其实还是|并没有|并不是|你搞错|说错|不准确|漏了|没生效|还是有|不对吧|你确定吗/i;
const corrections = [];
const seenMsg = new Set();
for (const s of MAIN) for (const m of [...s.userMessages, ...(s.recentMessages || [])]) {
  if (seenMsg.has(m)) continue;
  seenMsg.add(m);
  if (isInjected(m) || m.length > 300) continue;
  if (CORRECTION.test(m)) corrections.push({ session: s.title, text: m.slice(0, 200) });
}

// 改文件按目录聚类
const dirStats = {};
for (const [p, n] of Object.entries(fileRank)) {
  const rel = p.includes('default-workspace/') ? p.split('default-workspace/')[1] : p;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '(工作区根目录)';
  dirStats[dir] = dirStats[dir] || { edits: 0, files: new Set() };
  dirStats[dir].edits += n; dirStats[dir].files.add(rel);
}
const topDirs = Object.entries(dirStats).map(([dir, v]) => ({ dir, edits: v.edits, files: [...v.files] }))
  .sort((a, b) => b.edits - a.edits);

const extRank = {};
for (const [p, n] of Object.entries(fileRank)) {
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [, 'none'])[1].toLowerCase();
  extRank[ext] = (extRank[ext] || 0) + n;
}

const longSessions = MAIN.filter((s) => s.turns >= 5).sort((a, b) => b.turns - a.turns);
const longest = longSessions[0];
const longestTools = longest ? Object.values(longest.tools).reduce((a, b) => a + b, 0) : 0;

// ---------- 候选构建 ----------
// 成色评分（每项 0-2）：频率 / 触发可预测性 / 是否新增能力 / 可否自动验收
function judge(scores) {
  const total = scores.freq + scores.trigger + scores.capability + scores.verifiable;
  let verdict, verdictWhy;
  if (scores.capability === 0) {
    verdict = 'rule';
    verdictWhy = '本质是「纪律」不是新能力：没有稳定的触发入口，写成 AGENTS.md 一条规则比做技能更有效（技能要靠描述匹配触发，长任务千变万化匹配不上）。';
  } else if (total >= 6 && scores.trigger >= 1) {
    verdict = 'skill';
    verdictWhy = '有明确触发词、输入输出稳定、且能内置校验——正是技能最合适的形态。';
  } else if (total >= 5) {
    verdict = 'skill-lite';
    verdictWhy = '值得沉淀，但触发词不够稳定；建议先写成一页 SKILL.md + 一条 AGENTS.md 提醒。';
  } else {
    verdict = 'skip';
    verdictWhy = '频率或可验收性不足，本周还不足以形成稳定流程，建议再观察 2-3 周。';
  }
  return { total, max: 8, verdict, verdictWhy };
}

const legacyCands = [];

if (researchCalls >= 20) {
  const scores = { freq: 2, trigger: 2, capability: 2, verifiable: 1 };
  legacyCands.push({
    key: 'web-research-pack',
    title: '联网调研打包（web-research-pack）',
    what: '把「全网搜一个主题 → 出带出处的材料」固定成一条流水线：默认只交付一份 Markdown 报告（来源清单放附录）；只有你明确说要二次加工（做页面/做对比/进周报）时，才额外产出一份 data.json。默认轻交付，需要自动化时不重复劳动。',
    evidence: `本周 ${researchSessions.length} 个主会话里共发生 ${researchCalls} 次联网动作（extract ${toolRank['mcp__anysearch__extract'] || 0} / batch_search ${toolRank['mcp__anysearch__batch_search'] || 0} / web_fetch ${toolRank['web_fetch'] || 0}），平均每个调研会话要来回 8-15 次。`,
    steps: ['你说主题 + 深度/数量 + 用途（只读 / 二次加工）', '并行搜：每个子问题一批 batch_search', '对命中结果 extract 正文并去重', '按主题归类并标注来源（来源表进附录）', '默认输出：报告.md；用途=二次加工时再从同一份数据生成 data.json'],
    saving: '默认轻交付；需要自动化时不返工，且出处不会漏',
    effort: '低（本质是把现有做法固化成流程）',
    scores,
  });
}

const topDir = topDirs[0];
if (topDir && topDir.edits >= 5 && topDir.files.length >= 2) {
  const scores = { freq: 2, trigger: 2, capability: 2, verifiable: 2 };
  legacyCands.push({
    key: 'batch-transform',
    title: `批量改文件（${topDir.dir.split('/').pop()} 下 ${topDir.files.length} 个文件 / 本周 ${topDir.edits} 次）`,
    what: '针对「同一批结构化文件按统一规则改一遍」：先 dry-run 出 diff 预览，再跑格式/字段校验，确认后才落盘，并留一份快照可一键回滚。目标不是改得快，而是改完能证明没改坏。',
    evidence: `本周 write ${toolRank['write'] || 0} 次、edit ${toolRank['edit'] || 0} 次；最集中的目录是 \`${topDir.dir}\`（${topDir.files.length} 个文件、${topDir.edits} 次改动）。`,
    steps: ['给目录 + 一条规则（如"每个 JSON 补 confidence 默认 medium"）', 'dry-run：列出将改哪些文件、每个文件改几处', '校验：JSON 可解析 / 必填键齐全 / 条数不变', '应用改动 + 写快照 + 打印回滚命令'],
    saving: '避免漏改与反复人工核对一致性',
    effort: '中（要写一个通用 diff/校验脚本）',
    scores,
  });
}

if (longest) {
  const scores = { freq: 1, trigger: 0, capability: 0, verifiable: 1 };
  legacyCands.push({
    key: 'long-task-checklist',
    title: '长任务先出阶段清单（AGENTS.md 规则）',
    what: '任务预计超过 5 轮时，开工前先冻结一份阶段清单：每阶段做什么、产出什么、用什么命令验收；没过验收不得宣称完成。目的是防止长任务中途跑偏、以及"做完了"但没验。',
    evidence: `本周有 ${longSessions.length} 个主会话超过 5 轮；最长「${longest.title}」跑了 ${longest.turns} 轮、${longestTools} 次工具调用，中途出现过返工（QA 后又改版）。`,
    steps: ['识别：预计 >5 轮就触发', '先写：阶段 / 产物 / 验收命令 / 回滚点', '每阶段结束跑一次验收，失败停在当阶段修', '全部通过才汇报完成'],
    saving: '减少返工与"假完成"',
    effort: '极低（一条规则，不写代码）',
    scores,
  });
}

if (corrections.length >= 2) {
  const scores = { freq: 1, trigger: 0, capability: 0, verifiable: 0 };
  legacyCands.push({
    key: 'correction-rules',
    title: '把纠偏点写成长期规则（AGENTS.md）',
    what: '把你说过的「不是这样/我要的是」逐条改写成可执行规则（当 X 时做 Y、不要 Z），放进 AGENTS.md，让以后每个会话自动遵守，而不是每次重复纠正。',
    evidence: `本周捕捉到 ${corrections.length} 处纠偏：${corrections.slice(0, 2).map((c) => `「${c.text.slice(0, 40)}…」`).join('、')}`,
    steps: ['摘出纠偏原句', '改写成"当 X 时，做 Y，不要 Z"', '你确认后写入 AGENTS.md', '下周复盘检查是否再犯'],
    saving: '同类错误不再犯',
    effort: '极低',
    scores,
  });
}

if ((extRank['html'] || 0) >= 2) {
  const scores = { freq: 2, trigger: 1, capability: 1, verifiable: 1 };
  legacyCands.push({
    key: 'html-report',
    title: '单文件可视化报告生成（html-report）',
    what: '把数据/材料稳定地产出成一个可直接打开的单文件 HTML：概览数字卡、分类图表、可筛选清单、结论区；样式统一、离线可用、能直接发给别人。',
    evidence: `本周生成/修改 html ${extRank['html']} 次；工作区里已有不止一份单文件报告。`,
    steps: ['输入：数据 JSON 或材料', '选模板：报告 / 看板 / 清单', '生成单文件 HTML（内嵌样式与数据）', '自检：标签闭合 / JS 无错 / 数字一致'],
    saving: '每次省掉模板与样式搭建',
    effort: '中',
    scores,
  });
}

for (const c of legacyCands) Object.assign(c, judge(c.scores));

// ---------- 候选来源：findings 优先，旧规则兜底 ----------
let cands;
let findingsUsed = false;
if (findings && !findingsErr && !findingsProblems.length) {
  findingsUsed = true;
  cands = findings.candidates.map((c) => normalizeCandidate(c, judge(c.scores)));
} else {
  cands = legacyCands;
}
const skippedLanded = cands.filter((c) => isLanded(c.key));
const activeCands = cands.filter((c) => !isLanded(c.key)).slice(0, findingsUsed ? 6 : 99);
const SEC = findingsUsed ? { portrait: 5, repeats: 6, cand: 7, landed: 8, ask: 9 } : { cand: 5, landed: 6, ask: 7 };

// ---------- 跨周记忆：把前几周的结论作为这周的输入（只标注，不改分级） ----------
const history = readHistory(WEEKLY);
const trend = trendOf(history, week);
const seenWeeks = (key) => (trend.candWeeks.get(key)?.weeks || []).length;
const skillsCalled = {};
let skillFails = 0;
for (const s of S) {
  for (const [k, v] of Object.entries(s.skillsCalled || {})) skillsCalled[k] = (skillsCalled[k] || 0) + v;
  for (const v of Object.values(s.skillFails || {})) skillFails += v;
}
const skillRows = Object.entries(skillsCalled).sort((a, b) => b[1] - a[1]);

// ---------- 写 Markdown ----------
const VERDICT_LABEL = { skill: '✅ 做成技能', 'skill-lite': '🟡 轻量技能', rule: '📝 写成规则', plugin: '🔌 做成插件', schedule: '⏰ 定时任务', watcher: '👀 监听 watcher', skip: '⏸ 先观察' };
const lines = [];
lines.push(`# DSH 周报复盘 · ${week}`);
lines.push('');
lines.push(`> 窗口：最近 ${digest.windowDays} 天（${fmtTime(now.getTime() - digest.windowDays * 86400e3)} → ${fmtTime(now)}）`);
lines.push(`> 数据：\`~/.dsh/sessions\` 下 ${digest.sessionFilesScanned} 个会话文件，命中 **${digest.totalSessions}** 个会话（主会话 ${MAIN.length}）。本报告为确定性统计，未调用模型。`);
if (findings && !fs.existsSync(path.join(WEEKLY, 'packet.md'))) {
  lines.push('> ⚠️ 分析包 packet.md 不存在：findings 里的依据无法回到上下文核对，建议先跑 condense.mjs。');
}
lines.push('');
lines.push('## 1. 本周概览');
lines.push('');
lines.push('| 工作区 | 主会话 | 子 agent | 轮次 | 你的消息 | 高频工具 |');
lines.push('|---|---|---|---|---|---|');
for (const [ws, w] of Object.entries(digest.byWorkspace)) {
  const mains = S.filter((s) => (s.cwd || '') === ws && s.origin === 'user').length;
  lines.push(`| \`${short(ws)}\` | ${mains} | ${w.sessions - mains} | ${w.turns} | ${w.userMessages} | ${w.topTools.slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' · ')} |`);
}
lines.push('');
lines.push('## 2. 你这周在做什么');
lines.push('');
for (const [ws] of Object.entries(digest.byWorkspace)) {
  const mains = [...new Set(S.filter((s) => (s.cwd || '') === ws && s.origin === 'user').map((s) => s.title).filter(Boolean))];
  lines.push(`**${short(ws)}**`);
  for (const t of mains.slice(0, 12)) lines.push(`- ${t}`);
  lines.push('');
}
lines.push('## 3. 工具与产出热点');
lines.push('');
lines.push(`- 工具 Top：${topTools.slice(0, 10).map(([n, c]) => `\`${n}\`×${c}`).join('、')}`);
if (topFiles.length) lines.push(`- 改动最多的文件：${topFiles.slice(0, 8).map(([p, n]) => `\`${short(p)}\`×${n}`).join('、')}`);
lines.push(`- 文件类型：${Object.entries(extRank).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => `.${e}×${n}`).join('、')}`);
if (digest.skippedFiles) lines.push(`- ⚠️ ${digest.skippedFiles} 个会话文件无法解析（本周数据不完整；归档态会话不计入）`);
if (skillRows.length || digest.skillLibraryCount) {
  const lib = digest.skillLibraryCount ? ` · 库 ${digest.skillLibraryCount} 个里用到 ${skillRows.length} 个` : '';
  lines.push(`- 技能调用：${skillRows.slice(0, 8).map(([n, c]) => `\`${n}\`×${c}`).join('、') || '（本周没有显式调用技能）'}${lib}${skillFails ? ` · 失败 ${skillFails} 次` : ''}`);
}
lines.push('');
lines.push('## 4. 纠偏信号');
lines.push('');
if (!corrections.length) lines.push('本周没有捕捉到明显纠偏词（"不是这样/我要的是/改成"）。可能是没有，也可能是措辞没命中规则。');
else for (const c of corrections.slice(0, 8)) lines.push(`- 「${c.text}」`);
lines.push('');
if (findingsUsed) {
  lines.push(`## ${SEC.portrait}. 工作流画像`);
  lines.push('');
  lines.push(`> 由分析环节从 ${digest.totalSessions} 个会话的诉求/骨架归纳${findings.generatedAt ? `（${findings.generatedAt}）` : ''}；每条都挂着会话 id，可回溯。`);
  lines.push('');
  for (const p of findings.portrait || []) {
    lines.push(`### ${p.mainline || '(未命名主线)'}`);
    if (p.goal) lines.push(`- 目标：${p.goal}`);
    if (p.outputs && p.outputs.length) lines.push(`- 产出：${p.outputs.join('、')}`);
    if (p.sessions && p.sessions.length) lines.push(`- 依据会话：${p.sessions.length} 个`);
    if (p.note) lines.push(`- 备注：${p.note}`);
    lines.push('');
  }
  if (!(findings.portrait || []).length) { lines.push('（分析环节未产出画像）'); lines.push(''); }
  lines.push(`## ${SEC.repeats}. 重复劳动清单`);
  lines.push('');
  if ((findings.repeats || []).length) {
    lines.push('| 重复动作 | 次数 | 每次成本 | 建议形态 | 依据会话 | 复现 |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of findings.repeats) {
      const ws = trend.repeatWeeks.get(repeatKey(r)) || [];
      const rep = ws.length ? `🔁 第 ${ws.length + 1} 周` : '—';
      lines.push(`| ${r.pattern} | ${r.count} | ${r.cost || '—'} | ${r.status || '—'} | ${(r.evidence || []).length} | ${rep} |`);
    }
    lines.push('');
  } else { lines.push('（分析环节未识别到稳定重复动作）'); lines.push(''); }
}
lines.push(`## ${SEC.cand}. 候选：是什么、证据、成色`);
lines.push('');
if (findings && !findingsUsed) {
  const why = (findingsProblems.length ? findingsProblems : [findingsErr]).slice(0, 3).join('；');
  lines.push(`> ⚠️ findings.json 未通过校验，已回退到旧规则：${why}`);
  lines.push('');
}
if (skippedLanded.length) lines.push(`> 已落地、不再重复推荐：${skippedLanded.map((c) => `\`${c.key}\``).join('、')}（见第 ${SEC.landed} 节）`);
if (skippedLanded.length) lines.push('');
if (!activeCands.length) lines.push('本周数据还太少，或候选均已在往期落地，暂不产出新候选。');
for (const c of activeCands) {
  const seen = seenWeeks(c.key);
  lines.push(`### ${VERDICT_LABEL[c.verdict]} ${c.title}${seen ? ` · 🔁 第 ${seen + 1} 周出现` : ''}`);
  lines.push('');
  lines.push(`**它具体是干什么的**：${c.what}`);
  lines.push('');
  lines.push(`**依据**：${c.evidence}`);
  lines.push('');
  lines.push('**落地形态**：');
  c.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('');
  lines.push(`**成色判断**：${VERDICT_LABEL[c.verdict]}（${c.total}/8）— ${c.verdictWhy}`);
  lines.push(`- 频率 ${c.scores.freq}/2 · 触发可预测 ${c.scores.trigger}/2 · 新增能力 ${c.scores.capability}/2 · 可自动验收 ${c.scores.verifiable}/2`);
  if (c.plugin_spec) {
    const ps = c.plugin_spec;
    lines.push(`- 插件形态：${ps.trigger}${c.persist ? '（常驻）' : '（按需触发）'}${ps.minimal_scope ? ` · 最小范围：${ps.minimal_scope}` : ''}`);
  }
  if (c.evidenceSessions && c.evidenceSessions.length) lines.push(`- 依据会话：${c.evidenceSessions.length} 个（id 可回溯 digest）`);
  lines.push(`- 预计收益：${c.saving}　落地成本：${c.effort}`);
  lines.push('');
}
// ---- 已落地记录 ----
if (decisions.length) {
  lines.push(`## ${SEC.landed}. 已落地记录`);
  lines.push('');
  for (const d of decisions) {
    const kind = d.verdict === 'skill' ? '✅ 技能' : d.verdict === 'rule' ? '📝 规则' : d.verdict === 'skip' ? '⏸ 不做' : d.verdict;
    lines.push(`- **${d.week} · ${d.candidate}** → ${kind} · ${d.where}　${d.note ? '｜' + d.note : ''}`);
  }
  lines.push('');
}
// 没有「已落地记录」时让章节号连续，不要从 5 跳到 7
const askNo = decisions.length ? SEC.ask : SEC.ask - 1;
lines.push(`## ${askNo}. 下周想问你`);
lines.push('');
lines.push('1. 上面候选，哪些这周就落地？（回复编号即可）');
lines.push('2. 有没有本周费力但我没识别出来的活？');
lines.push('3. 纠偏信号里哪几条该变成长期规则？');
lines.push('');
lines.push('---');
lines.push(`_生成 ${fmtTime(now.getTime())} · 脚本 ~/.dsh/learning/scripts/ · 可视化版见同名 .html_`);

const md = lines.join('\n');
writeFileAtomic(path.join(WEEKLY, `${week}.md`), md);
if (!isBackfill) writeFileAtomic(path.join(WEEKLY, 'latest.md'), md);
else console.error(`[report] 回填模式：只写 ${week}.md，未覆盖 latest.md`);
const proposalsOut = { week, generatedAt: digest.generatedAt, proposals: activeCands, skippedLanded: skippedLanded.map((c) => c.key), corrections: corrections.length };
if (digest.skippedFiles) lines.push(`- ⚠️ ${digest.skippedFiles} 个会话文件无法解析（本周数据不完整；归档态会话不计入）`);
if (skillRows.length || digest.skillLibraryCount) {
  proposalsOut.skills = { libraryTotal: digest.skillLibraryCount || 0, used: skillRows.slice(0, 20), fails: skillFails };
}
if (history.length) {
  proposalsOut.trend = {
    weeks: history.map((r) => r.week),
    candidatesSeen: Object.fromEntries([...trend.candWeeks.entries()].map(([k, v]) => [k, { weeks: v.weeks, last: v.last }])),
  };
}
if (findings && !findingsUsed) {
  // 让 HTML 也能看见「分析被回退」，否则页面看起来像是一切正常
  proposalsOut.findingsRejected = (findingsProblems.length ? findingsProblems : [findingsErr]).slice(0, 3).join('；');
}
if (findingsUsed) {
  proposalsOut.findings = { generatedAt: findings.generatedAt || null, portrait: findings.portrait || [], repeats: (findings.repeats || []).map((r) => ({ ...r, weeks: trend.repeatWeeks.get(repeatKey(r)) || [] })), evidenceSessions: activeCands.map((c) => c.evidenceSessions || []) };
}
if (!isBackfill) writeFileAtomic(path.join(WEEKLY, 'proposals.json'), JSON.stringify(proposalsOut, null, 1));
else writeFileAtomic(path.join(WEEKLY, `${week}.proposals.json`), JSON.stringify(proposalsOut, null, 1));
try {
  // 同周重跑但没有 findings 时，不要把上一轮已写入的画像/重复清空（history 是记忆，不是快照）
  const prevRec = history.find((r) => r.week === week);
  const portrait = findingsUsed ? (findings.portrait || []) : (prevRec?.portrait || []);
  const repeats = findingsUsed ? (findings.repeats || []) : (prevRec?.repeats || []);
  upsertHistory(WEEKLY, buildRecord({
    week, digest, sessions: S, corrections: corrections.length,
    portrait, repeats,
    candidates: activeCands,
    skills: skillRows.length ? { libraryTotal: digest.skillLibraryCount || 0, used: skillRows.slice(0, 20), fails: skillFails } : null,
  }));
} catch (e) { console.error(`[report] history 写入失败：${e.message}`); }
console.log(`[report] 生成 ${week}.md · 新候选 ${activeCands.length} 个（${activeCands.map((c) => c.verdict).join('/') || '无'}）· 跳过已落地 ${skippedLanded.length} · 纠偏 ${corrections.length}`);
if (findings && !findingsUsed) console.log(`[report] ⚠️ findings.json 未采用：${(findingsProblems.length ? findingsProblems : [findingsErr]).slice(0, 2).join('；')}`);
