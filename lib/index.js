// dsh-weekly-retro — host 半：工具 + /weekly 命令 + 路由（只读 + 受保护的写操作）。
// 安全约束：
// - 写路由（run/land）只允许同源请求或带 X-Weekly-Token（防任意网页 CSRF）
// - 方法错误一律 405；业务失败映射 4xx/5xx，绝不"成功 200 + ok:false"
// - 子进程全部异步，不阻塞宿主事件循环
import { summary, reportHtml, runPipeline, land, createCandidateFromRepeat, validateFindings, clampTimeout } from './data.js';
import { uiOverview, uiMetrics, uiCandidates, uiFindings, uiHistory } from './ui-data.js';

export const name = 'dsh-weekly-retro';
export const inject = ['tools', 'webServer'];

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const diag = { tools: false, toolCount: 0, toolError: null, commands: false, routes: 0, mountedAt: null };

const send = (res, code, obj) => {
  if (res.writableEnded) return;
  res.writeHead(code, JSON_HEADERS);
  res.end(JSON.stringify(obj));
};

/** 本机回环判断：用于阻止把周报数据暴露到局域网/公网。 */
export function isLoopbackRequest(req) {
  const raw = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  if (!raw) return true; // 无 TCP 信息（进程内调用）按本机处理
  const addr = String(raw).replace(/^::ffff:/i, '');
  return addr === '::1' || addr === '127.0.0.1' || addr.startsWith('127.');
}

/** 读路由同样只允许本机；远程需显式 DSH_WEEKLY_ALLOW_REMOTE=1 或 X-Weekly-Token。 */
export function remoteAllowed(req, token = process.env.DSH_WEEKLY_TOKEN) {
  if (isLoopbackRequest(req)) return true;
  if (process.env.DSH_WEEKLY_ALLOW_REMOTE === '1') return true;
  if (token && req?.headers?.['x-weekly-token'] === token) return true;
  return false;
}

/** 写操作安全门：同源（Origin 与 Host 一致）或携带 X-Weekly-Token。 */
export function mutatingAllowed(req, token = process.env.DSH_WEEKLY_TOKEN) {
  const origin = req?.headers?.origin;
  const given = req?.headers?.['x-weekly-token'];
  // token 是外部调用方的“附加通道”，不能因此把同源面板自己锁死
  if (token && given) return given === token;
  if (!origin) return true; // 非浏览器调用（curl / 插件内部）
  try { return new URL(origin).host === String(req.headers.host || ''); } catch { return false; }
}

/** 结果 → HTTP 状态码（不再用 200 掩盖失败）。 */
export function httpStatus(result) {
  if (!result) return 500;
  if (result.ok) return 200;
  switch (result.kind) {
    case 'unknown-key':
    case 'bad-windowEnd':
    case 'decisions-corrupt':
    case 'proposals-corrupt':
    case 'missing-key':
      return 400;
    case 'locked':
    case 'busy':
      return 409;
    case 'no-sessions':
      return 422;
    case 'repeat-not-found':
      return 404;
    case 'bad-repeat':
      return 400;
    case 'missing-script':
      return 503;
    case 'timeout':
      return 504;
    default:
      return 500;
  }
}

export function kindText(r) {
  const ms = r?.ms ?? 0;
  switch (r?.kind) {
    case 'ok': return `周报已生成（${ms}ms）\n${r.tail || ''}`.trim();
    case 'selftest-failed': return `报告已生成，但自检未通过（exit 4，不算生成失败）\n${r.tail || ''}`.trim();
    case 'report-ok': return `报告已重跑（未重新采集，${ms}ms）`;
    case 'no-sessions': return '本周没有可分析的会话（fail-closed，未覆盖旧报告）';
    case 'locked': return '已有周报在跑（单实例锁），稍后再试';
    case 'timeout': return `子进程超时被杀（${ms}ms）`;
    case 'missing-script': return '找不到流水线脚本（run-weekly.sh / report.mjs）';
    case 'bad-windowEnd': return r.tail || 'windowEnd 非法';
    case 'busy': return '已有流水线在执行（单飞限制），稍后再试';
    case 'no-artifacts': return '脚本退出 0 但没有更新产物——按失败处理（假成功拦截）';
    default: return `执行失败（kind=${r?.kind ?? '?'}, exit=${r?.code ?? '?'}）\n${r?.tail || ''}`.trim();
  }
}

