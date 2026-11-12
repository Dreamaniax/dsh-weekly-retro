// 跨周记忆：每周一条记录，供下一周的分析参考。
// 设计目标：让周报「越跑越强」而不是每周从零重算。
// - 记录维度只到统计与模式文本，不含会话原文（脱敏）
// - 只标注「第 N 周出现」，不自动改分级（避免一周误判被固化成长期行为）
import fs from 'node:fs';
import path from 'node:path';

export function historyPath(WEEKLY) {
  return path.join(WEEKLY, 'history.jsonl');
}

export function readHistory(WEEKLY) {
  try {
    const raw = fs.readFileSync(historyPath(WEEKLY), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const rows = [];
    let bad = 0;
    for (const l of lines) { try { rows.push(JSON.parse(l)); } catch { bad++; } }
    if (bad && !readHistory.warned) {
      readHistory.warned = true;
      // 坏行不再静默：备份一份原文件，并明确告警（否则历史记忆会无声蒸发）
      const bak = `${historyPath(WEEKLY)}.corrupt-${Date.now()}`;
      try { fs.writeFileSync(bak, raw); } catch {}
      console.error(`[history] ⚠️ ${bad} 行无法解析，已备份到 ${path.basename(bak)}，本次只用可解析的 ${rows.length} 行`);
    } else if (bad && readHistory.warned) {
      readHistory.warnedCount = (readHistory.warnedCount || 0) + bad;
    }
    // 按周去重：同一周多行时保留最后一行（重复行会让「第 N 周出现」算大）
    const byWeek = new Map();
    for (const r of rows) if (r && r.week) byWeek.set(String(r.week), r);
    return [...byWeek.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));
  } catch { return []; }
}

export function upsertHistory(WEEKLY, rec) {
  const rows = readHistory(WEEKLY).filter((r) => r.week !== rec.week);
  rows.push(rec);
  rows.sort((a, b) => String(a.week).localeCompare(String(b.week)));
  fs.mkdirSync(WEEKLY, { recursive: true });
  const tmp = `${historyPath(WEEKLY)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(tmp, historyPath(WEEKLY));   // 原子替换：中途崩不会留半截文件
  return rows;
}

// 重复模式的稳定键：优先用 findings 里显式给的 key，否则按文本归一化
export function repeatKey(r) {
  if (r && r.key) return String(r.key).trim();
  const p = String((r && r.pattern) || '')
    .toLowerCase()
    .replace(/[0-9]+/g, 'N')
    .replace(/[^\p{Script=Han}a-z]+/gu, ' ')
    .trim();
  return p.split(/\s+/).slice(0, 8).join('-').slice(0, 64) || '(unknown)';
}

// 与本周对比：哪些重复模式/候选在更早的周里出现过
export function trendOf(rows, week) {
  const prev = rows.filter((r) => String(r.week) < String(week));
  const repeatWeeks = new Map();
  const candWeeks = new Map();
  for (const r of prev) {
    for (const it of r.repeats || []) {
      const k = it.key || repeatKey(it);
      if (!repeatWeeks.has(k)) repeatWeeks.set(k, []);
      repeatWeeks.get(k).push(r.week);
    }
    for (const it of r.candidates || []) {
      if (!candWeeks.has(it.key)) candWeeks.set(it.key, { weeks: [], last: null, lastWeek: null });
      const e = candWeeks.get(it.key);
      e.weeks.push(r.week);
      e.last = it.verdict;
      e.lastWeek = r.week;
    }
  }
  return { prev, repeatWeeks, candWeeks };
}

// 本周记录（体积很小：一周约 1-3KB）
export function buildRecord({ week, digest, sessions, corrections, portrait, repeats, candidates, skills }) {
  const main = sessions.filter((s) => s.origin === 'user');
  return {
    week,
    generatedAt: digest.generatedAt,
    windowEnd: digest.windowEnd || null,
    sessions: sessions.length,
    mainSessions: main.length,
    turns: main.reduce((a, s) => a + s.turns, 0),
    corrections,
    portrait: (portrait || []).map((p) => p.mainline || '').filter(Boolean),
    repeats: (repeats || []).map((r) => ({ key: repeatKey(r), pattern: r.pattern, count: r.count, status: r.status })),
    candidates: (candidates || []).map((c) => ({ key: c.key, title: c.title, shape: c.shape || null, verdict: c.verdict, total: c.total })),
    skills: skills || null,
  };
}
