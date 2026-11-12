// 数据层：只读 learning/ 产物 + 异步调用现有脚本。
// 设计约束：
// - 绝不重写流水线逻辑（唯一真相在 ~/.dsh/learning/scripts 与 dsh-config/weekly）
// - 绝不用 spawnSync（会阻塞宿主事件循环）；统一 async spawn + 超时 kill
// - 写操作绝不覆盖损坏文件（宁可失败，不可静默丢历史）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const LEARNING = process.env.DSH_LEARNING || path.join(os.homedir(), '.dsh', 'learning');
export const WEEKLY = path.join(LEARNING, 'weekly');

/** 生成物含会话标题/路径/消息摘要：默认收紧为本机 owner 可读写。 */
export function hardenArtifacts() {
  const chmod = (p, mode) => { try { fs.chmodSync(p, mode); } catch {} };
  chmod(WEEKLY, 0o700);
  try {
    for (const f of fs.readdirSync(WEEKLY)) {
      if (/\.(json|jsonl|md|html)$/.test(f) || f.includes('.bak-')) chmod(path.join(WEEKLY, f), 0o600);
    }
  } catch {}
  try {
    const logs = path.join(LEARNING, 'logs');
    chmod(logs, 0o700);
    for (const f of fs.readdirSync(logs)) chmod(path.join(logs, f), 0o600);
  } catch {}
}

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLED_SCRIPTS = path.join(PKG_ROOT, 'pipeline');
const USER_SCRIPTS = path.join(LEARNING, 'scripts');
// 发布版自带确定性流水线；本机已有用户脚本时优先用户版本（可定制）
export const SCRIPTS = process.env.DSH_WEEKLY_SCRIPTS
  || (fs.existsSync(path.join(USER_SCRIPTS, 'run-weekly.sh')) ? USER_SCRIPTS : BUNDLED_SCRIPTS);
export function resolveScript(name, { bundled = true } = {}) {
  if (process.env.DSH_WEEKLY_SCRIPTS) return path.join(process.env.DSH_WEEKLY_SCRIPTS, name);
  const user = path.join(USER_SCRIPTS, name);
  if (fs.existsSync(user)) return user;
  const packed = path.join(BUNDLED_SCRIPTS, name);
  if (bundled && fs.existsSync(packed)) return packed;
  return user;
}

const isWin = process.platform === 'win32';
const BASH = process.env.DSH_BASH || (isWin ? 'bash' : 'bash');

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** 严格读：区分「不存在」与「存在但损坏」，损坏时拒绝被当成默认值回写。 */
export function readJsonStrict(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { ok: true, value: null, missing: true }; }
  try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: `${file}: ${e?.message || e}` }; }
}

export function stat(file) {
  try {
    const s = fs.statSync(file);
    if (!s.isFile()) return null; // 目录/设备不算报告
    return { size: s.size, mtime: s.mtime.toISOString(), mtimeMs: s.mtimeMs };
  } catch { return null; }
}

