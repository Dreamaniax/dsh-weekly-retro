#!/usr/bin/env node
// 采集 ~/.dsh/sessions 下所有工作区最近 N 天的会话，输出结构化 digest。
// 用法: node collect.mjs [days]   （默认 7）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileAtomic } from './atomic-write.mjs';

const ROOT = process.env.DSH_SESSIONS || path.join(os.homedir(), '.dsh', 'sessions');
const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
const OUT_DIR = path.join(LEARNING, 'weekly');
const days = Number(process.argv[2] || process.env.DSH_WEEKLY_DAYS || 7);
if (!Number.isFinite(days) || days <= 0) { console.error(`DSH_WEEKLY_DAYS 非法：${process.argv[2] || process.env.DSH_WEEKLY_DAYS}`); process.exit(2); }
// 窗口终点可锚定：回填历史周报时用 DSH_WINDOW_END=<ISO 时间>，默认现在
const END = process.env.DSH_WINDOW_END ? Date.parse(process.env.DSH_WINDOW_END) : Date.now();
if (Number.isNaN(END)) { console.error('DSH_WINDOW_END 解析失败，需要 ISO 时间，如 2026-11-08T22:00:00+08:00'); process.exit(2); }
const cutoff = END - days * 86400e3;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl.zstd')) out.push(p);
  }
  return out;
}

// 会话文件是多帧 zstd，node 自带解压只读第一帧 → 用 zstd CLI（自动找，可 DSH_ZSTD 覆盖）
function whichZstd() {
  if (process.env.DSH_ZSTD) return process.env.DSH_ZSTD;
  const probe = spawnSync('zstd', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'zstd';
  const exe = process.platform === 'win32' ? 'zstd.exe' : 'zstd';
  const cands = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe),
    process.env.ProgramData && path.join(process.env.ProgramData, 'chocolatey', 'bin', exe),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'zstd', exe),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'scoop', 'shims', exe),
    '/opt/homebrew/bin/zstd', '/usr/local/bin/zstd', '/usr/bin/zstd',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  // winget 把 exe 放在版本化包目录里（不建 Links 别名），直接扫
  const wgRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (wgRoot && fs.existsSync(wgRoot)) {
    const walk = (dir, depth) => {
      if (depth > 3) return null;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
      for (const e of entries) {
        const p2 = path.join(dir, e.name);
        if (e.isFile() && e.name.toLowerCase() === exe.toLowerCase()) return p2;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const r = walk(path.join(dir, e.name), depth + 1);
        if (r) return r;
      }
      return null;
    };
    const found = walk(wgRoot, 0);
    if (found) return found;
  }
  return null;
}

const ZSTD = whichZstd();
if (!ZSTD) {
  console.error('找不到 zstd：会话文件是多帧 zstd，需要它的 CLI 才能完整解压。');
  console.error('  安装：macOS `brew install zstd` / Windows `winget install Meta.Zstandard` 或 `scoop install zstd`');
  console.error('  也可以设 DSH_ZSTD=/path/to/zstd 指向已有二进制。');
  process.exit(2);
}

