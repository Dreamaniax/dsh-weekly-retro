// findings.json 的共享校验与常量：report.mjs 与 check-findings.mjs 必须用同一把尺子。
// 为什么单独成文件：分析环节由模型写、报告环节由脚本读，两边判定一旦漂移就会出现「检查通过但报告拒收」。

export const VERDICTS = ['skill', 'skill-lite', 'rule', 'plugin', 'schedule', 'watcher', 'skip'];
export const SHAPES = ['rule', 'skill', 'plugin', 'schedule', 'watcher'];
export const PLUGIN_TRIGGERS = ['bundle-patch', 'tool', 'client-ui', 'mcp'];
export const SCORE_KEYS = ['freq', 'trigger', 'capability', 'verifiable'];

/**
 * 校验分析环节的 findings。返回错误串数组（空数组 = 合法）。
 * @param {object} f findings 内容
 * @param {{week: string, sessionIds: Iterable<string>}} ctx 当前周的 ISO 周 + digest 里真实存在的会话 id
 */
export function validateFindings(f, ctx) {
  const errs = [];
  if (!f || typeof f !== 'object') return ['不是对象'];
  if (f.week !== ctx.week) errs.push(`week=${f.week} 与本周 ${ctx.week} 不符（分析已过期）`);
  if (!Array.isArray(f.candidates)) errs.push('candidates 不是数组');
  const ids = new Set(ctx.sessionIds);
  (Array.isArray(f.candidates) ? f.candidates : []).forEach((c, i) => {
    const at = `candidates[${i}]`;
    if (!c || typeof c !== 'object') { errs.push(`${at} 不是对象`); return; }
    if (!c.key) errs.push(`${at}.key 缺失`);
    if (!c.title) errs.push(`${at}.title 缺失`);
    if (!c.what) errs.push(`${at}.what 缺失`);
    if (!Array.isArray(c.steps) || !c.steps.length) errs.push(`${at}.steps 缺失`);
    if (!VERDICTS.includes(c.verdict)) errs.push(`${at}.verdict 非法（${c.verdict}）`);
    const sc = c.scores || {};
    for (const k of SCORE_KEYS) if (![0, 1, 2].includes(sc[k])) errs.push(`${at}.scores.${k} 非 0-2`);
    const ev = c.evidenceSessions || [];
    if (!ev.length) errs.push(`${at}.evidenceSessions 为空（必须有真实会话 id）`);
    for (const id of ev) if (!ids.has(id)) errs.push(`${at}.evidenceSessions 含未知会话 ${id}`);
    if (c.verdict === 'plugin') {
      if (!c.plugin_spec) errs.push(`${at} 判为 plugin 但缺 plugin_spec`);
      else if (!PLUGIN_TRIGGERS.includes(c.plugin_spec.trigger)) errs.push(`${at}.plugin_spec.trigger 非法（应为 ${PLUGIN_TRIGGERS.join('/')}）`);
      const persist = c.persist ?? c.plugin_spec.persist;
      if (typeof persist !== 'boolean') errs.push(`${at} 缺 persist（写在 plugin_spec.persist：是否常驻；不写就等于没说清成本）`);
    }
    if (c.shape && c.verdict && c.shape !== c.verdict && !(c.shape === 'skill' && c.verdict === 'skill-lite')) {
      errs.push(`${at}.shape（${c.shape}）与 verdict（${c.verdict}）互相矛盾`);
    }
    if (c.verdict === 'rule' && c.scores?.capability !== 0) errs.push(`${at} 判为 rule 但 capability≠0（纯纪律型才写规则）`);
  });
  if (Array.isArray(f.candidates) && f.candidates.length > 6) errs.push(`candidates 超过 6 条（本周 ${f.candidates.length} 条）`);

  // portrait / repeats 之前完全不校验：check 通过后 report/report-html 会崩（实测 outputs 写成字符串即触发）
  if (f.portrait !== undefined) {
    if (!Array.isArray(f.portrait)) errs.push('portrait 不是数组');
    else f.portrait.forEach((p, i) => {
      if (!p || typeof p !== 'object') { errs.push(`portrait[${i}] 不是对象`); return; }
      if (typeof p.mainline !== 'string' || !p.mainline.trim()) errs.push(`portrait[${i}].mainline 缺失`);
      if (p.outputs !== undefined && !Array.isArray(p.outputs)) errs.push(`portrait[${i}].outputs 必须是数组`);
      if (p.sessions !== undefined && !Array.isArray(p.sessions)) errs.push(`portrait[${i}].sessions 必须是数组`);
      for (const id of Array.isArray(p.sessions) ? p.sessions : []) if (!ids.has(id)) errs.push(`portrait[${i}].sessions 含未知会话 ${id}`);
    });
  }
  if (f.repeats !== undefined) {
    if (!Array.isArray(f.repeats)) errs.push('repeats 不是数组');
    else f.repeats.forEach((r, i) => {
      if (!r || typeof r !== 'object') { errs.push(`repeats[${i}] 不是对象`); return; }
      if (typeof r.pattern !== 'string' || !r.pattern.trim()) errs.push(`repeats[${i}].pattern 缺失`);
      if (!Number.isFinite(r.count)) errs.push(`repeats[${i}].count 必须是数字`);
      if (r.evidence !== undefined && !Array.isArray(r.evidence)) errs.push(`repeats[${i}].evidence 必须是数组`);
      for (const id of Array.isArray(r.evidence) ? r.evidence : []) if (!ids.has(id)) errs.push(`repeats[${i}].evidence 含未知会话 ${id}`);
      if (r.key !== undefined && (typeof r.key !== 'string' || !r.key.trim())) errs.push(`repeats[${i}].key 必须是非空字符串`);
    });
  }
  return errs;
}

/** 候选规范化：把 findings 的字段补成报告模板需要的形状，并重算总分（不信模型自报的总分）。 */
export function normalizeCandidate(c, judged) {
  const scores = c.scores;
  return {
    key: c.key,
    title: c.title,
    what: c.what,
    evidence: Array.isArray(c.evidence) ? c.evidence.join('；') : String(c.evidence || ''),
    steps: c.steps,
    saving: c.saving || '—',
    effort: c.effort || '—',
    shape: c.shape || (c.verdict === 'plugin' ? 'plugin' : undefined),
    plugin_spec: c.plugin_spec,
    persist: c.persist ?? c.plugin_spec?.persist,
    cost: c.cost,
    evidenceSessions: c.evidenceSessions,
    scores,
    total: scores.freq + scores.trigger + scores.capability + scores.verifiable,
    max: judged.max,
    verdict: c.verdict,
    verdictWhy: c.why || judged.verdictWhy,
  };
}

/** 按形态分组（HTML 与统计口径共用） */
export function groupOf(p) {
  const v = p.verdict || '';
  const sh = p.shape || '';
  if (v === 'plugin' || sh === 'plugin') return 'plugin';
  if (v === 'rule' || sh === 'rule') return 'rule';
  if (['skill', 'skill-lite'].includes(v) || sh === 'skill') return 'skill';
  if (['schedule', 'watcher'].includes(v) || ['schedule', 'watcher'].includes(sh)) return 'other';
  return 'skip';
}