function readHistory() {
  try {
    const rows = fs.readFileSync(path.join(WEEKLY, 'history.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && typeof r.week === 'string');
    // 同一周只保留最后一条（与 history.mjs 的按周语义一致）
    const byWeek = new Map();
    for (const r of rows) byWeek.set(r.week, r);
    return [...byWeek.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));
  } catch { return []; }
}

export function summary() {
  const digest = readJson(path.join(WEEKLY, 'digest.json'));
  const proposals = readJson(path.join(WEEKLY, 'proposals.json'));
  const findings = readJson(path.join(WEEKLY, 'findings.json'));
  const history = readHistory();
  const digestOk = Boolean(digest) && !Array.isArray(digest) && typeof digest === 'object' && Array.isArray(digest.sessions);
  const sessions = Array.isArray(digest?.sessions) ? digest.sessions.filter((x) => x && typeof x === 'object') : [];
  const main = sessions.filter((s) => s.origin === 'user');
  const compactions = sessions.reduce((a, x) => a + (Number(x.compactions) || 0), 0);
  const rejected = proposals?.findingsRejected || null;
  const proposalList = Array.isArray(proposals?.proposals) ? proposals.proposals : [];
  const findingsUsed = Boolean(findings) && !rejected;
  const cands = proposalList.map((c) => ({
    key: c.key, title: c.title, verdict: c.verdict, shape: c.shape || null, total: c.total ?? null,
    what: c.what ?? null, evidence: c.evidence ?? null, steps: c.steps ?? null,
    saving: c.saving ?? null, effort: c.effort ?? null, scores: c.scores ?? null,
    verdictWhy: c.verdictWhy ?? null, persist: c.persist ?? null, plugin_spec: c.plugin_spec ?? null,
  }));
  const report = stat(path.join(WEEKLY, 'latest.html'));
  const packet = stat(path.join(WEEKLY, 'packet.md'));
  return {
    ok: digestOk,
    week: proposals?.week || history.at(-1)?.week || null,
    sessions: sessions.length,
    mainSessions: main.length,
    turns: main.reduce((a, s) => a + (s.turns || 0), 0),
    // findings 被拒收时不再报告"画像/重复"，避免让人误以为分析有效
    portrait: findingsUsed ? (findings.portrait || []).length : null,
    repeats: findingsUsed ? (findings.repeats || []).length : null,
    findingsRejected: rejected,
    candidates: cands,
    skippedFiles: digest?.skippedFiles ?? 0,
    idleSessions: digest?.idleSessions ?? 0,
    // digest schema v3 顶层没有这两个键：compactions 按会话求和，corrections 取 proposals
    corrections: proposals?.corrections ?? digest?.corrections ?? null,
    compactions: digest?.compactions ?? (compactions || null),
    turnsAll: sessions.reduce((a, x) => a + (Number(x.turns) || 0), 0),
    skills: proposals?.skills ?? null,
    skippedLanded: Array.isArray(proposals?.skippedLanded) ? proposals.skippedLanded : [],
    trend: proposals?.trend ?? null,
    historyWeeks: history.map((r) => r.week),
    report: report ? { at: report.mtime, bytes: report.size } : null,
    packet: packet ? { at: packet.mtime, bytes: packet.size } : null,
  };
}

/** 报告 HTML：可选按周取回填产物 <week>.html，默认 latest.html */
export function reportHtml(week = null, { full = false } = {}) {
  const base = week || 'latest';
  const fullFile = path.join(WEEKLY, `${base}.html`);
  const redacted = path.join(WEEKLY, `${base}.redacted.html`);
  // 默认返回脱敏副本（若已生成）；本地要看完整版用 full:true
  const file = !full && process.env.DSH_WEEKLY_REPORT_FULL !== '1' && fs.existsSync(redacted) ? redacted : fullFile;
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/** 超时参数钳制：1s–180s，非法值回落默认（HTTP/工具都可传）。 */
export function clampTimeout(value, fallback = 120000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180000, Math.max(1000, Math.floor(n)));
}

const EXIT_KIND = { 0: 'ok', 1: 'pipeline-failed', 2: 'no-sessions', 3: 'locked', 4: 'selftest-failed' };
export { EXIT_KIND };

export function kindOf(code) {
  return EXIT_KIND[code] ?? (code === null ? 'killed' : 'failed');
}

/** 异步跑子进程；超时 kill，返回 tail。永不抛异常。 */
function runProcess(cmd, args, { env = process.env, timeoutMs = 180000, maxTail = 25 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let killed = false;
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      resolve({ ok: false, kind: 'spawn-error', code: null, ms: 0, tail: String(e?.message || e) });
      return;
    }
    const timer = setTimeout(() => {
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    }, timeoutMs);
    const append = (b) => { out += b.toString(); if (out.length > 1 << 20) out = out.slice(-(1 << 20)); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, kind: 'spawn-error', code: null, ms: Date.now() - started, tail: String(e?.message || e) });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const kind = killed ? 'timeout' : kindOf(code);
      resolve({
        ok: code === 0 || code === 4,
        kind, code: code ?? null, signal: signal || null, killed, timeout: killed,
        ms: Date.now() - started,
        tail: out.trim().split('\n').slice(-maxTail).join('\n'),
        head: out.trim().split('\n').slice(0, 3).join('\n'),
      });
    });
  });
}

/** 生成分享用脱敏副本（*.redacted.*）；失败不影响主报告。 */
async function redactReports({ timeoutMs = 30000 } = {}) {
  const script = resolveScript('redact-report.mjs');
  if (!fs.existsSync(script)) return { ok: false, kind: 'missing-script' };
  return runProcess(process.execPath, [script], {
    env: { ...process.env, DSH_LEARNING: LEARNING },
    timeoutMs,
    maxTail: 6,
  });
}