function readJsonl(file) {
  const r = spawnSync(ZSTD, ['-dc', file], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.toString('utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

function argPath(args) {
  try { const a = JSON.parse(args || '{}'); return a.file_path || a.path || a.notebook_path || null; } catch { return null; }
}

// ---------- 工作流形状：工具序列 / 命令聚类 / 活跃时段 ----------
// 目的：让「一次会话中做了什么流程」可被分析，而不是只留下计数。
// 只存形状不存正文 —— 体积可控（一个 35 轮的会话约 1-2KB）。
const SHORT_TOOL = (n) => String(n)
  .replace(/^mcp__anysearch__/, 'anysearch:')
  .replace(/^mcp__/, 'mcp:');

function seqShape(seq) {
  const out = [];
  for (const raw of seq) {
    const n = SHORT_TOOL(raw);
    const last = out[out.length - 1];
    if (last && last.n === n) last.c++;
    else out.push({ n, c: 1 });
  }
  return out.map((x) => (x.c > 1 ? `${x.n}×${x.c}` : x.n)).join('>');
}

function cmdKey(cmd) {
  const raw = String(cmd || '').trim();
  if (!raw) return null;
  const NOISE = /^(cd|export|set|echo|printf|true|test|sleep|mkdir|chmod|source)$/;
  for (const seg of raw.split(/\s*(?:&&|\|\||;|\n)\s*/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < toks.length && /^[A-Z_][A-Z0-9_]*=/.test(toks[i])) i++;
    if (i >= toks.length) continue;
    const head = toks[i].replace(/\.exe$/i, '');
    if (NOISE.test(head)) continue;
    const next = toks[i + 1] || '';
    const next2 = toks[i + 2] || '';
    let sub = '';
    if (/^(python3?|node|deno|bun)$/.test(head) && next === '-m' && next2 && !next2.startsWith('-')) {
      sub = `-m ${next2}`;
    } else if (next === '-c' || next === '-e') {
      sub = next; // 区分「内联脚本」与「跑文件」
    } else if (next && !next.startsWith('-') && next !== '&&' && next !== '||' && !next.startsWith('$')) {
      sub = next.includes('/') ? path.basename(next) : next;
      if (sub.length > 24) sub = '';
    }
    return (sub ? `${head} ${sub}` : head).slice(0, 48);
  }
  return null;
}

// 用户诉求线：太长时取「开头 4 条 + 结尾 8 条」，去重
function intentOf(users) {
  const pick = users.length <= 12 ? users : [...users.slice(0, 4), ...users.slice(-8)];
  const seen = new Set();
  const out = [];
  for (const m of pick) {
    const k = m.slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// 「窗口内有活动」只认真正的活动事件；session/title、model/selection 这类不算
const ACTIVITY = new Set(['user/message', 'assistant/message', 'tool/call', 'turn/start', 'step/start']);

// 技能库规模：用于「库里有 149 个，本周只用了 N 个」这类对照
const SKILL_DIR = path.join(os.homedir(), '.dsh', 'skills');
let skillLibraryCount = 0;
try { skillLibraryCount = fs.readdirSync(SKILL_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILL_DIR, e.name, 'SKILL.md'))).length; } catch {}

const files = walk(ROOT);
const sessions = [];
const skipped = [];
let idle = 0;

for (const f of files) {
  try {
    const ev = readJsonl(f);
    if (!ev.length) { skipped.push(path.basename(path.dirname(f))); continue; }
    const head = ev.find((e) => e.type === 'session') || {};
    let title = '', users = [], tools = {}, filesWritten = new Map(), bashCmds = [];
    let last = 0, turns = 0, assistant = 0, errors = 0;
    let hadInWindow = false;   // 窗口内是否真有活动（决定这个会话算不算本周）
    const turnSeqs = [];        // 每轮的工具序列
    let curSeq = [];
    const hourHits = new Array(24).fill(0);
    // v3：上下文侧信号（借鉴 dsh-context：surface vs archive、事件、粒度）
    let allTurns = 0;           // 文件里全部 turn/start（含窗口外，用来算 archive 规模）
    let stepsN = 0;             // step/start 计数（比 turn 细得多）
    let compactions = 0;        // 上下文压缩次数（长任务煎熬的硬证据）
    let model = '', contextWindow = 0;
    const dayHits = {};         // 按天的事件数（对应 ActivityDay）
    // schema 3 起：技能遥测（哪些技能真被调用、失败几次）
    const skillsCalled = {};
    const skillFails = {};
    const callSkill = new Map();   // callId -> skillName
    // 跳过注入内容：系统提醒、技能正文、子 agent 人设、队友消息、后台子任务回执
    const SKIP_MSG = /^(<system-reminder|<hindsight_knowledge|<skill_content|PUA_RUNTIME_V1|Current runtime context|Time sampled while preparing|<referenced-sessions>|Team message from|Background subagent|You are an AI agent)/;

    for (const d of ev) {
      const t = d.type;
      if (d.time && d.time > END) continue;   // 窗口终点之后的事件不算（回填历史用）
      if (t === 'turn/start') allTurns++;
      // 只统计窗口内的活动：跨周会话不会被上上周的轮次灌水（digest v2 行为修正）
      if (d.time && d.time < cutoff && t !== 'session') continue;
      if (d.time && d.time >= cutoff && ACTIVITY.has(t)) hadInWindow = true;
      if (t === 'session/title') title = d.data?.title || title;
      else if (t === 'user/message') {
        const txt = (d.data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
        if (/automatically generated checkpoint condensing/i.test(txt)) compactions++;  // 压缩事实，不是用户诉求
        else if (txt && !txt.startsWith('你是') && !SKIP_MSG.test(txt)) users.push(txt.replace(/\s+/g, ' ').slice(0, 400)); // 跳过子 agent 人设与注入内容
      } else if (t === 'assistant/message') assistant++;
      else if (t === 'step/start') stepsN++;
      else if (t === 'request/context') {
        const c = d.data || {};
        if (c.model) model = c.model;
        if (c.contextWindow) contextWindow = c.contextWindow;
      }
      else if (t === 'tool/call') {
        const n = d.data?.name || '?';
        tools[n] = (tools[n] || 0) + 1;
        curSeq.push(n);
        if (['write', 'edit'].includes(n)) { const p = argPath(d.data?.arguments); if (p) filesWritten.set(p, (filesWritten.get(p) || 0) + 1); }
        if (n === 'bash') { try { const a = JSON.parse(d.data?.arguments || '{}'); if (a.command) bashCmds.push(String(a.command).replace(/\s+/g, ' ').slice(0, 140)); } catch {} }
        if (n === 'skill') {
          try {
            const a = JSON.parse(d.data?.arguments || '{}');
            const sn = String(a.name || '').trim();
            if (sn) { skillsCalled[sn] = (skillsCalled[sn] || 0) + 1; if (d.data?.callId) callSkill.set(d.data.callId, sn); }
          } catch {}
        }
      } else if (t === 'tool/result') {
        const msg = d.data?.message || {};
        const c = msg.content;
        const s = JSON.stringify(c || '');
        if (/"is_error":\s*true|exitCode[^0-9-]*[1-9]/.test(s)) errors++;
        const sn = callSkill.get(msg.toolCallId);
        if (sn && msg.isError) skillFails[sn] = (skillFails[sn] || 0) + 1;
      } else if (t === 'turn/start') {
        if (curSeq.length) turnSeqs.push(curSeq);
        curSeq = [];
        turns++;
      }
      if (d.time) {
        last = Math.max(last, d.time);
        const dt = new Date(d.time);
        hourHits[dt.getHours()]++;
        const day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        dayHits[day] = (dayHits[day] || 0) + 1;
      }
    }
    if (curSeq.length) turnSeqs.push(curSeq);

    const cmdClusters = (() => {
      const m = new Map();
      for (const c of bashCmds) { const k = cmdKey(c); if (k) m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cmd, n]) => ({ cmd, n }));
    })();
    // 长会话只留「前 16 后 8」轮骨架，避免 digest 膨胀
    const shapeTurns = turnSeqs.length <= 24 ? turnSeqs : [...turnSeqs.slice(0, 16), ...turnSeqs.slice(-8)];

    const created = head.createdAt || 0;
    // 没有窗口内活动就不算本周：避免回填/正常跑时把「只有会话头」的空会话算进来
    // 窗口内没活动 = 归档态会话，不是坏文件：单独计数，别再混进 skippedFiles
    if (!hadInWindow) { idle++; continue; }
    sessions.push({
      id: head.id || path.basename(path.dirname(f)),
      cwd: head.cwd || '',
      origin: head.origin || 'user',
      parent: head.parentSession || null,
      created, last, title,
      turns, assistant, errors,
      userMessages: users.slice(0, 6),
      userMessageCount: users.length,
      recentMessages: users.length > 6 ? users.slice(-40).map((m) => m.slice(0, 200)) : [],
      // v2：分析用上下文（不存 assistant 正文，只存形状）
      intentMessages: intentOf(users),
      turnShapes: shapeTurns.map(seqShape),
      turnShapeTotal: turnSeqs.length,
      skillsCalled,
      skillFails,
      // v3 上下文信号
      steps: stepsN,
      model,
      contextWindow,
      compactions,
      preWindowTurns: Math.max(0, allTurns - turns),
      dayHits,
      cmdClusters,
      hourHits,
      tools,
      filesWritten: [...filesWritten.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => ({ path: p, n })),
    });
  } catch (e) {
    skipped.push(path.basename(path.dirname(f)));
  }
}

sessions.sort((a, b) => b.last - a.last);

const byWorkspace = {};
for (const s of sessions) {
  const key = s.cwd || '(unknown)';
  const w = (byWorkspace[key] = byWorkspace[key] || { sessions: 0, turns: 0, userMessages: 0, tools: {}, files: new Map(), titles: [] });
  w.sessions++; w.turns += s.turns; w.userMessages += s.userMessageCount ?? s.userMessages.length;
  if (s.title && !w.titles.includes(s.title)) w.titles.push(s.title);
  for (const [n, c] of Object.entries(s.tools)) w.tools[n] = (w.tools[n] || 0) + c;
  for (const f of s.filesWritten) w.files.set(f.path, (w.files.get(f.path) || 0) + f.n);
}

const digest = {
  schema: 3,
  generatedAt: new Date().toISOString(),
  windowEnd: new Date(END).toISOString(),
  skillLibraryCount,
  windowDays: days,
  sessionFilesScanned: files.length,
  skippedFiles: skipped.length,      // 真正读不了/解压失败的文件
  idleSessions: idle,               // 窗口内没有活动的归档态会话（不是错误）
  totalSessions: sessions.length,
  byWorkspace: Object.fromEntries(Object.entries(byWorkspace).map(([k, w]) => [k, {
    sessions: w.sessions, turns: w.turns, userMessages: w.userMessages,
    topTools: Object.entries(w.tools).sort((a, b) => b[1] - a[1]).slice(0, 10),
    titles: w.titles.slice(0, 20),
    topFiles: [...w.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, n]) => ({ path: p, n })),
  }])),
  sessions,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'digest.json');
writeFileAtomic(outFile, JSON.stringify(digest, null, 1));
console.log(`[collect] 扫描 ${files.length} 个会话文件，命中 ${days} 天内 ${sessions.length} 个会话 → ${outFile}`);
