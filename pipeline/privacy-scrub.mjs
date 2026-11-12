#!/usr/bin/env node
// 分析完成后清掉中间产物里的正文：digest 消息、packet 文件、logs。
// 用法: node privacy-scrub.mjs [--logs]
// 报告本身不删；需要分享用 redact-report.mjs 生成的 *.redacted.*。
import fs from 'node:fs';
import path from 'node:path';

const LEARNING = process.env.DSH_LEARNING || path.join(process.env.HOME || '', '.dsh', 'learning');
const WEEKLY = path.join(LEARNING, 'weekly');
const scrubDigest = (p) => {
  let d; try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 0; }
  let n = 0;
  for (const s of d.sessions || []) {
    for (const k of ['userMessages', 'recentMessages', 'intentMessages']) {
      if (s[k] && (Array.isArray(s[k]) ? s[k].length : String(s[k]).length)) { s[k] = []; n += 1; }
    }
    if (s.cwd) s.cwd = '<redacted>';
    for (const f of s.filesWritten || []) if (f?.path) f.path = '<redacted>';
  }
  fs.writeFileSync(p, JSON.stringify(d), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch {}
  return n;
};
let digests = 0, packets = 0;
for (const f of fs.readdirSync(WEEKLY)) {
  const p = path.join(WEEKLY, f);
  if (/^digest.*\.json$/.test(f)) { try { scrubDigest(p); digests += 1; } catch {} }
  if (/^packet.*\.md$/.test(f)) { fs.writeFileSync(p, '# packet 已脱敏\n\n正文已清除（privacy-scrub）。\n', { mode: 0o600 }); try { fs.chmodSync(p, 0o600); } catch {} packets += 1; }
}
let logs = 0;
if (process.argv.includes('--logs')) {
  const dir = path.join(LEARNING, 'logs');
  try { for (const f of fs.readdirSync(dir)) { try { fs.writeFileSync(path.join(dir, f), '', { mode: 0o600 }); logs += 1; } catch {} } } catch {}
}
console.log(JSON.stringify({ ok: true, digests, packets, logs }));