/** 只重跑报告（report.mjs → report-html.mjs），不重新采集。对应技能步骤 5。 */
export async function regenerateReport({ timeoutMs = 120000, windowEnd = null } = {}) {
  const lock = await acquireLock(WEEKLY, '.weekly.lock');
  if (!lock.ok) return { ok: false, kind: 'locked', ms: 0, tail: lock.error || '已有流水线在跑（.weekly.lock）' };
  try {
  const env = { ...process.env, DSH_NO_NOTIFY: '1' };
  if (windowEnd) env.DSH_WINDOW_END = windowEnd;
  const started = Date.now();
  for (const [file, label] of [['report.mjs', 'md'], ['report-html.mjs', 'html']]) {
    const abs = resolveScript(file);
    if (!fs.existsSync(abs)) {
      return { ok: false, kind: 'missing-script', code: null, ms: Date.now() - started, tail: `找不到 ${abs}` };
    }
    const r = await runProcess(process.execPath, [abs], { env, timeoutMs, maxTail: 20 });
    if (!r.ok) return { ...r, kind: `${label}-${r.kind}`, ms: Date.now() - started };
  }
  await redactReports({ timeoutMs: Math.min(timeoutMs, 30000) });
  return { ok: true, kind: 'report-ok', code: 0, ms: Date.now() - started, tail: '报告已重跑（未重新采集；已生成脱敏副本）' };
  } finally { lock.release?.(); hardenArtifacts(); }
}

/**
 * 跑周报。
 * mode='report' 只重跑报告（技能步骤 5）；mode='full' 跑整条 run-weekly.sh。
 * windowEnd 透传 DSH_WINDOW_END，用于回填某周。
 */
/** 超时被 SIGKILL 后，run-weekly 的 .weekly.lock 可能残留；仅在持有者已死时清理。 */
export function cleanupStaleWeeklyLock() {
  const lock = path.join(WEEKLY, '.weekly.lock');
  let st;
  try { st = fs.statSync(lock); } catch { return { cleaned: false, reason: 'no-lock' }; }
  const pidFile = path.join(lock, 'pid');
  let raw = null;
  try { raw = fs.readFileSync(pidFile, 'utf8').trim(); } catch {}
  if (raw && pidAlive(Number(raw))) return { cleaned: false, reason: 'held-by-live-pid' };
  if (!raw && Date.now() - st.mtimeMs < 2000) return { cleaned: false, reason: 'too-young-no-pid' };
  try { fs.rmSync(lock, { recursive: true, force: true }); return { cleaned: true, reason: raw ? 'dead-pid' : 'stale-no-pid' }; }
  catch (e) { return { cleaned: false, reason: String(e?.message || e) }; }
}

let pipelineRunning = false;

function artifactSignature() {
  const html = stat(path.join(WEEKLY, 'latest.html'));
  const digest = stat(path.join(WEEKLY, 'digest.json'));
  return `${html?.mtimeMs ?? 0}:${digest?.mtimeMs ?? 0}`;
}

export async function runPipeline({ timeoutMs = 120000, noSelftest = true, windowEnd = null, mode = 'full' } = {}) {
  if (pipelineRunning) return { ok: false, kind: 'busy', ms: 0, tail: '已有流水线在执行（单飞限制），稍后再试' };
  pipelineRunning = true;
  const effectiveTimeout = clampTimeout(timeoutMs);
  try {
    const before = artifactSignature();
    const r = await runWeekly({ timeoutMs: effectiveTimeout, noSelftest, windowEnd, mode });
    if (r.kind === 'timeout' || r.kind === 'killed') r.lockCleanup = cleanupStaleWeeklyLock();
    // exit 0 但产物没更新 = 假成功（C 审计 6c）
    if (r.ok && artifactSignature() === before) {
      return { ...r, ok: false, kind: 'no-artifacts', tail: `脚本退出 0 但没有更新 digest/latest.html\n${r.tail || ''}`.trim() };
    }
    if (r.ok) await redactReports({ timeoutMs: Math.min(effectiveTimeout, 30000) });
    return r;
  } finally {
    pipelineRunning = false;
    hardenArtifacts();
  }
}

