#!/usr/bin/env node
// 分享前脱敏：把周报里的会话标题/工作区路径/候选标题替换为占位符。
// 用法: node redact-report.mjs [--in-place] [file...]
// 默认写 *.redacted.md/html，保留原文件（0600）。
import fs from 'node:fs';
import path from 'node:path';

const LEARNING = process.env.DSH_LEARNING || path.join(process.env.HOME || '', '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
const args = process.argv.slice(2);
const inPlace = args.includes('--in-place');
const files = args.filter((a) => !a.startsWith('--'));

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const digest = read(path.join(WEEKLY, 'digest.json'), { sessions: [] });
const proposals = read(path.join(WEEKLY, 'proposals.json'), { proposals: [] });
const findings = read(path.join(WEEKLY, 'findings.json'), { portrait: [], repeats: [] });
const decisions = read(path.join(WEEKLY, 'decisions.json'), { decisions: [] });
const pairs = [];
for (const s of digest.sessions || []) {
  if (s.title) pairs.push([String(s.title), `会话 #${String(s.id || '').slice(-4) || '????'}`]);
  if (s.cwd) pairs.push([String(s.cwd), '<workspace>']);
  for (const f of s.filesWritten || []) if (f?.path) pairs.push([String(f.path), '<path>']);
}
const workspaces = Array.isArray(digest.byWorkspace) ? digest.byWorkspace.map((w) => w?.workspace) : Object.keys(digest.byWorkspace || {});
for (const w of workspaces) if (w) pairs.push([String(w), '<workspace>']);
(proposals.proposals || []).forEach((c, i) => { if (c.title) pairs.push([String(c.title), `候选 #${i + 1}`]); });
for (const s of proposals.skills?.used || []) if (s) pairs.push([String(s), '<skill>']);
for (const s of digest.sessions || []) { for (const k of Object.keys(s.skillsCalled || {})) pairs.push([String(k), '<skill>']); }
for (const p of findings.portrait || []) for (const o of p.outputs || []) if (o) pairs.push([String(o), '<output>']);
for (const p of findings.portrait || []) { if (p.mainline) pairs.push([String(p.mainline), '<主线>']); if (p.goal) pairs.push([String(p.goal), '<目标>']); }
for (const r of findings.repeats || []) if (r.pattern) pairs.push([String(r.pattern), '<重复动作>']);
for (const d of decisions.decisions || []) if (d.candidate) pairs.push([String(d.candidate), '<候选>']);

const targets = files.length ? files : fs.readdirSync(WEEKLY).filter((f) => /\.(md|html)$/.test(f) && !f.includes('.redacted.') && !f.startsWith('packet'));
const out = [];
for (const name of targets) {
  const src = path.isAbsolute(name) ? name : path.join(WEEKLY, name);
  if (!fs.existsSync(src)) continue;
  let text = fs.readFileSync(src, 'utf8');
  for (const [from, to] of pairs.sort((a, b) => b[0].length - a[0].length)) {
    if (from && text.includes(from)) text = text.split(from).join(to);
  }
  // 兜底：仍残留的本机绝对路径
  text = text.replace(/~\/[^\s<>"']+/g, '<path>')
    .replace(/\/Users\/[^\s<>"']+/g, '<path>')
    .replace(/[A-Za-z]:\\[^\s<>"']+/g, '<path>');
  const dst = inPlace ? src : src.replace(/\.(md|html)$/, '.redacted.$1');
  fs.writeFileSync(dst, text, { mode: 0o600 });
  out.push(dst);
}
console.log(JSON.stringify({ ok: true, files: out }));