// 导出给测试：确保 /weekly 命令与 /summary 路由用同一套文案（命令只能聊天触发，靠这个可测）
export const formatStatus = (s) => [
  `周报 ${s.week || '(未生成)'} · ${s.sessions} 会话（主 ${s.mainSessions}）· 主会话 ${s.turns} 轮 / 全量 ${s.turnsAll ?? '-'} 轮`,
  s.findingsRejected
    ? `⚠️ findings 被拒收：${s.findingsRejected}（画像/重复不计）`
    : `画像 ${s.portrait ?? '-'} 条 · 重复 ${s.repeats ?? '-'} 条 · 候选 ${s.candidates.length} 条`,
  ...s.candidates.slice(0, 6).map((c) => `- [${c.verdict}] ${c.key}：${c.title}`),
  s.compactions ? `上下文压缩 ${s.compactions} 次` : '',
  s.corrections != null ? `纠偏 ${s.corrections} 次` : '',
  (s.skippedLanded || []).length ? `已落地跳过 ${s.skippedLanded.length} 条：${s.skippedLanded.join(', ')}` : '',
  s.report ? `报告：${s.report.at}（${s.report.bytes} 字节）` : '报告：尚未生成（先 /weekly run）',
].filter(Boolean).join('\n');
const fmt = formatStatus;

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return; // 已超限：丢弃后续数据但继续排空，保证 413 能送达
      data += c;
      if (data.length > limit) { tooLarge = true; data = ''; }
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error(`body 超过 ${limit} 字节`), { status: 413 }));
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error('body 不是合法 JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const TOOL_OUTPUT = {
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : (value?.summary || JSON.stringify(value, null, 2)),
  }],
  // 宿主按这个 schema 校验 execute 的返回值：必须是 object
  schema: { type: 'object', additionalProperties: true },
};

export function buildToolDefs() {
  const defs = [
    {
      name: 'weekly_status',
      description: '读取本周周报概要（会话/轮次/画像/重复/候选/上下文压力）。只读，不跑流水线。',
      parameters: {},
      output: TOOL_OUTPUT,
      async execute() {
        const s = summary();
        return { summary: fmt(s), ...s };
      },
    },
    {
      name: 'weekly_run',
      description: '跑周报。默认 mode=report 只重跑报告（不重新采集）；mode=full 跑整条流水线（collect→condense→report→html）。',
      parameters: {
        mode: { type: 'string', description: 'report（默认，只重跑报告）或 full（重新采集）' },
        windowEnd: { type: 'string', description: '回填模式：ISO 时间，透传 DSH_WINDOW_END' },
        withSelftest: { type: 'boolean', description: 'full 模式下是否跑自检（默认否）' },
        timeoutMs: { type: 'number', description: '子进程超时（1000–180000ms，默认 120000）' },
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        const mode = args?.mode === 'full' ? 'full' : 'report';
        const r = await runPipeline({ mode, windowEnd: args?.windowEnd || null, noSelftest: !args?.withSelftest, timeoutMs: args?.timeoutMs });
        return { summary: kindText(r), ...r };
      },
    },
    {
      name: 'weekly_land',
      description: '采纳候选：写 decisions.json（写前备份/损坏拒绝覆盖）并触发落地同步（land-sync.sh），返回 commit 或「已落地但未同步」。',
      parameters: {
        key: { type: 'string', required: true, description: '候选 key（见 weekly_status）' },
        note: { type: 'string', description: '一句话备注' },
        sync: { type: 'boolean', description: '是否落地后同步（默认 true）' },
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        return await land(String(args?.key || ''), { note: String(args?.note || ''), sync: args?.sync !== false });
      },
    },
    {
      name: 'weekly_validate',
      description: '校验 findings.json；list=true 时只列可用会话 id（技能步骤 3）。',
      parameters: {
        list: { type: 'boolean', description: '只列会话 id，不校验文件' },
        file: { type: 'string', description: '校验指定 findings 文件（默认 weekly/findings.json）' },
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        return await validateFindings({ list: Boolean(args?.list), file: args?.file || null });
      },
    },
  ];
  // 工具层兜底：数据层任何意外都不能变成宿主工具异常
  return defs.map((d) => ({
    ...d,
    execute: async (args) => {
      try { return await d.execute(args); }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    },
  }));
}