async function runWeekly({ timeoutMs = 120000, noSelftest = true, windowEnd = null, mode = 'full' } = {}) {
  if (mode === 'report') return regenerateReport({ timeoutMs: Math.min(timeoutMs, 120000), windowEnd });
  if (windowEnd && Number.isNaN(Date.parse(windowEnd))) {
    return { ok: false, kind: 'bad-windowEnd', code: null, ms: 0, tail: `windowEnd 不是合法时间：${windowEnd}` };
  }
  const script = resolveScript('run-weekly.sh');
  if (!fs.existsSync(script)) {
    return { ok: false, kind: 'missing-script', code: null, ms: 0, tail: `找不到 ${script}` };
  }
  const env = { ...process.env, DSH_NO_NOTIFY: '1' };
  if (noSelftest) env.DSH_NO_SELFTEST = '1';
  if (windowEnd) env.DSH_WINDOW_END = windowEnd;
  return runProcess(BASH, [script], { env, timeoutMs, maxTail: 25 });
}

/** 落地后同步（AGENTS.md：落地即同步）。失败不抛，交给调用方标注。 */
export async function syncLanding(message) {
  const script = resolveScript('land-sync.sh', { bundled: false });
  if (!fs.existsSync(script)) return { ok: false, error: `找不到 ${script}` };
  const r = await runProcess(BASH, [script, message || '周报候选落地'], { timeoutMs: 120000, maxTail: 12 });
  let commit = null;
  if (r.ok) {
    const repo = [path.join(os.homedir(), 'dsh-config'), path.join(os.homedir(), 'Documents', 'deepseek-harness', 'dsh-config')]
      .find((d) => fs.existsSync(path.join(d, '.git')));
    if (repo) {
      const g = await runProcess('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 10000, maxTail: 3 });
      if (g.ok) commit = g.tail.trim().split('\n').pop() || null;
    }
  }
  return { ok: r.ok, code: r.code, commit, tail: r.tail, error: r.ok ? null : r.tail };
}

function sameKey(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = (x) => String(x).split(':').pop();
  if (short(a) === short(b)) return true;
  return a.endsWith(`-${b}`) || b.endsWith(`-${a}`);
}

/**
 * 采纳候选：写 decisions.json（写前备份、原子替换、损坏拒绝覆盖），然后落地同步。
 * 返回 {ok, kind, key, where, synced, commit, backup, error}
 */
const LOCK_RETRY_MS = 25;
const LOCK_TRIES = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === 'EPERM'; } // 无权限查 = 进程存在（S 审计：EPERM 曾被杀进程误判）
}

/** 目录级互斥（跨进程）。
 * 修复（S 审计 P1）：① mkdir 后原子写 pid（tmp+rename），不留"无 pid 窗口"；
 * ② 无 pid 时先等待确认，只有目录明显陈旧（>2s）才自愈；③ EPERM 视为存活。 */
