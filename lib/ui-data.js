// UI 聚合层：只读 learning/ 产物，产出前端可直接画图的结构。
// 设计：不暴露会话正文；证据只给 session id 与标题；所有 series 预先算好，前端零计算。
import fs from 'node:fs';
import path from 'node:path';
import { WEEKLY, readJson, stat } from './data.js';

const TOP = 8;

const readJsonl = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && typeof r.week === 'string');
  } catch { return []; }
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const bucket = (v) => (v <= 0 ? '0' : v === 1 ? '1' : v === 2 ? '2' : '3+');

export function uiMetrics() {
  const digest = readJson(path.join(WEEKLY, 'digest.json'));
  const proposals = readJson(path.join(WEEKLY, 'proposals.json'));
  const findings = readJson(path.join(WEEKLY, 'findings.json'));
  const history = readJsonl(path.join(WEEKLY, 'history.jsonl'));
  const decisionsRaw = readJson(path.join(WEEKLY, 'decisions.json'), { decisions: [] });
  const decisions = Array.isArray(decisionsRaw?.decisions) ? decisionsRaw.decisions : [];
  const sessions = Array.isArray(digest?.sessions) ? digest.sessions.filter((s) => s && typeof s === 'object') : [];
  const main = sessions.filter((s) => s.origin === 'user');
  const sub = sessions.filter((s) => s.origin !== 'user');
  const proposalsList = Array.isArray(proposals?.proposals) ? proposals.proposals : [];

  const turns = main.reduce((a, s) => a + num(s.turns), 0);
  const turnsAll = sessions.reduce((a, s) => a + num(s.turns), 0);
  const compactions = sessions.reduce((a, s) => a + num(s.compactions), 0);

  // 压缩次数直方图
  const compBuckets = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  for (const s of sessions) compBuckets[bucket(num(s.compactions))] += 1;

  // 轮次分布直方图
  const turnBuckets = { '1-2': 0, '3-5': 0, '6-10': 0, '11-20': 0, '20+': 0 };
  for (const s of sessions) {
    const t = num(s.turns);
    if (t <= 2) turnBuckets['1-2'] += 1;
    else if (t <= 5) turnBuckets['3-5'] += 1;
    else if (t <= 10) turnBuckets['6-10'] += 1;
    else if (t <= 20) turnBuckets['11-20'] += 1;
    else turnBuckets['20+'] += 1;
  }

  // 候选 verdict 环图
  const verdictMap = new Map();
  for (const c of proposalsList) verdictMap.set(c.verdict || 'skip', (verdictMap.get(c.verdict || 'skip') || 0) + 1);
  const verdictDonut = [...verdictMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // 重复劳动条形（按次数）
  const repeats = (Array.isArray(findings?.repeats) ? findings.repeats : [])
    .map((r) => ({ key: r.key, label: r.pattern || r.key, count: num(r.count), cost: r.cost || null, evidence: Array.isArray(r.evidence) ? r.evidence.length : 0 }))
    .sort((a, b) => b.count - a.count);

  // 画像主线（按证据会话数）
  const portrait = (Array.isArray(findings?.portrait) ? findings.portrait : [])
    .map((p) => ({ mainline: p.mainline, goal: p.goal || null, sessions: Array.isArray(p.sessions) ? p.sessions.length : 0, outputs: Array.isArray(p.outputs) ? p.outputs.length : 0, note: p.note || null }))
    .sort((a, b) => b.sessions - a.sessions);

  // 每会话轮次 top
  const sessionTurns = sessions
    .map((s) => ({ id: s.id, title: s.title || '', turns: num(s.turns), compactions: num(s.compactions) }))
    .sort((a, b) => b.turns - a.turns)
    .slice(0, TOP);

  // 小时热力
  const hourHeat = Array.from({ length: 24 }, (_, i) => ({ hour: i, value: 0 }));
  for (const s of sessions) {
    const hits = s.hourHits;
    if (Array.isArray(hits)) hits.forEach((v, i) => { if (i < 24) hourHeat[i].value += num(v); });
    else if (hits && typeof hits === 'object') for (const [k, v] of Object.entries(hits)) { const i = Number(k); if (i >= 0 && i < 24) hourHeat[i].value += num(v); }
  }

  // 工具调用 top
  const toolMap = new Map();
  for (const s of sessions) {
    const tools = s.tools;
    if (Array.isArray(tools)) for (const t of tools) toolMap.set(t, (toolMap.get(t) || 0) + 1);
    else if (tools && typeof tools === 'object') for (const [k, v] of Object.entries(tools)) toolMap.set(k, (toolMap.get(k) || 0) + num(v));
  }
  const toolTop = [...toolMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, TOP);

  // 周趋势（history.jsonl 按周）
  const weeklyTrend = history.slice(-12).map((r) => ({
    week: r.week,
    sessions: num(r.sessions),
    turns: num(r.turns),
    candidates: Array.isArray(r.candidates) ? r.candidates.length : 0,
    compactions: num(r.compactions),
    corrections: num(r.corrections),
  }));

  // 采纳漏斗
  const synced = decisions.filter((d) => typeof d.where === 'string' && /已同步|commit/i.test(d.where)).length;
  const skipped = Array.isArray(proposals?.skippedLanded) ? proposals.skippedLanded.length : 0;
  // 本周落地：按 key 或标题匹配（历史 decisions 早期条目只有 candidate 标题）
  const landedThisWeek = proposalsList.filter((c) => decisions.some((d) => d.key === c.key || d.candidate === c.title)).length;
  const funnel = { proposed: proposalsList.length, landed: landedThisWeek, landedTotal: decisions.length, synced, skipped };

  // 评分矩阵（4 维 × 候选）
  const scoreMatrix = proposalsList.map((c) => ({
    key: c.key, title: c.title, verdict: c.verdict,
    scores: { freq: num(c.scores?.freq), trigger: num(c.scores?.trigger), capability: num(c.scores?.capability), verifiable: num(c.scores?.verifiable) },
    total: num(c.total), max: num(c.max) || 8,
  }));

  return {
    week: proposals?.week || history.at(-1)?.week || null,
    kpis: {
      sessions: sessions.length, mainSessions: main.length, subSessions: sub.length,
      turns, turnsAll, compactions, corrections: num(proposals?.corrections),
      portrait: portrait.length, repeats: repeats.length, candidates: proposalsList.length,
      skipped, landed: landedThisWeek, landedTotal: decisions.length, synced,
      skillsUsed: Array.isArray(proposals?.skills?.used) ? proposals.skills.used.length : 0,
      skillFails: num(proposals?.skills?.fails),
      libraryTotal: num(proposals?.skills?.libraryTotal),
    },
    sessionSplit: [{ label: '主会话', value: main.length }, { label: '子会话', value: sub.length }],
    turnSplit: [{ label: '主会话轮次', value: turns }, { label: '子会话轮次', value: Math.max(0, turnsAll - turns) }],
    compactionHistogram: Object.entries(compBuckets).map(([label, value]) => ({ label, value })),
    turnHistogram: Object.entries(turnBuckets).map(([label, value]) => ({ label, value })),
    verdictDonut,
    repeatBars: repeats.slice(0, TOP),
    portraitBars: portrait.slice(0, TOP),
    sessionTurns,
    hourHeat,
    toolTop,
    weeklyTrend,
    funnel,
    scoreMatrix,
    findingsRejected: proposals?.findingsRejected || null,
  };
}

/** UI 首屏：KPI + 新鲜度 + 运行状态，不含大数组 */
export function uiOverview() {
  const m = uiMetrics();
  const report = stat(path.join(WEEKLY, 'latest.html'));
  const packet = stat(path.join(WEEKLY, 'packet.md'));
  const ageDays = report ? Math.floor((Date.now() - new Date(report.mtime).getTime()) / 86400000) : null;
  const freshness = ageDays === null ? 'none' : ageDays <= 1 ? 'fresh' : ageDays <= 7 ? 'aging' : 'stale';
  return {
    week: m.week,
    kpis: m.kpis,
    freshness: { ageDays, level: freshness, reportAt: report?.mtime ?? null },
    report: report ? { bytes: report.size, at: report.mtime } : null,
    packet: packet ? { bytes: packet.size, at: packet.mtime } : null,
    findingsRejected: m.findingsRejected,
    topCandidates: m.scoreMatrix.slice(0, 3),
    funnel: m.funnel,
  };
}

export function uiCandidates() {
  const proposals = readJson(path.join(WEEKLY, 'proposals.json'), { proposals: [] });
  const decisions = readJson(path.join(WEEKLY, 'decisions.json'), { decisions: [] });
  const landed = new Map((decisions?.decisions || []).map((d) => [d.key, d]));
  const skipped = new Set(Array.isArray(proposals?.skippedLanded) ? proposals.skippedLanded : []);
  const list = (Array.isArray(proposals?.proposals) ? proposals.proposals : []).map((c) => ({
    key: c.key, title: c.title, verdict: c.verdict, shape: c.shape || null,
    what: c.what || null, evidence: c.evidence || null, steps: c.steps || null,
    saving: c.saving || null, effort: c.effort || null,
    scores: c.scores || null, total: num(c.total), max: num(c.max) || 8,
    verdictWhy: c.verdictWhy || null,
    evidenceSessions: Array.isArray(c.evidenceSessions) ? c.evidenceSessions : [],
    landed: landed.has(c.key) ? { where: landed.get(c.key).where || null, at: landed.get(c.key).landed_at || null } : null,
    skipped: skipped.has(c.key),
  }));
  return { week: proposals?.week || null, candidates: list };
}

export function uiFindings() {
  const f = readJson(path.join(WEEKLY, 'findings.json'));
  const digest = readJson(path.join(WEEKLY, 'digest.json'));
  const titles = new Map();
  for (const s of Array.isArray(digest?.sessions) ? digest.sessions : []) titles.set(s.id, s.title || '');
  const ids = (arr) => (Array.isArray(arr) ? arr : []).map((id) => ({ id, title: titles.get(id) || '' }));
  return {
    week: f?.week || null,
    portrait: (Array.isArray(f?.portrait) ? f.portrait : []).map((p) => ({ ...p, sessions: ids(p.sessions) })),
    repeats: (Array.isArray(f?.repeats) ? f.repeats : []).map((r) => ({ ...r, evidence: ids(r.evidence) })),
  };
}

export function uiHistory() {
  const rows = readJsonl(path.join(WEEKLY, 'history.jsonl'));
  const decisions = readJson(path.join(WEEKLY, 'decisions.json'), { decisions: [] });
  return {
    weeks: rows.map((r) => ({
      week: r.week, generatedAt: r.generatedAt || null,
      sessions: num(r.sessions), turns: num(r.turns),
      corrections: num(r.corrections), compactions: num(r.compactions),
      portrait: Array.isArray(r.portrait) ? r.portrait.length : 0,
      repeats: Array.isArray(r.repeats) ? r.repeats.length : 0,
      candidates: Array.isArray(r.candidates) ? r.candidates.length : 0,
      hasReport: Boolean(stat(path.join(WEEKLY, `${r.week}.html`)) || stat(path.join(WEEKLY, 'latest.html'))),
    })),
    decisions: (Array.isArray(decisions?.decisions) ? decisions.decisions : []).map((d) => ({
      key: d.key || null, title: d.candidate || null, verdict: d.verdict || null,
      where: d.where || null, at: d.landed_at || null, note: d.note || null,
    })),
  };
}