function safe(label, fn, logger) {
  try { return fn(); } catch (e) { logger?.warn?.(`dsh-weekly-retro: ${label} 注册失败（已跳过）：${e?.message || e}`); return undefined; }
}


// ── UI job registry：/ui/run 立即返回 jobId，前端轮询 /ui/job?id= ──
const jobs = new Map();
let jobSeq = 0;
function startJob(payload) {
  const id = `job-${Date.now()}-${++jobSeq}`;
  const job = { id, phase: 'running', startedAt: Date.now(), ms: null, tail: '', result: null, error: null };
  jobs.set(id, job);
  Promise.resolve()
    .then(() => runPipeline(payload))
    .then((r) => { job.phase = r?.ok ? 'done' : 'failed'; job.result = r; job.tail = r?.tail || ''; job.ms = r?.ms ?? null; })
    .catch((e) => { job.phase = 'failed'; job.error = String(e?.message || e); })
    .finally(() => { const t = setTimeout(() => jobs.delete(id), 10 * 60 * 1000); t.unref?.(); });
  return job;
}

export function apply(ctx) {
  diag.mountedAt = new Date().toISOString();

  const route = (path, handler, opts = {}) => ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          const method = opts.method || 'GET';
          const okMethod = req.method === method || (method === 'GET' && req.method === 'HEAD');
          if (!okMethod) return send(res, 405, { ok: false, error: `${method} only` });
          // 隐私边界：周报数据只允许本机读取；远程必须显式开启或带 token
          if (!remoteAllowed(req)) {
            return send(res, 403, { ok: false, error: '周报数据仅允许本机访问；远程请设置 DSH_WEEKLY_ALLOW_REMOTE=1 或携带 X-Weekly-Token' });
          }
          if (opts.mutating && !mutatingAllowed(req)) {
            return send(res, 403, { ok: false, error: '写操作只允许同源请求，或携带 X-Weekly-Token' });
          }
          await handler(req, res);
        } catch (e) {
          send(res, e?.status || 500, { ok: false, error: String(e?.message || e) });
        }
      },
    });
    diag.routes += 1;
    return dispose;
  }, `dsh-weekly-retro: route ${path}`);

  route('/dsh-weekly-retro/summary', (req, res) => send(res, 200, summary()));

  route('/dsh-weekly-retro/diagnostics', (req, res) => send(res, 200, {
    ok: diag.tools && diag.commands && !diag.toolError && diag.routes >= 5,
    tools: diag.tools, toolCount: diag.toolCount, toolError: diag.toolError,
    commands: diag.commands, routes: diag.routes, mountedAt: diag.mountedAt,
    remoteAccess: process.env.DSH_WEEKLY_ALLOW_REMOTE === '1' ? 'allowed' : 'loopback-only',
  }));

  route('/dsh-weekly-retro/report', (req, res) => {
    const week = (() => { try { return new URL(req.url, 'http://x').searchParams.get('week'); } catch { return null; } })();
    // week 会拼进文件路径：只接受 YYYY-Www，堵住 ../ 路径穿越
    if (week && !/^\d{4}-W\d{2}$/.test(week)) return send(res, 400, { ok: false, error: 'week 格式必须是 YYYY-Www' });
    const wantFull = (() => { try { return new URL(req.url, 'http://x').searchParams.get('full') === '1'; } catch { return false; } })();
    const html = reportHtml(week || null, { full: wantFull });
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(week ? `没有 ${week} 的报告（回填周只生成 <week>.html）` : '周报尚未生成：先跑 /weekly run');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(html);
  });

  route('/dsh-weekly-retro/run', async (req, res) => {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const r = await runPipeline({
      mode: body?.mode === 'report' ? 'report' : 'full',
      windowEnd: body?.windowEnd || null,
      noSelftest: !body?.withSelftest,
      timeoutMs: body?.timeoutMs,
    });
    send(res, httpStatus(r), { ...r, summary: kindText(r) });
  }, { method: 'POST', mutating: true });

  route('/dsh-weekly-retro/land', async (req, res) => {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    if (!key) return send(res, 400, { ok: false, kind: 'missing-key', error: '缺 key' });
    const r = await land(key, { note: String(body?.note || ''), sync: body?.sync !== false });
    send(res, httpStatus(r), r);
  }, { method: 'POST', mutating: true });

  // ── UI 只读聚合（同源，无 token） ──
  route('/dsh-weekly-retro/ui/overview', (req, res) => send(res, 200, uiOverview()));
  route('/dsh-weekly-retro/ui/metrics', (req, res) => send(res, 200, uiMetrics()));
  route('/dsh-weekly-retro/ui/candidates', (req, res) => send(res, 200, uiCandidates()));
  route('/dsh-weekly-retro/ui/findings', (req, res) => send(res, 200, uiFindings()));
  route('/dsh-weekly-retro/ui/history', (req, res) => send(res, 200, uiHistory()));
  route('/dsh-weekly-retro/ui/repeat-candidate', async (req, res) => {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    if (!key) return send(res, 400, { ok: false, kind: 'bad-repeat', error: '缺重复动作 key' });
    const r = await createCandidateFromRepeat(key);
    send(res, httpStatus(r), r);
  }, { method: 'POST', mutating: true });

  route('/dsh-weekly-retro/ui/job', (req, res) => {
    const id = (() => { try { return new URL(req.url, 'http://x').searchParams.get('id'); } catch { return null; } })();
    const job = id ? jobs.get(id) : null;
    if (!job) return send(res, 404, { ok: false, kind: 'missing-job', error: 'job 不存在或已过期' });
    send(res, 200, { ok: true, ...job });
  });
  route('/dsh-weekly-retro/ui/run', async (req, res) => {
    const body = await readBody(req);
    const mode = body?.mode === 'report' ? 'report' : 'full';
    const job = startJob({ mode, windowEnd: body?.windowEnd || null, noSelftest: !body?.withSelftest, timeoutMs: body?.timeoutMs });
    send(res, 202, { ok: true, jobId: job.id, mode });
  }, { method: 'POST', mutating: true });

  safe('tools 服务', () => ctx.inject(['tools'], (tctx) => {
    if (typeof tctx.tools?.register !== 'function') return;
    // CLI/隔离测试不一定能解析 Electron 内置的 dsh-tools；fallback 只做 schema 归一化，
    // 宿主 tools.register 仍按同一契约校验。Electron 正常时应走真实 defineTool。
    const fallbackDefineTool = (def) => {
      const properties = {}; const required = [];
      for (const [name, raw] of Object.entries(def.parameters || {})) {
        const spec = { ...(raw || {}) };
        if (spec.required) { required.push(name); delete spec.required; }
        properties[name] = spec;
      }
      return {
        ...def,
        parameters: { type: 'object', properties, required, additionalProperties: false },
        output: def.output && def.output.schema ? def.output : { schema: { type: 'object', additionalProperties: true } },
      };
    };
    import('@deepseek-ai/dsh-tools')
      .then(({ defineTool }) => defineTool || fallbackDefineTool)
      .catch(() => fallbackDefineTool)
      .then((defineTool) => {
        diag.tools = true;
        const reg = (def) => tctx.effect(() => tctx.tools.register(defineTool(def)), `dsh-weekly-retro: tool ${def.name}`);
        for (const def of buildToolDefs()) {
          try { reg(def); diag.toolCount += 1; }
          catch (e) { diag.toolError = `${def.name}: ${e?.message || e}`; ctx.logger?.warn?.(`dsh-weekly-retro: 工具 ${def.name} 注册失败：${e?.message || e}`); }
        }
      })
      .catch((e) => { diag.toolError = String(e?.message || e); ctx.logger?.warn?.(`dsh-weekly-retro: 工具注册异常（${e?.message || e}）`); });
  }), ctx.logger);

  safe('commands 服务', () => ctx.inject(['commands'], (cctx) => {
    const commands = cctx.commands;
    if (typeof commands?.register !== 'function') return;
    diag.commands = true;
    const unregister = commands.register({
      definitionId: 'dsh-weekly-retro',
      name: 'weekly',
      description: '周报：/weekly 看概要，/weekly run 全量重跑，/weekly report 只重跑报告',
      input: { hint: '[status|run|report]' },
      handler: async (invocation) => {
        const raw = String(invocation?.input ?? invocation?.args ?? '').trim();
        const text = (t) => ({ kind: 'success', text: t, toString() { return t; } });
        if (raw === 'run' || raw === 'report') {
          const r = await runPipeline({ mode: raw === 'run' ? 'full' : 'report', noSelftest: raw !== 'run' });
          return text(kindText(r));
        }
        return text(fmt(summary()));
      },
    });
    ctx.effect(() => () => unregister?.(), 'dsh-weekly-retro: /weekly command');
  }), ctx.logger);
}