async function acquireLock(dir, name) {
  const lock = path.join(dir, name);
  const pidFile = path.join(lock, 'pid');
  const writePid = () => {
    const tmp = path.join(lock, `.pid.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmp, String(process.pid));
    fs.renameSync(tmp, pidFile);
  };
  for (let i = 0; i < LOCK_TRIES; i += 1) {
    try {
      fs.mkdirSync(lock);
      try { writePid(); } catch (e) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} ; return { ok: false, error: `写锁失败：${e?.message || e}` }; }
      return { ok: true, release: () => { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} } };
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, error: String(e?.message || e) };
      let raw = null;
      try { raw = fs.readFileSync(pidFile, 'utf8').trim(); } catch {}
      if (raw) {
        if (pidAlive(Number(raw))) { await sleep(LOCK_RETRY_MS); continue; }
        try { fs.rmSync(lock, { recursive: true, force: true }); } catch {}
        continue;
      }
      // 没有 pid：可能是对方刚 mkdir 的窗口，等到目录老化超 2s 才清理
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(lock).mtimeMs; } catch {}
      if (ageMs > 2000) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} continue; }
      await sleep(LOCK_RETRY_MS);
    }
  }
  return { ok: false, error: `目录锁被占用：${lock}` };
}

export async function land(key, { note = '', sync = true } = {}) {
  const file = path.join(WEEKLY, 'decisions.json');
  const proposalsRead = readJsonStrict(path.join(WEEKLY, 'proposals.json'));
  if (!proposalsRead.ok) return { ok: false, kind: 'proposals-corrupt', error: proposalsRead.error };
  const proposals = proposalsRead.value || { proposals: [] };
  if (proposals.proposals !== undefined && !Array.isArray(proposals.proposals)) {
    return { ok: false, kind: 'proposals-corrupt', error: 'proposals.json 的 proposals 字段不是数组，已拒绝处理' };
  }
  const cand = (proposals.proposals || []).find((c) => c.key === key);
  if (!cand) return { ok: false, kind: 'unknown-key', error: `proposals.json 里没有候选 ${key}` };

  const lock = await acquireLock(WEEKLY, '.decisions.lock');
  if (!lock.ok) return { ok: false, kind: 'locked', error: lock.error };
  try {
  const decRead = readJsonStrict(file);
  if (!decRead.ok) {
    // 关键：文件存在但损坏时，绝不回写默认值（否则静默丢历史）
    return { ok: false, kind: 'decisions-corrupt', error: `decisions.json 无法解析，已拒绝写入以免覆盖历史：${decRead.error}` };
  }
  const raw = decRead.missing ? null : decRead.value;
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { ok: false, kind: 'decisions-corrupt', error: 'decisions.json 顶层不是对象，已拒绝写入' };
  }
  if (raw && raw.decisions !== undefined && !Array.isArray(raw.decisions)) {
    return { ok: false, kind: 'decisions-corrupt', error: 'decisions.json 的 decisions 字段不是数组，已拒绝写入' };
  }
  const dec = raw || { decisions: [] };
  const decisions = Array.isArray(dec.decisions) ? dec.decisions : [];
  const dup = decisions.find((d) => sameKey(d.key, key) || sameKey(d.candidate, cand.title));
  if (dup) return { ok: true, already: true, key, where: dup.where ?? null };

  let backup = null;
  if (!decRead.missing) {
    backup = `${file}.bak-${Date.now()}`;
    try { fs.copyFileSync(file, backup); } catch { backup = null; }
  }

  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    week: proposals.week || null, key, candidate: cand.title, verdict: cand.verdict,
    landed_at: today, where: sync ? '落地中…' : 'dsh-weekly-retro 插件', note,
  };
  const write = (data) => {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  };
  const withEntry = (where) => ({ ...dec, decisions: [...decisions, { ...entry, where }] });

  write(withEntry(entry.where));
  if (!sync) return { ok: true, key, where: entry.where, synced: null, backup: backup ? path.basename(backup) : null };

  const s = await syncLanding(`落地候选 ${key}（${proposals.week || '周报'}）`);
  const where = s.ok ? `已同步 · commit ${s.commit || '?'}` : '已落地但未同步';
  const final = { ...dec, decisions: [...decisions, { ...entry, where, syncError: s.ok ? undefined : (s.error || s.tail || 'unknown') }] };
  try { write(final); } catch (e) {
    return { ok: true, key, where: entry.where, synced: false, error: `同步后回写 where 失败：${e?.message || e}` };
  }
  return {
    ok: true, key, where, synced: s.ok, commit: s.commit || null,
    syncTail: s.ok ? null : (s.tail || '').split('\n').slice(-6).join('\n'),
    backup: backup ? path.basename(backup) : null,
  };
  } finally {
    lock.release?.();
    hardenArtifacts();
  }
}

/** 校验 findings.json；list=true 时只列会话 id（技能步骤 3 的 --list） */
export async function validateFindings({ list = false, file = null, timeoutMs = 30000 } = {}) {
  // 隐私边界：只允许校验 weekly/ 下的文件，避免变成任意 JSON 读取器
  if (file) {
    const resolved = path.resolve(file);
    const root = path.resolve(WEEKLY);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { ok: false, kind: 'invalid-path', error: 'file 必须位于 weekly/ 目录内' };
    }
  }
  const script = resolveScript('check-findings.mjs');
  if (!fs.existsSync(script)) return { ok: false, kind: 'missing-script', error: `找不到 ${script}` };
  const args = [script];
  if (list) args.push('--list');
  else if (file) args.push(path.resolve(file));
  const r = await runProcess(process.execPath, args, { timeoutMs, maxTail: 8 });
  return { ok: r.ok, kind: r.kind, code: r.code, text: r.tail, errorFirst: r.ok ? null : (r.head || '').split('\n')[0] || null, timeout: Boolean(r.timeout) };
}
