// dsh-weekly-retro · client 半：右侧面板工作台（五 Tab + 内联 SVG 图表）。
// 依赖最小化：只注入 sidebar-right；不使用外部图表库，全部原生 SVG/DOM。
// 安全：任何注册/渲染异常只影响面板自身，且不抛到宿主。
window.__ModuleLoader__.load({
  id: 'dsh-weekly-retro',
  factory: (require) => {
    // 宿主 ModuleLoader 的工厂约定：局部 module/exports 必须自己声明（漏了会 import failed: exports is not defined）
    var module = { exports: {} };
    var exports = module.exports;
    try {
    const React = require('react');
    const h = React.createElement;
    const API = '/dsh-weekly-retro';
    const inject = ['slots', 'locale'];
    const NS = 'dsh-weekly-retro';
    let HOST_LOCALE = null;
    let LANG = 'zh';
    const detectLang = () => {
      try {
        const html = String(document?.documentElement?.lang || '').toLowerCase();
        if (html) return html.startsWith('en') ? 'en' : 'zh';
        return String(navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch { return 'zh'; }
    };
    // 宿主 locale 字典：以中文串为 key，方便现有成对文案直接接入
    const MESSAGES = {
      zh: {
        '周报': '周报', '每周复盘': '每周复盘', '候选': '候选', '打开周报洞察页': '打开周报洞察页',
        '周报视图': '周报视图', '周报面板': '周报面板', '概览': '概览', '画像': '画像', '重复': '重复', '历史': '历史',
        '本周洞察': '本周洞察', '打开完整报告': '打开完整报告', '刷新': '刷新', '刷新数据': '刷新数据',
        '会话': '会话', '轮次': '轮次', '压缩': '压缩', '技能': '技能', '加载中…': '加载中…', '重试': '重试',
      },
      en: {
        '周报': 'Weekly Retro', '每周复盘': 'Weekly retro', '候选': 'Candidates', '打开周报洞察页': 'Open weekly retro insights',
        '周报视图': 'Weekly views', '周报面板': 'Weekly retro panel', '概览': 'Overview', '画像': 'Portrait', '重复': 'Repeats', '历史': 'History',
        '本周洞察': 'This week at a glance', '打开完整报告': 'Open full report', '刷新': 'Refresh', '刷新数据': 'Refresh data',
        '会话': 'Sessions', '轮次': 'Turns', '压缩': 'Compactions', '技能': 'Skills', '加载中…': 'Loading…', '重试': 'Retry',
      },
    };
    // 优先宿主 locale（register/bind，随宿主语言实时变化）；否则按 html lang 回退
    const T = (zh, en) => {
      if (HOST_LOCALE) { try { const v = HOST_LOCALE(zh); if (v && v !== zh) return v; } catch {} }
      LANG = detectLang();
      return LANG === 'en' ? (en || zh) : zh;
    };

    const verdictLabel = (v) => ({
      all: T('全部', 'All'), skill: T('技能', 'Skill'), 'skill-lite': T('轻技能', 'Skill lite'),
      rule: T('规则', 'Rule'), plugin: T('插件', 'Plugin'), schedule: T('定时', 'Schedule'),
      watcher: T('监听', 'Watcher'), skip: T('跳过', 'Skip'),
    }[v] || v);

    const copyToClipboard = (text, onDone, onFail) => {
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand && document.execCommand('copy');
          document.body.removeChild(ta);
          if (ok) onDone && onDone(); else onFail && onFail();
        } catch { onFail && onFail(); }
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => onDone && onDone()).catch(fallback);
      else fallback();
    };

    const urlParam = (key, fallback = null) => {
      try { return new URLSearchParams(window.location.search).get(key) ?? fallback; } catch { return fallback; }
    };
    const setUrlParam = (key, value) => {
      try {
        const u = new URL(window.location.href);
        if (value == null || value === '') u.searchParams.delete(key); else u.searchParams.set(key, String(value));
        window.history.replaceState(null, '', u);
      } catch {}
    };

    // ── P3 语义色 token（8 色，取自 dsh-context 色板）────────────────────
    // 60-30-10：60% 中性层（面板/卡片/边框 = rgba(127,127,127,*) 与透明渐变，跟随宿主深浅色）；
    // 30% 主蓝（标题/激活 Tab/主按钮/主序列）；10% 强调（紫/青/橙/粉/绿/红/黄只做序列色与状态点）。
    // 深浅色都可用：tint() 只叠透明度、不写死底色；ink() 按当前主题把语义色混向文字色，
    // 保证彩色文字在浅色底够暗、深色底够亮（对比度按 4.5:1 目标取 50%/20% 混合）。
    const TOKENS = {
      blue: '#4D6BFE', purple: '#A855F7', cyan: '#00B4AB', orange: '#F39A2B',
      pink: '#C45FA0', green: '#41B883', red: '#E5594F', yellow: '#F0D043',
    };
    const BLUE = TOKENS.blue;
    const PALETTE = [TOKENS.blue, TOKENS.purple, TOKENS.cyan, TOKENS.orange, TOKENS.pink, TOKENS.green, TOKENS.red, TOKENS.yellow];
    const hex2rgb = (hex) => {
      const m = String(hex).replace('#', '');
      const n = m.length === 3 ? m.split('').map((x) => x + x).join('') : m;
      return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
    };
    const tint = (c, a) => { const [r, g, b] = hex2rgb(c); return `rgba(${r},${g},${b},${a})`; };
    const mixHex = (a, b, t) => {
      const A = hex2rgb(a); const B = hex2rgb(b);
      return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
    };
    // 主题判定必须看「底色」而不是文字色：深色主题的文字本来就是浅色，
    // 用文字色亮度判会得到相反结论（P3 reviewer F1 的根因）。
    const isDarkTheme = () => {
      try {
        const body = document.body;
        if (body && body.hasAttribute && body.hasAttribute('data-ds-dark-theme')) return true;
        const bg = getComputedStyle(body || document.documentElement).backgroundColor || '';
        const m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (!m) return true;
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return (0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3])) <= 0.35;
      } catch { return true; }
    };
    // WCAG 相对亮度 / 对比度：treemap 每格按实际底色挑深字或浅字（review F2），不再写死 #fff
    const srgbLin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const relLum = (hex) => { const [r, g, b] = hex2rgb(hex); return 0.2126 * srgbLin(r) + 0.7152 * srgbLin(g) + 0.0722 * srgbLin(b); };
    const contrastOf = (a, b) => { const l1 = relLum(a); const l2 = relLum(b); const hi = Math.max(l1, l2); const lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
    const readableOn = (bgHex) => (contrastOf(bgHex, '#101014') >= contrastOf(bgHex, '#FFFFFF') ? '#101014' : '#FFFFFF');
    // 语义色 → 可读文字色：深色主题往白混、浅色主题往黑混（混到 0.35/0.5 保证小字号也过 4.5:1）
    const ink = (c) => (isDarkTheme() ? mixHex(c, '#FFFFFF', 0.35) : mixHex(c, '#101014', 0.62));

    // 滚动条样式：宿主没有给面板配滚动条，macOS 默认 overlay 滚动条不可见。
    // 用 <style> 注入一次（.weekly-scroll 由面板 body 使用），并固定子项不参与纵向收缩，
    // 否则 flex 列会把卡片压扁而不是产生滚动。
    const SCROLL_CSS_ID = 'dsh-weekly-retro-scroll-css';
    // 注意：不要同时写标准 scrollbar-width/scrollbar-color —— Chromium 一旦看到它们就会
    // 走原生滚动条路径，::-webkit-scrollbar 规则失效，macOS 上又退回不可见的 overlay 滚动条。
    // P2：末尾两条是可解释提示（Tip）的样式——包一层相对定位 inline-flex，tooltip 绝对定位、
    // 高 z-index、pointer-events:none，只做展示，不拦截点击。
    const SCROLL_CSS = [
      '.weekly-scroll{scrollbar-gutter:stable}',
      '.weekly-scroll::-webkit-scrollbar{width:8px;height:8px}',
      '.weekly-scroll::-webkit-scrollbar-track{background:transparent}',
      '.weekly-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.42);border-radius:8px;border:2px solid transparent;background-clip:padding-box}',
      '.weekly-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.62);background-clip:padding-box}',
      '.weekly-scroll::-webkit-scrollbar-corner{background:transparent}',
      '.weekly-scroll>*{flex:0 0 auto}',
      '.weekly-tip-wrap{position:relative;display:inline-flex;align-items:center}',
      '.weekly-tip{position:absolute;z-index:10000;max-width:220px;width:max-content;padding:6px 8px;border-radius:7px;background:rgba(20,24,34,.96);color:#fff;font-size:10.5px;font-weight:400;line-height:1.45;letter-spacing:0;text-align:left;white-space:normal;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.28)}',
      // P3 卡片层次：中性渐变面（60%）+ 细边框 + hover 轻微抬升（只用 box-shadow 加主色描边，
      // 避免和 inline border 打架）；prefers-reduced-motion 下关闭位移与阴影。
      '.wr-card{transition:transform .16s ease,box-shadow .16s ease}',
      '.wr-card:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.10),0 0 0 1px ' + tint(TOKENS.blue, 0.42) + '}',
      '.wr-dot{width:7px;height:7px;border-radius:2px;display:inline-block;flex:0 0 auto}',
      '.wr-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:start}',
      '@media (min-width:1100px){.wr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.wr-full{grid-column:1/-1}',
      '.wr-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}',
      '@media (min-width:1100px){.wr-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}}',
      '.wr-table{width:100%;border-collapse:collapse;font-size:11px}',
      '.wr-table th{text-align:left;font-size:9.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.62;padding:7px 8px;border-bottom:1px solid rgba(127,127,127,.18);white-space:nowrap}',
      '.wr-table td{padding:8px;border-bottom:1px solid rgba(127,127,127,.10);vertical-align:middle}',
      '.wr-table tbody tr:last-child td{border-bottom:0}',
      '.wr-table tbody tr:hover{background:rgba(127,127,127,.055)}',
      '.wr-table .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
      '.wr-scroll-x{overflow-x:auto}',
      '.wr-skeleton{display:flex;flex-direction:column;gap:8px}',
      '.wr-skeleton-card{border:1px solid rgba(127,127,127,.16);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.wr-skeleton-bar{height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(127,127,127,.10),rgba(127,127,127,.22),rgba(127,127,127,.10));background-size:200% 100%;animation:wr-shimmer 1.2s ease-in-out infinite}',
      '@keyframes wr-shimmer{0%{background-position:180% 0}100%{background-position:-80% 0}}',
      '@media (prefers-reduced-motion:reduce){.wr-skeleton-bar{animation:none}}',
      '@media (prefers-reduced-motion:reduce){.wr-card,.wr-card:hover{transition:none;transform:none;box-shadow:none}}',
    ].join('');
    const ensureScrollStyles = () => {
      try {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById(SCROLL_CSS_ID)) return;
        const tag = document.createElement('style');
        tag.id = SCROLL_CSS_ID;
        tag.dataset.plugin = 'dsh-weekly-retro';
        tag.textContent = SCROLL_CSS;
        document.head.appendChild(tag);
      } catch { /* 样式注入失败不影响面板功能 */ }
    };

    const S = {
      // Panel 根：靠父级 flex 分配高度，自身不写死 100%（写死会和 hero 一起把面板顶出视口）
      panel: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', height: 'auto', minHeight: 0, overflow: 'hidden', fontSize: 12, color: 'inherit' },
      head: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', borderBottom: '1px solid rgba(127,127,127,.22)' },
      title: { fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
      pill: (bg, fg) => ({ fontSize: 10, padding: '2px 7px', borderRadius: 9, background: bg, color: fg, whiteSpace: 'nowrap' }),
      iconBtn: { marginLeft: 'auto', border: '1px solid rgba(127,127,127,.28)', background: 'transparent', color: 'inherit', borderRadius: 7, padding: '2px 7px', fontSize: 11, cursor: 'pointer' },
      tabs: { display: 'flex', gap: 2, padding: '0 8px', borderBottom: '1px solid rgba(127,127,127,.22)' },
      tab: (on) => ({ padding: '8px 10px', fontSize: 12, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit', opacity: on ? 1 : 0.68, borderBottom: `2px solid ${on ? BLUE : 'transparent'}`, fontWeight: on ? 600 : 400 }),
      body: { flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
      // 中性底 60%：卡片用极浅的灰阶纵向渐变 + 细边框，深浅主题都只叠透明度、不写死底色
      card: { border: '1px solid rgba(127,127,127,.22)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
        background: 'linear-gradient(180deg, rgba(127,127,127,.07), rgba(127,127,127,.018))' },
      section: { fontSize: 11, opacity: 0.6, letterSpacing: '.03em' },
      kpi: { flex: '1 1 30%', minWidth: 62, border: '1px solid rgba(127,127,127,.2)', borderRadius: 9, padding: '7px 8px' },
      kpiVal: { fontSize: 19, fontWeight: 700, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' },
      kpiLbl: { fontSize: 10, opacity: 0.6, marginTop: 2 },
      btn: (variant) => ({
        border: '1px solid ' + (variant === 'danger' ? 'rgba(199,67,59,.5)' : variant === 'primary' ? 'rgba(77,107,254,.55)' : 'rgba(127,127,127,.3)'),
        background: variant === 'danger' ? 'rgba(199,67,59,.12)' : variant === 'primary' ? 'rgba(77,107,254,.14)' : 'transparent',
        color: 'inherit', borderRadius: 7, padding: '5px 9px', fontSize: 11, cursor: 'pointer',
      }),
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, opacity: 0.75, wordBreak: 'break-all' },
      row: { display: 'flex', alignItems: 'center', gap: 8 },
      barTrack: { flex: 1, height: 7, borderRadius: 4, background: 'rgba(127,127,127,.18)', overflow: 'hidden' },
      barFill: (pct, color) => ({ height: '100%', width: `${Math.max(1, Math.min(100, pct))}%`, background: color || BLUE, borderRadius: 4 }),
      modalWrap: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
      modal: { width: 340, maxWidth: '90vw', background: 'Canvas', color: 'CanvasText', border: '1px solid rgba(127,127,127,.35)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
      drawerWrap: { position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.38)', display: 'flex', justifyContent: 'flex-end' },
      drawer: { width: 430, maxWidth: '94vw', height: '100%', background: 'Canvas', color: 'CanvasText', borderLeft: '1px solid rgba(127,127,127,.3)', boxShadow: '-18px 0 48px rgba(0,0,0,.24)', display: 'flex', flexDirection: 'column' },
      drawerHead: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', borderBottom: '1px solid rgba(127,127,127,.2)' },
      drawerBody: { padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 },
    };

    // ── 数据 hook ─────────────────────────────────────────────
    function useJson(path) {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      const load = React.useCallback(() => {
        let alive = true;
        setState((s) => ({ ...s, loading: true, error: null }));
        fetch(API + path, { headers: { Accept: 'application/json' } })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then((d) => { if (alive) setState({ loading: false, data: d, error: null }); })
          .catch((e) => { if (alive) setState({ loading: false, data: null, error: String(e.message || e) }); });
        return () => { alive = false; };
      }, [path]);
      React.useEffect(() => { const cancel = load(); return cancel; }, [load]);
      return { ...state, reload: load };
    }

    // ── 图表（原生 SVG / DOM，无依赖）──────────────────────────
    function Donut({ data, size = 104, thick = 12, centerLabel = '合计' }) {
      const items = (data || []).filter((d) => d.value > 0);
      const total = items.reduce((a, d) => a + d.value, 0);
      const r = (size - thick) / 2;
      const c = size / 2;
      const circ = 2 * Math.PI * r;
      let acc = 0;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
        h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': '占比环图' },
          h('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'rgba(127,127,127,.18)', strokeWidth: thick }),
          ...items.map((d, i) => {
            const len = circ * (d.value / (total || 1));
            const el = h('circle', {
              key: d.label + i, cx: c, cy: c, r, fill: 'none',
              stroke: PALETTE[i % PALETTE.length], strokeWidth: thick,
              strokeDasharray: `${Math.max(0, len - 1)} ${circ - Math.max(0, len - 1)}`,
              strokeDashoffset: -acc, transform: `rotate(-90 ${c} ${c})`,
            });
            acc += len;
            return el;
          }),
          h('text', { x: c, y: c + 2, textAnchor: 'middle', fontSize: 19, fontWeight: 700, fill: 'currentColor' }, String(total)),
          h('text', { x: c, y: c + 17, textAnchor: 'middle', fontSize: 9.5, fill: 'currentColor', opacity: 0.7 }, centerLabel)),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5 } },
          ...items.map((d, i) => h('div', { key: d.label + i, style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length] } }),
            h('span', { style: { opacity: 0.8 } }, d.label),
            h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', opacity: 0.65 } }, String(d.value))))));
    }

    function Bars({ data, color = BLUE, unit = '', label }) {
      const max = Math.max(1, ...(data || []).map((d) => d.value));
      const summary = (data || []).slice(0, 4).map((d) => `${d.label} ${d.value}${unit}`).join('，');
      return h('div', { role: 'img', 'aria-label': label || (T('条形图', 'Bar chart') + '：' + summary), style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        ...(data || []).map((d, i) => h('div', { key: d.label + i, style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { width: '46%', fontSize: 10.5, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: d.label }, d.label),
          h('div', { style: S.barTrack }, h('div', { style: S.barFill((d.value / max) * 100, color) })),
          h('span', { style: { fontSize: 10.5, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right', opacity: 0.75 } }, d.value + unit))));
    }

    function Histogram({ data, color = BLUE, label }) {
      const max = Math.max(1, ...(data || []).map((d) => d.value));
      const summary = (data || []).map((d) => `${d.label}:${d.value}`).join('，');
      return h('div', { role: 'img', 'aria-label': label || (T('直方图', 'Histogram') + '：' + summary), style: { display: 'flex', alignItems: 'flex-end', gap: 8, height: 92, paddingTop: 4 } },
        ...(data || []).map((d, i) => h('div', { key: d.label + i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' } },
          h('span', { style: { fontSize: 10, fontVariantNumeric: 'tabular-nums', opacity: 0.7 } }, d.value),
          h('div', { style: { width: '100%', maxWidth: 46, height: Math.max(3, (d.value / max) * 58), background: color, borderRadius: 4, opacity: 0.9 } }),
          h('span', { style: { fontSize: 9.5, opacity: 0.68 } }, d.label))));
    }

    function LineChart({ weeks, series, height = 220, label }) {
      const ws = (weeks || []).map(String);
      const ss = (series || []).map((s) => ({ ...s, values: (s.values || []).map((v) => Number(v) || 0) }));
      const W = 720; const H = height; const padL = 38; const padR = 14; const padT = 12; const padB = 28;
      const n = ws.length;
      const max = Math.max(1, ...ss.flatMap((s) => s.values));
      const x = (i) => (n <= 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (n - 1));
      const y = (v) => H - padB - (v / max) * (H - padT - padB);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
      const every = Math.max(1, Math.ceil(n / 5));
      const summary = ss.map((s) => `${s.label}: ${s.values.join('/')}`).join('; ');
      return h('div', { role: 'img', 'aria-label': label || T(`周趋势折线：${summary}`, `Weekly trend: ${summary}`), style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, opacity: 0.8 } },
          ...ss.map((s, i) => h('span', { key: s.label, style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h('span', { style: { width: 12, height: 3, borderRadius: 2, background: PALETTE[i % PALETTE.length] } }), s.label))),
        h('div', { style: { width: '100%', maxWidth: W, margin: '0 auto' } },
          h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: 'auto', display: 'block' }, 'aria-hidden': 'true' },
            ...ticks.map((v) => h('g', { key: 't' + v },
              h('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: 'rgba(127,127,127,.16)', strokeWidth: 1 }),
              h('text', { x: padL - 7, y: y(v) + 3, textAnchor: 'end', fontSize: 9.5, fill: 'currentColor', opacity: 0.62 }, String(v)))),
            ...ss.map((s, si) => h('g', { key: s.label },
              h('polyline', { fill: 'none', stroke: PALETTE[si % PALETTE.length], strokeWidth: 2, strokeLinejoin: 'round', points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }),
              ...s.values.map((v, i) => h('circle', { key: i, cx: x(i), cy: y(v), r: 3, fill: PALETTE[si % PALETTE.length] })))),
            ...ws.map((w, i) => (i % every === 0 || i === n - 1 ? h('text', { key: w, x: x(i), y: H - 8, textAnchor: 'middle', fontSize: 9.5, fill: 'currentColor', opacity: 0.68 }, String(w).replace(/^\d{4}-/, '')) : null)))));
    }

    function Heatmap({ data, label }) {
      const max = Math.max(1, ...(data || []).map((d) => d.value));
      const peak = (data || []).slice().sort((a, b) => b.value - a.value)[0];
      return h('div', { role: 'img', 'aria-label': label || (T('活跃时段热力图', 'Hourly activity heatmap') + (peak ? `：${peak.hour}:00 最高 ${peak.value}` : '')), style: { display: 'flex', gap: 2 } },
        ...(data || []).map((d) => h('div', {
          key: 'h' + d.hour, title: `${d.hour}:00 · ${d.value}`,
          style: { flex: 1, height: 26, borderRadius: 3, background: BLUE, opacity: 0.12 + 0.85 * (d.value / max) },
        })));
    }

    // ── P3 新增图表（原生 SVG，全部 role="img" + 摘要 aria-label）────────────
    // 图表卡标题：语义色点 + 文案（色点只在 10% 强调层，标题仍用文字色保证可读）
    function ChartHead({ color, children }) {
      return h('div', { style: { ...S.section, display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { className: 'wr-dot', style: { background: color || TOKENS.blue } }),
        h('span', null, children));
    }

    // 采纳率 Gauge：半圆环 + 百分比，数据来自 funnel.landed / funnel.proposed
    function Gauge({ value = 0, max = 0, label, color = TOKENS.green, size = 148 }) {
      const v = Number(value) || 0; const m = Number(max) || 0;
      const pct = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
      const c = size / 2; const r = c - 15; const thick = 11;
      const ang = Math.PI - Math.PI * pct;
      const x = c + r * Math.cos(ang); const y = c - r * Math.sin(ang);
      const big = pct > 0.5 ? 1 : 0;
      const pctText = m > 0 ? Math.round(pct * 100) + '%' : 'N/A';
      return h('div', { role: 'img', 'aria-label': label || T(`采纳率仪表盘：${pctText}，本周落地 ${v} / 候选 ${m}`, `Adoption gauge: ${pctText}, landed ${v} / candidates ${m}`), style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
        h('svg', { width: size, height: c + 12, viewBox: `0 0 ${size} ${c + 12}`, 'aria-hidden': 'true' },
          h('path', { d: `M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`, fill: 'none', stroke: 'rgba(127,127,127,.2)', strokeWidth: thick, strokeLinecap: 'round' }),
          pct > 0 ? h('path', { d: `M ${c - r} ${c} A ${r} ${r} 0 ${big} 1 ${x} ${y}`, fill: 'none', stroke: color, strokeWidth: thick, strokeLinecap: 'round' }) : null,
          h('text', { x: c, y: c - 6, textAnchor: 'middle', fontSize: 23, fontWeight: 800, fill: 'currentColor' }, pctText)),
        h('div', { style: { fontSize: 10.5, lineHeight: 1.6, opacity: 0.85 } },
          h('div', null, T(`本周落地 ${v} / 候选 ${m}`, `Landed ${v} / candidates ${m}`)),
          h('div', { style: { opacity: 0.72 } }, T('采纳率 = 已落地 ÷ 本周候选', 'Rate = landed ÷ candidates'))));
    }

    // 候选评分 Radar：4 维 × 前 3 候选，数据来自 /ui/metrics 的 scoreMatrix
    function Radar({ items, series, size = 200, max = 2, label }) {
      const dims = items || [];
      const rows = (series || []).slice(0, 3);
      const c = size / 2; const r = c - 34;
      const pt = (i, v) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, dims.length);
        const rr = r * Math.max(0, Math.min(1, (Number(v) || 0) / max));
        return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
      };
      const ring = (f) => dims.map((d, i) => pt(i, max * f).join(',')).join(' ');
      const summary = rows.length ? rows.map((s) => `${s.title} ${s.total}/${s.max || 8}`).join('，') : T('本周无候选', 'no candidates');
      return h('div', { role: 'img', 'aria-label': label || T(`候选评分雷达图：${summary}`, `Candidate score radar: ${summary}`), style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { width: '100%', maxWidth: 280, margin: '0 auto' } },
          h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: { width: '100%', height: 'auto' }, 'aria-hidden': 'true' },
          ...[0.25, 0.5, 0.75, 1].map((f) => h('polygon', { key: 'ring' + f, points: ring(f), fill: 'none', stroke: 'rgba(127,127,127,.18)', strokeWidth: 1 })),
          ...dims.map((d, i) => {
            const [x2, y2] = pt(i, max);
            const [lx, ly] = pt(i, max * 1.2);
            return h('g', { key: 'ax' + d.key },
              h('line', { x1: c, y1: c, x2, y2, stroke: 'rgba(127,127,127,.18)' }),
              h('text', { x: lx, y: ly + 3, textAnchor: 'middle', fontSize: 9.5, fill: 'currentColor', opacity: 0.6 }, d.label));
          }),
          ...rows.map((s, si) => h('polygon', {
            key: 'r' + s.label,
            points: dims.map((d, i) => pt(i, (s.scores || {})[d.key]).join(',')).join(' '),
            fill: tint(PALETTE[si % PALETTE.length], 0.16), stroke: PALETTE[si % PALETTE.length], strokeWidth: 1.6,
          }))),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10 } },
          ...(rows.length ? rows.map((s, i) => h('span', { key: s.label, style: { display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.8 } },
            h('span', { style: { width: 10, height: 3, borderRadius: 2, background: PALETTE[i % PALETTE.length] } }),
            `${s.title} ${s.total}/${s.max || 8}`)) : [h('span', { key: 'none', style: { opacity: 0.68 } }, T('暂无候选评分', 'No candidate scores'))]))));
    }

    // 工具用量 Treemap：二分切分（确定性、无依赖），面积按调用次数
    function Treemap({ data, width = 300, height = 118, label }) {
      const items = (data || []).filter((d) => Number(d.value) > 0).slice(0, 8);
      const total = items.reduce((a, d) => a + (Number(d.value) || 0), 0);
      const cells = [];
      const layout = (arr, x, y, w, hh) => {
        if (!arr.length) return;
        if (arr.length === 1) { cells.push({ d: arr[0], x, y, w, h: hh }); return; }
        const sum = arr.reduce((a, d) => a + (Number(d.value) || 0), 0) || 1;
        let acc = 0; let cut = arr.length - 1;
        for (let i = 0; i < arr.length - 1; i++) { acc += Number(arr[i].value) || 0; if (acc >= sum / 2) { cut = i + 1; break; } }
        cut = Math.min(arr.length - 1, Math.max(1, cut));
        const a = arr.slice(0, cut); const b = arr.slice(cut);
        const sa = a.reduce((t, d) => t + (Number(d.value) || 0), 0) / sum;
        if (w >= hh) { layout(a, x, y, w * sa, hh); layout(b, x + w * sa, y, w * (1 - sa), hh); }
        else { layout(a, x, y, w, hh * sa); layout(b, x, y + hh * sa, w, hh * (1 - sa)); }
      };
      layout(items.map((d) => ({ ...d, value: Number(d.value) || 0 })), 0, 0, width, height);
      const allNames = items.map((d) => `${d.label} ${d.value}`).join('，');
      const summary = items.length ? allNames : T('本周无工具调用', 'no tool calls');
      return h('div', { role: 'img', 'aria-label': label || T(`工具用量矩形树图：${summary}（合计 ${total} 次）`, `Tool usage treemap: ${summary} (total ${total})`), style: { width: '100%' } },
        h('div', { style: { width: '100%', maxWidth: 340, margin: '0 auto' } },
        h('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: { width: '100%', height: 'auto' }, 'aria-hidden': 'true' },
          ...(cells.length ? cells.map((cell, i) => {
            const cellColor = PALETTE[i % PALETTE.length];
            // 实际合成色：tint(c,.8) 叠在卡片底色上，用它算深/浅字，避免浅色主题白字 1.4-3.2:1
            const cellBg = mixHex(cellColor, isDarkTheme() ? '#151517' : '#F7F7F8', 0.2);
            const labelInk = readableOn(cellBg);
            const full = String(cell.d.label || '');
            const maxChars = Math.max(4, Math.floor(cell.w / 6));
            const short = full.length > maxChars ? full.slice(0, maxChars - 1) + '…' : full;
            return h('g', { key: 'cell' + cell.d.label },
              h('title', null, `${full} · ${cell.d.value}`),
              h('rect', {
                x: cell.x + 1, y: cell.y + 1, width: Math.max(1, cell.w - 2), height: Math.max(1, cell.h - 2), rx: 5,
                fill: tint(cellColor, 0.8), stroke: 'rgba(127,127,127,.22)',
              }),
              cell.w > 44 && cell.h > 18 ? h('text', { x: cell.x + 6, y: cell.y + 14, fontSize: 8.5, fill: labelInk, opacity: 0.98 }, short) : null,
              cell.w > 44 && cell.h > 32 ? h('text', { x: cell.x + 6, y: cell.y + 27, fontSize: 10, fontWeight: 700, fill: labelInk }, String(cell.d.value)) : null);
          })
            : [h('rect', { key: 'empty', x: 0, y: 0, width, height, rx: 6, fill: 'rgba(127,127,127,.08)' })]))));
    }

    // 周信号量堆叠面积：会话/候选/压缩三条序列（同一「个数」单位，可堆叠）
    function StackedArea({ weeks, series, width = 300, height = 104, label }) {
      const ws = weeks || []; const ss = series || [];
      const n = ws.length; const pad = 8;
      const left = (i) => (n <= 1 ? pad : pad + (i * (width - pad * 2)) / (n - 1));
      const right = (i) => (n <= 1 ? width - pad : left(i));
      const sums = ws.map((w, i) => ss.reduce((a, s) => a + (Number(s.values[i]) || 0), 0));
      const maxV = Math.max(1, ...sums);
      const y = (v) => height - pad - (v / maxV) * (height - pad * 2 - 6);
      const base = ws.map(() => 0);
      const layers = [];
      for (const s of ss) {
        const top = ws.map((w, i) => `${left(i)},${y(base[i] + (Number(s.values[i]) || 0))}`).join(' ');
        const bottom = ws.map((w, i) => `${right(i)},${y(base[i])}`).reverse().join(' ');
        layers.push(h('polygon', { key: 'layer' + s.label, points: `${top} ${bottom}`, fill: tint(s.color, 0.5), stroke: s.color, strokeWidth: 1.2 }));
        ws.forEach((w, i) => { base[i] += Number(s.values[i]) || 0; });
      }
      // 只有 1 周时画「单条堆叠横条」：面积图在单周会退化成一条斜线，没有信息量
      const singleW = width - pad * 2;
      const singleTotal = Math.max(1, sums[0] || 0);
      let singleCursor = 0;
      const singleBars = n <= 1 ? ss.map((s) => {
        const v = Number(s.values[0]) || 0;
        const x0 = pad + (singleCursor / singleTotal) * singleW;
        const ww = (v / singleTotal) * singleW;
        singleCursor += v;
        return h('rect', {
          key: 'sbar' + s.label, x: x0, y: height / 2 - 15, width: Math.max(1, ww), height: 30, rx: 4,
          fill: tint(s.color, 0.62), stroke: s.color, strokeWidth: 1,
        });
      }) : [];
      const summary = !ws.length ? T('暂无跨周数据', 'no weekly data')
        : n <= 1
          ? `${ws[0].week} · ${ss.map((s) => `${s.label} ${Number(s.values[0]) || 0}`).join(' / ')}`
          : ws.map((w, i) => `${w.week} ${sums[i]}`).slice(-4).join('，');
      return h('div', { role: 'img', 'aria-label': label || (n <= 1
        ? T(`周信号量堆叠条（单周）：${summary}`, `Weekly stacked bar (single week): ${summary}`)
        : T(`周趋势堆叠面积图：${summary}`, `Weekly stacked area: ${summary}`)), style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { width: '100%', maxWidth: 360, margin: '0 auto' } },
        h('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: { width: '100%', height: 'auto' }, 'aria-hidden': 'true' },
          ...(n <= 1 ? singleBars : layers),
          ...ws.map((w, i) => h('text', { key: 'wk' + w.week, x: n <= 1 ? width / 2 : left(i), y: height - 1, textAnchor: 'middle', fontSize: 9, fill: 'currentColor', opacity: 0.68 }, String(w.week).replace(/^\d{4}-/, '')))),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10 } },
          ...ss.map((s) => h('span', { key: 'lg' + s.label, style: { display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.8 } },
            h('span', { style: { width: 10, height: 3, borderRadius: 2, background: s.color } }), s.label)))));
    }

    function Funnel({ funnel }) {
      if (!funnel) return null;
      const steps = [
        { label: '本周候选', value: funnel.proposed },
        { label: '本周已落地', value: funnel.landed },
        { label: '历史决策', value: funnel.landedTotal },
        { label: '已同步', value: funnel.synced },
        { label: '已跳过', value: funnel.skipped },
      ];
      return h(Bars, { data: steps.map((s) => ({ label: s.label, value: s.value })), color: TOKENS.green });
    }

    function Kpis({ k }) {
      const cells = [
        [T('会话', 'Sessions'), k.sessions, T(`主 ${k.mainSessions} · 子 ${k.subSessions}`, `${k.mainSessions} main · ${k.subSessions} sub`)],
        [T('轮次', 'Turns'), k.turns, T(`全量 ${k.turnsAll}`, `${k.turnsAll} total`)],
        [T('画像', 'Portraits'), k.portrait, T(`重复 ${k.repeats}`, `${k.repeats} repeats`)],
        [T('候选', 'Candidates'), k.candidates, T(`已落 ${k.landed} · 跳过 ${k.skipped}`, `${k.landed} landed · ${k.skipped} skipped`)],
        [T('压缩', 'Compactions'), k.compactions, T(`纠偏 ${k.corrections}`, `${k.corrections} corrections`)],
        [T('技能', 'Skills'), k.skillsUsed, T(`失败 ${k.skillFails} / 库 ${k.libraryTotal}`, `${k.skillFails} failed / ${k.libraryTotal} library`)],
      ];
      return h('div', { className: 'wr-kpis' },
        ...cells.map(([label, value, sub]) => h('div', { key: label, style: { ...S.kpi, minWidth: 0, background: 'linear-gradient(180deg, rgba(127,127,127,.055), transparent)' } },
          h('div', { style: { ...S.kpiVal, color: ink(BLUE) } }, String(value ?? 0)),
          h('div', { style: S.kpiLbl }, label + (sub ? ' · ' + sub : '')))));
    }

    function Freshness({ f }) {
      const map = {
        fresh: [T('今天/昨天', 'Today/yesterday'), TOKENS.green], aging: [T('一周内', 'Within a week'), TOKENS.orange],
        stale: [T('超过 7 天', 'Over 7 days'), TOKENS.red], none: [T('未生成', 'Not generated'), '#888'],
      };
      const [txt, color] = map[f.level] || map.none;
      return h('span', { style: S.pill(tint(color, 0.16), ink(color)) }, `${txt}${f.ageDays != null ? ' · ' + f.ageDays + 'd' : ''}`);
    }

    function Toast({ msg, onClose }) {
      React.useEffect(() => { if (msg) { const t = setTimeout(onClose, 2600); return () => clearTimeout(t); } }, [msg, onClose]);
      if (!msg) return null;
      return h('div', { style: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: '7px 10px', borderRadius: 8, background: 'rgba(20,24,34,.92)', color: '#fff', fontSize: 11, zIndex: 50 } }, msg);
    }

    function Modal({ open, title, children, onCancel, onOk, okText, danger, busy }) {
      if (!open) return null;
      return h('div', { style: S.modalWrap, onClick: onCancel },
        h('div', { style: S.modal, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onClick: (e) => e.stopPropagation() },
          h('div', { style: { fontWeight: 700, fontSize: 13 } }, title),
          h('div', { style: { fontSize: 12, opacity: 0.85, lineHeight: 1.5 } }, children),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
            h('button', { style: S.btn(), onClick: onCancel, title: HELP.cancel() }, T('取消', 'Cancel')),
            h('button', { style: S.btn(danger ? 'danger' : 'primary'), onClick: onOk, disabled: busy, title: HELP.confirm() }, busy ? T('处理中…', 'Working…') : (okText || T('确认', 'Confirm'))))));
    }

    function Drawer({ open, title, subtitle, onClose, children }) {
      const panelRef = React.useRef(null);
      const closeRef = React.useRef(null);
      const prevFocus = React.useRef(null);
      React.useEffect(() => {
        if (!open) return undefined;
        prevFocus.current = (typeof document !== 'undefined' ? document.activeElement : null);
        const t = setTimeout(() => { try { closeRef.current?.focus(); } catch {} }, 0);
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
          if (e.key !== 'Tab' || !panelRef.current) return;
          const nodes = [...panelRef.current.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
            .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
          if (nodes.length === 0) return;
          const first = nodes[0]; const last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => {
          clearTimeout(t);
          window.removeEventListener('keydown', onKey);
          try { prevFocus.current?.focus?.(); } catch {}
        };
      }, [open, onClose]);
      if (!open) return null;
      return h('div', { style: S.drawerWrap, onClick: onClose },
        h('div', { ref: panelRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: S.drawer, onClick: (e) => e.stopPropagation() },
          h('div', { style: S.drawerHead },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontWeight: 700, fontSize: 13, lineHeight: 1.4 } }, title),
              subtitle ? h('div', { style: { fontSize: 10.5, opacity: 0.65, marginTop: 2 } }, subtitle) : null),
            h('button', { ref: closeRef, style: { ...S.iconBtn, marginLeft: 0 }, onClick: onClose, 'aria-label': T('关闭', 'Close') }, '×')),
          h('div', { style: S.drawerBody }, children)));
    }

    function SortControl({ value, onChange, options, label }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 10, opacity: 0.55, marginRight: 2 } }, label || T('排序', 'Sort')),
        ...options.map(([id, text]) => h('button', {
          key: id, onClick: () => onChange(id), 'aria-pressed': value === id,
          style: { ...S.pill(value === id ? tint(BLUE, 0.16) : 'rgba(127,127,127,.1)', value === id ? ink(BLUE) : 'inherit'), border: 0, cursor: 'pointer', padding: '3px 7px' },
        }, text)));
    }

    function Skeleton({ rows = 3, label }) {
      return h('div', { className: 'wr-skeleton', role: 'status', 'aria-label': label || T('加载中', 'Loading') },
        ...Array.from({ length: Math.max(1, rows) }, (_, i) => h('div', { key: i, className: 'wr-skeleton-card' },
          h('div', { className: 'wr-skeleton-bar', style: { width: `${42 + (i % 3) * 14}%` } }),
          h('div', { className: 'wr-skeleton-bar', style: { width: `${72 - (i % 2) * 18}%`, opacity: 0.7 } }))));
    }

    function EmptyState({ title, body }) {
      return h('div', { className: 'wr-card', style: { ...S.card, alignItems: 'flex-start', gap: 4 } },
        h('div', { style: { fontWeight: 600, fontSize: 11.5 } }, title),
        body ? h('div', { style: { fontSize: 10.5, opacity: 0.65, lineHeight: 1.5 } }, body) : null);
    }

    // ── 各 Tab ────────────────────────────────────────────────
    function OverviewTab({ overview, metrics, onRun, runState, onOpenReport }) {
      if (!overview) return h(Skeleton, { rows: 4, label: T('概览加载中', 'Loading overview') });
      const m = metrics || {};
      const funnelData = m.funnel || overview.funnel || { proposed: 0, landed: 0, landedTotal: 0, synced: 0, skipped: 0 };
      // P3：Radar 的 4 个维度与堆叠面积的三条序列（都来自既有 /ui/metrics，不改数据契约）
      const radarDims = [
        { key: 'freq', label: T('频次', 'Frequency') },
        { key: 'trigger', label: T('触发', 'Trigger') },
        { key: 'capability', label: T('能力', 'Capability') },
        { key: 'verifiable', label: T('可验收', 'Verifiable') },
      ];
      const radarSeries = (m.scoreMatrix || []).slice(0, 3).map((c) => ({ label: c.key || c.title, title: c.title || c.key, scores: c.scores || {}, total: c.total, max: c.max || 8 }));
      const trend = m.weeklyTrend || [];
      const stackedSeries = [
        { label: T('会话', 'Sessions'), color: TOKENS.blue, values: trend.map((w) => w.sessions) },
        { label: T('候选', 'Candidates'), color: TOKENS.purple, values: trend.map((w) => w.candidates) },
        { label: T('压缩', 'Compactions'), color: TOKENS.orange, values: trend.map((w) => w.compactions) },
      ];
      return h('div', { className: 'wr-grid' },
        h('div', { className: 'wr-card wr-full', style: S.card },
          h('div', { style: S.row },
            h('span', { style: S.section }, T('本周指标', 'This week')),
            h('span', { style: { marginLeft: 'auto', fontSize: 10, opacity: 0.7 } }, overview.report ? `${(overview.report.bytes / 1024).toFixed(0)}KB` : T('无报告', 'No report'))),
          h(Kpis, { k: overview.kpis }),
          overview.findingsRejected ? h('div', { style: { fontSize: 10.5, color: ink(TOKENS.orange) } }, T('⚠ findings 被拒收：', '⚠ findings rejected: ') + overview.findingsRejected) : null),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.blue }, T('会话构成', 'Session mix')),
          h(Donut, { data: m.sessionSplit || [], centerLabel: T('会话', 'Sessions'), size: 84 })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.cyan }, T('轮次构成 · 主 vs 子', 'Turns · main vs sub')),
          h(Donut, { data: m.turnSplit || [], centerLabel: T('轮次', 'Turns'), size: 84 })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.orange }, T('上下文压力分布（每会话压缩次数）', 'Context pressure (compactions per session)')),
          h(Histogram, { data: m.compactionHistogram || [], color: TOKENS.orange, label: T('压缩次数分布', 'Compaction histogram') })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.purple }, T('候选形态分布', 'Candidate types')),
          h(Donut, { data: m.verdictDonut || [], centerLabel: T('候选', 'Candidates'), size: 84 })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.green }, T('采纳漏斗', 'Adoption funnel')),
          h(Funnel, { funnel: funnelData })),
        // ── P3 新增 4 类图表（Gauge / Radar / Treemap / StackedArea）──
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.green }, T('采纳率 · Gauge', 'Adoption rate · Gauge')),
          h(Gauge, { value: funnelData.landed || 0, max: funnelData.proposed || 0 })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.purple }, T('候选评分雷达 · 4 维 × 前 3', 'Candidate radar · 4 dims × top 3')),
          h(Radar, { items: radarDims, series: radarSeries })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.cyan }, T('工具用量 · Treemap', 'Tool usage · Treemap')),
          h(Treemap, { data: m.toolTop || [] })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.orange }, T('周信号量堆叠（会话 / 候选 / 压缩）', 'Weekly stacked signal volume')),
          h(StackedArea, { weeks: trend, series: stackedSeries })),
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.cyan }, T('活跃时段（24h）', 'Active hours (24h)')),
          h(Heatmap, { data: m.hourHeat || [], label: T('24 小时活跃热力图', '24h activity heatmap') }),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10.5, opacity: 0.68 } }, h('span', null, '00'), h('span', null, '06'), h('span', null, '12'), h('span', null, '18'), h('span', null, '23'))));
    }

    function PortraitTab({ findings }) {
      if (!findings) return h(Skeleton, { rows: 3, label: T('洞察加载中', 'Loading insights') });
      const [sort, setSortState] = React.useState(() => urlParam('weeklyPortraitSort', 'evidence'));
      const setSort = (v) => { setSortState(v); setUrlParam('weeklyPortraitSort', v === 'evidence' ? null : v); };
      const [selected, setSelected] = React.useState(null);
      const raw = findings.portrait || [];
      const items = raw.slice().sort((a, b) => {
        if (sort === 'outputs') return (b.outputs || []).length - (a.outputs || []).length;
        if (sort === 'title') return String(a.mainline || '').localeCompare(String(b.mainline || ''), LANG === 'en' ? 'en' : 'zh');
        return (b.sessions || []).length - (a.sessions || []).length;
      });
      const totalEvidence = raw.reduce((a, p) => a + (p.sessions || []).length, 0);
      const sessionLabel = (s) => (typeof s === 'string' ? s : (s.title || s.id || '—'));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 10.5, opacity: 0.68 } }, T(`${raw.length} 条主线 · ${totalEvidence} 个证据会话`, `${raw.length} mainlines · ${totalEvidence} evidence sessions`)),
          h('span', { style: { marginLeft: 'auto' } },
            h(SortControl, { value: sort, onChange: setSort, options: [['evidence', T('证据', 'Evidence')], ['outputs', T('产出', 'Outputs')], ['title', T('名称', 'Name')]] }))),
        items.length === 0
          ? h(EmptyState, { title: T('本周没有稳定主线', 'No stable mainlines this week'), body: T('下周继续积累会话；主线需要至少两次可复用的证据。', 'Keep collecting sessions; mainlines need at least two reusable pieces of evidence.') })
          : h('div', { className: 'wr-card wr-scroll-x', style: { ...S.card, padding: 0 } },
            h('table', { className: 'wr-table' },
              h('thead', null, h('tr', null,
                h('th', { style: { width: 34 } }, '#'),
                h('th', null, T('主线', 'Mainline')),
                h('th', null, T('目标', 'Goal')),
                h('th', { style: { width: 64 } }, T('证据', 'Evidence')),
                h('th', { style: { width: 56 } }, T('产出', 'Outputs')))),
              h('tbody', null, ...items.map((p, i) => h('tr', {
                key: p.mainline || i, tabIndex: 0, role: 'button', 'aria-label': T('查看主线详情：' + (p.mainline || ''), 'View mainline: ' + (p.mainline || '')),
                style: { cursor: 'pointer' }, onClick: () => setSelected(p),
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p); } },
              },
                h('td', { style: { opacity: 0.55, fontVariantNumeric: 'tabular-nums' } }, String(i + 1)),
                h('td', { style: { maxWidth: 360 } },
                  h('div', { title: p.mainline, style: { fontWeight: 600, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.mainline || '—')),
                h('td', { style: { maxWidth: 420, opacity: 0.78 } },
                  h('div', { title: p.goal || '', style: { fontSize: 10.5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, p.goal || '—')),
                h('td', { className: 'num' }, String((p.sessions || []).length)),
                h('td', { className: 'num' }, String((p.outputs || []).length))))))),
        h(Drawer, {
          open: !!selected,
          title: selected?.mainline || '',
          subtitle: selected ? T(`证据 ${selected.sessions?.length || 0} · 产出 ${selected.outputs?.length || 0}`, `${selected.sessions?.length || 0} evidence · ${selected.outputs?.length || 0} outputs`) : '',
          onClose: () => setSelected(null),
        }, selected ? h(React.Fragment, null,
          selected.goal ? h('div', { style: { fontSize: 11, lineHeight: 1.6, opacity: 0.82 } }, selected.goal) : null,
          selected.note ? h('div', { style: { fontSize: 10.5, opacity: 0.6, lineHeight: 1.5 } }, selected.note) : null,
          h('div', { style: S.section }, T('证据会话', 'Evidence sessions')),
          (selected.sessions || []).length === 0
            ? h('div', { style: { fontSize: 10.5, opacity: 0.6 } }, T('无证据会话', 'No evidence sessions'))
            : (selected.sessions || []).map((s, i) => h('div', { key: i, style: { fontSize: 10.5, padding: '4px 0', borderBottom: '1px solid rgba(127,127,127,.12)' } }, sessionLabel(s))),
          h('div', { style: S.section }, T('产出', 'Outputs')),
          (selected.outputs || []).length === 0
            ? h('div', { style: { fontSize: 10.5, opacity: 0.6 } }, T('无产出记录', 'No outputs'))
            : (selected.outputs || []).map((o, i) => h('div', { key: i, style: { fontSize: 10.5, opacity: 0.82 } }, String(o)))) : null));
    }

    function RepeatsTab({ findings, onToast, onCreateCandidate }) {
      if (!findings) return h(Skeleton, { rows: 3, label: T('洞察加载中', 'Loading insights') });
      const [sort, setSortState] = React.useState(() => urlParam('weeklyRepeatSort', 'count'));
      const setSort = (v) => { setSortState(v); setUrlParam('weeklyRepeatSort', v === 'count' ? null : v); };
      const [selected, setSelected] = React.useState(null);
      const [creating, setCreating] = React.useState(false);
      const costMin = (r) => Number((String(r.cost || '').match(/\d+/) || [0])[0]);
      const reps = (findings.repeats || []).slice().sort((a, b) => {
        if (sort === 'evidence') return (b.evidence || []).length - (a.evidence || []).length;
        if (sort === 'cost') return costMin(b) - costMin(a);
        return (b.count || 0) - (a.count || 0);
      });
      const evLabel = (e) => (typeof e === 'string' ? e : (e.title || e.id || e.key || '—'));
      const copyFix = (r) => {
        const brief = [
          '# 固化候选', '', `- 重复动作：${r.pattern || r.key || ''}`, `- 出现次数：${r.count || 0}`,
          `- 成本：${r.cost || '未记录'}`, '- 期望形态：skill / rule / plugin（待选择）',
          `- 证据会话：${(r.evidence || []).map(evLabel).join(', ') || '无'}`,
          '', '请据此生成一个可复用的 skill/rule/plugin 候选，并说明触发条件、输入输出和验收方式。',
        ].join('\n');
        copyToClipboard(brief,
          () => onToast?.(T('固化指令已复制，可粘贴到对话里生成候选', 'Brief copied; paste it into a chat to create a candidate')),
          () => onToast?.(T('复制失败，请手动复制', 'Copy failed; copy manually')));
      };
      const rows = reps.map((r, i) => h('tr', {
        key: r.key || i, tabIndex: 0, role: 'button', 'aria-label': T('查看重复详情：' + (r.pattern || r.key || ''), 'View repeat: ' + (r.pattern || r.key || '')),
        style: { cursor: 'pointer' }, onClick: () => setSelected(r),
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r); } },
      },
        h('td', { style: { opacity: 0.55, fontVariantNumeric: 'tabular-nums' } }, String(i + 1)),
        h('td', { title: r.pattern || r.key, style: { fontWeight: 600, fontSize: 11.5 } }, r.pattern || r.key || '—'),
        h('td', { className: 'num' }, String(r.count || 0)),
        h('td', { style: { fontSize: 10.5, opacity: 0.72 } }, r.cost || '—'),
        h('td', { className: 'num' }, String((r.evidence || []).length)),
        h('td', { style: { opacity: 0.5 } }, '›')));
      const table = h('div', { className: 'wr-card wr-scroll-x', style: { ...S.card, padding: 0 } },
        h('table', { className: 'wr-table' },
          h('thead', null, h('tr', null,
            h('th', { style: { width: 34 } }, '#'),
            h('th', null, T('重复动作', 'Repeat')),
            h('th', { style: { width: 56 } }, T('次数', 'Count')),
            h('th', { style: { width: 150 } }, T('成本', 'Cost')),
            h('th', { style: { width: 64 } }, T('证据', 'Evidence')),
            h('th', { style: { width: 40 } }, ''))),
          h('tbody', null, ...rows)));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 10.5, opacity: 0.68 } }, T(`${reps.length} 项重复`, `${reps.length} repeats`)),
          h('span', { style: { marginLeft: 'auto' } },
            h(SortControl, { value: sort, onChange: setSort, options: [['count', T('次数', 'Count')], ['cost', T('成本', 'Cost')], ['evidence', T('证据', 'Evidence')]] }))),
        reps.length === 0
          ? h(EmptyState, { title: T('本周没有稳定重复', 'No stable repeats this week'), body: T('重复动作需要两次以上证据；可以调低发现阈值或继续积累。', 'Repeats need at least two pieces of evidence; lower the threshold or keep collecting.') })
          : table,
        h(Drawer, {
          open: !!selected,
          title: selected?.pattern || selected?.key || '',
          subtitle: selected ? T(`出现 ${selected.count || 0} 次 · 证据 ${selected.evidence?.length || 0}`, `${selected.count || 0} times · ${selected.evidence?.length || 0} evidence`) : '',
          onClose: () => setSelected(null),
        }, selected ? h(React.Fragment, null,
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('span', { style: S.pill('rgba(127,127,127,.12)', 'inherit') }, selected.status || T('待固化', 'To fix')),
            selected.cost ? h('span', { style: S.pill('rgba(127,127,127,.12)', 'inherit') }, selected.cost) : null),
          h('div', { style: S.section }, T('证据会话', 'Evidence sessions')),
          (selected.evidence || []).length === 0
            ? h('div', { style: { fontSize: 10.5, opacity: 0.6 } }, T('无证据会话', 'No evidence sessions'))
            : (selected.evidence || []).map((e, i) => h('div', { key: i, style: { ...S.mono, padding: '3px 0' } }, evLabel(e))),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', {
              style: { ...S.btn('primary'), alignSelf: 'flex-start' }, disabled: creating,
              onClick: async () => {
                setCreating(true);
                try { await onCreateCandidate(selected.key || selected.pattern); } finally { setCreating(false); }
              },
              title: T('写入 proposals.json 生成候选，仍需在候选页采纳', 'Writes proposals.json as a candidate; still adopt it on the Candidates tab'),
            }, creating ? T('生成中…', 'Creating…') : T('生成候选', 'Create candidate')),
            h('button', { style: { ...S.btn(), alignSelf: 'flex-start' }, onClick: () => copyFix(selected) }, T('复制 brief', 'Copy brief')))) : null));
    }

    function CandidateCard({ c, expanded, onToggle, onLand, onToast }) {
      const badgeColor = { skill: TOKENS.blue, 'skill-lite': TOKENS.purple, rule: TOKENS.green, plugin: TOKENS.purple, schedule: TOKENS.cyan, watcher: TOKENS.orange, skip: '#888' }[c.verdict] || '#888';
      const dims = [[T('频次', 'Frequency'), c.scores?.freq], [T('触发', 'Trigger'), c.scores?.trigger], [T('能力', 'Capability'), c.scores?.capability], [T('可验证', 'Verifiable'), c.scores?.verifiable]];
      return h('div', { className: 'wr-card', style: S.card },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: onToggle },
          h('span', { style: S.pill(tint(badgeColor, 0.16), ink(badgeColor)) }, verdictLabel(c.verdict)),
          h('span', { style: { fontWeight: 600, fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.title),
          h('span', { style: { fontSize: 10.5, opacity: 0.7, fontVariantNumeric: 'tabular-nums' } }, `${c.total}/${c.max}`),
          c.landed ? h('span', { style: S.pill(tint(TOKENS.green, 0.16), ink(TOKENS.green)) }, T('已落地', 'Landed'))
            : c.skipped ? h('span', { style: S.pill('rgba(127,127,127,.12)', 'inherit') }, T('已跳过', 'Skipped'))
              : h('button', {
                style: { ...S.btn('primary'), padding: '2px 7px', fontSize: 10 },
                title: HELP.adopt(), onClick: (e) => { e.stopPropagation(); onLand(c); },
              }, T('采纳', 'Adopt')),
          h('span', { style: { opacity: 0.68, transform: expanded ? 'rotate(90deg)' : 'none' } }, '›')),
        expanded ? h(React.Fragment, null,
          c.what ? h('div', { style: { fontSize: 10.5, opacity: 0.8, lineHeight: 1.55 } }, c.what) : null,
          h('div', { style: { display: 'flex', gap: 8 } },
            ...dims.map(([label, v]) => h('div', { key: label, style: { flex: 1 } },
              h('div', { style: { fontSize: 9.5, opacity: 0.68 } }, label),
              h('div', { style: { ...S.barTrack, marginTop: 3 } }, h('div', { style: S.barFill(((v || 0) / 2) * 100, TOKENS.blue) }))))),
          c.saving || c.effort ? h('div', { style: { fontSize: 10, opacity: 0.6 } }, [c.saving && '节省：' + c.saving, c.effort && '成本：' + c.effort].filter(Boolean).join(' · ')) : null,
          c.evidenceSessions?.length ? h('div', { style: S.mono }, `证据 ${c.evidenceSessions.length} 个会话`) : null,
          h('div', { style: S.row },
            c.landed ? h('span', { style: { fontSize: 10.5, color: ink(TOKENS.green) } }, T('已落地 · ', 'Landed · ') + (c.landed.where || ''))
              : c.skipped ? h('span', { style: { fontSize: 10.5, opacity: 0.68 } }, T('已跳过', 'Skipped')) : null,
            h('button', { style: S.btn(), onClick: () => {
              copyToClipboard(c.key,
                () => onToast?.(T('候选 key 已复制', 'Candidate key copied')),
                () => onToast?.(T('复制失败，请手动复制', 'Copy failed; copy manually')));
            }, title: HELP.copyKey() }, T('复制 key', 'Copy key')))) : null);
    }

    function CandidatesTab({ data, onReload, onToast }) {
      const [filter, setFilterState] = React.useState(() => urlParam('weeklyCandidateFilter', 'all'));
      const [q, setQState] = React.useState(() => urlParam('weeklyCandidateQ', ''));
      const [expanded, setExpanded] = React.useState({});
      const [sort, setSortState] = React.useState(() => urlParam('weeklyCandidateSort', 'score'));
      const setFilter = (v) => { setFilterState(v); setUrlParam('weeklyCandidateFilter', v === 'all' ? null : v); };
      const setQ = (v) => { setQState(v); setUrlParam('weeklyCandidateQ', v || null); };
      const setSort = (v) => { setSortState(v); setUrlParam('weeklyCandidateSort', v === 'score' ? null : v); };
      const [confirm, setConfirm] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      if (!data) return h(Skeleton, { rows: 3, label: T('数据加载中', 'Loading data') });
      const list = (data.candidates || []);
      const verdicts = ['all', ...new Set(list.map((c) => c.verdict))];
      const labelOf = (v) => verdictLabel(v);
      const countOf = (v) => (v === 'all' ? list.length : list.filter((c) => c.verdict === v).length);
      const shown = list.filter((c) => (filter === 'all' || c.verdict === filter)
        && (!q || (c.key + ' ' + c.title + ' ' + (c.what || '')).toLowerCase().includes(q.toLowerCase())))
        .slice().sort((a, b) => (sort === 'title'
          ? String(a.title || '').localeCompare(String(b.title || ''), LANG === 'en' ? 'en' : 'zh')
          : (b.total || 0) - (a.total || 0)));
      const doLand = async () => {
        setBusy(true);
        try {
          const r = await fetch(API + '/land', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: confirm.key, sync: true }) });
          const j = await r.json();
          onToast(j.ok ? `采纳成功 · ${j.where || ''}` : `采纳失败：${j.error || r.status}`);
          onReload();
        } catch (e) { onToast('采纳失败：' + e.message); }
        setBusy(false); setConfirm(null);
      };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { className: 'wr-toolbar', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          ...verdicts.map((v) => h('button', {
            key: v, onClick: () => setFilter(v), title: HELP.filter(v),
            'aria-pressed': filter === v,
            style: { ...S.pill(filter === v ? tint(BLUE, 0.18) : 'rgba(127,127,127,.12)', filter === v ? ink(BLUE) : 'inherit'), border: 0, cursor: 'pointer', padding: '4px 9px' },
          }, `${labelOf(v)} ${countOf(v)}`)),
          h('input', {
            value: q, onChange: (e) => setQ(e.target.value), placeholder: T('搜索候选…', 'Search candidates…'),
            'aria-label': T('搜索候选', 'Search candidates'),
            style: { flex: '1 1 220px', minWidth: 160, boxSizing: 'border-box', padding: '6px 8px', borderRadius: 7, border: '1px solid rgba(127,127,127,.3)', background: 'transparent', color: 'inherit', fontSize: 11 },
          }),
          h('select', {
            value: sort, onChange: (e) => setSort(e.target.value), 'aria-label': T('候选排序', 'Candidate sort'),
            style: { padding: '5px 7px', borderRadius: 7, border: '1px solid rgba(127,127,127,.3)', background: 'transparent', color: 'inherit', fontSize: 10.5 },
          }, h('option', { value: 'score' }, T('按评分', 'By score')), h('option', { value: 'title' }, T('按名称', 'By name')))),
        shown.length === 0 ? h(EmptyState, { title: T('没有匹配的候选', 'No matching candidates'), body: T('清除搜索或切换筛选条件。', 'Clear the search or switch filters.') }) : null,
        ...shown.map((c) => h(CandidateCard, {
          key: c.key, c, expanded: !!expanded[c.key],
          onToggle: () => setExpanded((s) => ({ ...s, [c.key]: !s[c.key] })),
          onLand: (x) => setConfirm(x), onToast,
        })),
        h(Modal, { open: !!confirm, title: T('采纳候选', 'Adopt candidate'), danger: false, busy, okText: T('采纳并同步', 'Adopt & sync'), onCancel: () => setConfirm(null), onOk: doLand },
          confirm ? h('div', null, h('div', { style: { fontWeight: 600, marginBottom: 4 } }, confirm.title), h('div', { style: S.mono }, confirm.key), h('div', { style: { marginTop: 6 } }, T('将写入 decisions.json，并执行本机 land-sync.sh——可能 git push 到你自己的私有配置仓库（可回滚）。', 'Writes decisions.json and runs local land-sync.sh — may git-push to your own private config repo (rollback-able).'))) : null));
    }

    function HistoryTab({ data }) {
      if (!data) return h(Skeleton, { rows: 3, label: T('数据加载中', 'Loading data') });
      const w = data.weeks || [];
      const decisions = (data.decisions || []).slice(-8).reverse();
      const series = [{ label: T('会话', 'Sessions'), values: w.map((x) => x.sessions) }];
      const prevByWeek = new Map(w.map((x, i) => [x.week, i > 0 ? w[i - 1] : null]));
      const deltaOf = (x) => { const p = prevByWeek.get(x.week); return p ? (Number(x.sessions) || 0) - (Number(p.sessions) || 0) : null; };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.blue }, T('每周会话量', 'Sessions per week')),
          w.length > 1
            ? h(LineChart, { weeks: w.map((x) => x.week), series })
            : h('div', { style: { fontSize: 10.5, opacity: 0.68 } },
              T(`只有 ${w.length} 周数据，跨周趋势暂不可用`, `Only ${w.length} week(s) of data; trend unavailable`))),
        h('div', { className: 'wr-card wr-scroll-x', style: { ...S.card, padding: 0 } },
          h('table', { className: 'wr-table' },
            h('thead', null, h('tr', null,
              h('th', null, T('周', 'Week')), h('th', { className: 'num' }, T('会话', 'Sessions')),
              h('th', { className: 'num' }, T('Δ 会话', 'Δ sessions')),
              h('th', { className: 'num' }, T('轮次', 'Turns')), h('th', { className: 'num' }, T('候选', 'Candidates')),
              h('th', { className: 'num' }, T('压缩', 'Compactions')), h('th', { style: { width: 64 } }, T('报告', 'Report')))),
            h('tbody', null, ...w.slice().reverse().map((x) => h('tr', { key: x.week },
              h('td', { style: { fontWeight: 600 } }, x.week),
              h('td', { className: 'num' }, String(x.sessions ?? 0)),
              h('td', { className: 'num' }, (() => {
                const d = deltaOf(x);
                if (d == null) return h('span', { style: { opacity: 0.4 } }, '—');
                const color = d > 0 ? ink(TOKENS.green) : d < 0 ? ink(TOKENS.red) : 'inherit';
                return h('span', { style: { color, fontVariantNumeric: 'tabular-nums' } }, `${d > 0 ? '+' : ''}${d}`);
              })()),
              h('td', { className: 'num' }, String(x.turns ?? 0)),
              h('td', { className: 'num' }, String(x.candidates ?? 0)),
              h('td', { className: 'num' }, String(x.compactions ?? 0)),
              h('td', null, h('button', {
                style: { ...S.btn(), fontSize: 10, padding: '3px 8px' },
                onClick: () => window.open(`${API}/report?week=${encodeURIComponent(x.week)}`, '_blank'),
                title: HELP.weekReport(),
              }, T('报告', 'Report')))))))) ,
        h('div', { className: 'wr-card', style: S.card },
          h(ChartHead, { color: TOKENS.green }, T('采纳时间线', 'Adoption timeline')),
          decisions.length === 0
            ? h('div', { style: { fontSize: 10.5, opacity: 0.68 } }, T('暂无采纳记录', 'No adoptions yet'))
            : decisions.map((d, i) => h('div', {
              key: i,
              style: { fontSize: 10.5, opacity: 0.8, padding: '3px 0', borderBottom: '1px solid rgba(127,127,127,.12)' },
            }, `${d.at || '?'} · ${d.title || d.key || '?'} · ${d.where || T('未同步', 'not synced')}`))));
    }

    // ── 可解释提示（Tip）：hover 与键盘 focus 都显示，title 兜底 ─────
    // 结构：span.weekly-tip-wrap(position:relative) > 真实触发元素 + span[role=tooltip]
    // 事件挂在触发元素上（而不是包裹层），这样键盘 focus 也能命中；aria-describedby 指向 tooltip id。
    let tipSeq = 0;
    function Tip({ text, side = 'bottom', align = 'left', wrapStyle, children }) {
      const [open, setOpen] = React.useState(false);
      const idRef = React.useRef(null);
      if (!idRef.current) { tipSeq += 1; idRef.current = 'weekly-tip-' + tipSeq; }
      const id = idRef.current;
      const child = React.Children.only(children);
      const prev = child.props || {};
      const chain = (name, fn) => (...args) => {
        if (typeof prev[name] === 'function') prev[name](...args);
        fn(...args);
      };
      const trigger = React.cloneElement(child, {
        'aria-describedby': id,
        title: text || prev.title,
        onMouseEnter: chain('onMouseEnter', () => setOpen(true)),
        onMouseLeave: chain('onMouseLeave', () => setOpen(false)),
        onFocus: chain('onFocus', () => setOpen(true)),
        onBlur: chain('onBlur', () => setOpen(false)),
        onClick: chain('onClick', () => setOpen(false)),
        onKeyDown: chain('onKeyDown', (e) => { if (e && e.key === 'Escape') setOpen(false); }),
      });
      const pos = side === 'top' ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' };
      if (align === 'right') pos.right = 0;
      else if (align === 'center') { pos.left = '50%'; pos.transform = 'translateX(-50%)'; }
      else pos.left = 0;
      return h('span', { className: 'weekly-tip-wrap', style: wrapStyle },
        trigger,
        open && text ? h('span', { id, role: 'tooltip', className: 'weekly-tip', style: pos }, text) : null);
    }

    // HELP 文案表：每次渲染时调用 T(zh,en)，确保宿主 locale bind 之后仍取当前语言。
    const HELP = {
      tabOverview: () => T('概览：本周关键指标与图表', 'Overview: key metrics and charts for this week'),
      tabPortrait: () => T('画像：本周工作流主线与证据', "Portrait: this week's workflow mainlines and evidence"),
      tabRepeats: () => T('重复：重复出现的劳动', 'Repeats: work that keeps repeating'),
      tabCandidates: () => T('候选：可落地为技能/规则/插件的候选', 'Candidates: candidates that can become skills, rules or plugins'),
      tabHistory: () => T('历史：跨周趋势与采纳时间线', 'History: cross-week trends and adoption timeline'),
      runSection: () => T('运行：重跑报告、打开 HTML 报告或查看执行进度', 'Run: regenerate the report, open the HTML report, or watch progress'),
      reportOnly: () => T('只重跑报告：不重新采集，仅用已有 digest 重新生成报告（约 2 秒）', 'Report only: no re-collection; regenerates the report from the existing digest (~2s)'),
      fullRerun: () => T('全量重跑：重新采集本周会话再生成（2–5 秒，可能更新数据）', 'Full rerun: re-collects this week\'s sessions, then regenerates (2–5s; data may update)'),
      openReport: () => T('打开报告：新标签打开完整 HTML 报告', 'Open report: opens the full HTML report in a new tab'),
      refresh: () => T('刷新：重新拉取面板数据', 'Refresh: re-fetches the panel data'),
      openFull: () => T('打开完整报告：新标签打开完整 HTML 报告', 'Open full report: opens the full HTML report in a new tab'),
      adopt: () => T('采纳并同步：写入 decisions.json 并同步到配置仓库（可回滚）', 'Adopt & sync: writes decisions.json and syncs to the config repo (rollback-able)'),
      copyKey: () => T('复制 key：把候选 key 复制到剪贴板', 'Copy key: copies the candidate key to the clipboard'),
      weekReport: () => T('报告：新标签打开该周的 HTML 报告', 'Report: opens that week\'s HTML report in a new tab'),
      cancel: () => T('取消：关闭弹窗，不做任何写入', 'Cancel: closes the dialog without writing anything'),
      confirm: () => T('确认：继续执行此操作', 'Confirm: proceeds with this action'),
      retry: () => T('重试：重新拉取面板数据', 'Retry: re-fetches the panel data'),
      filter: (v) => T('筛选：只看 ' + v + ' 形态的候选', 'Filter: show only "' + v + '" candidates'),
    };

    // ── 面板 ─────────────────────────────────────────────────
    // [id, 中文, English, HELP key, tooltip 对齐]：5 个 Tab 都带可解释提示（P2）
    const TABS = [
      ['overview', '概览', 'Overview', 'tabOverview', 'left'], ['portrait', '画像', 'Portrait', 'tabPortrait', 'left'],
      ['repeats', '重复', 'Repeats', 'tabRepeats', 'center'], ['candidates', '候选', 'Candidates', 'tabCandidates', 'right'],
      ['history', '历史', 'History', 'tabHistory', 'right'],
    ];

    function Panel() {
      const [tab, setTabState] = React.useState(() => {
        const v = urlParam('weeklyTab', 'overview');
        return TABS.some(([id]) => id === v) ? v : 'overview';
      });
      const setTab = (id) => { setTabState(id); setUrlParam('weeklyTab', id === 'overview' ? null : id); };
      const pollTimer = React.useRef(null);
      React.useEffect(() => { ensureScrollStyles(); }, []);
      React.useEffect(() => () => { if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; } }, []);
      const [toast, setToast] = React.useState('');
      const [runState, setRunState] = React.useState({ running: false, mode: null, phase: '', tail: '' });
      const overview = useJson('/ui/overview');
      const metrics = useJson('/ui/metrics');
      const findings = useJson('/ui/findings');
      const candidates = useJson('/ui/candidates');
      const history = useJson('/ui/history');

      const reloadAll = () => { overview.reload(); metrics.reload(); findings.reload(); candidates.reload(); history.reload(); };

      const pollJob = (id, mode) => {
        const timer = setInterval(async () => {
          pollTimer.current = timer;
          try {
            const r = await fetch(API + '/ui/job?id=' + encodeURIComponent(id));
            const j = await r.json();
            setRunState({ running: j.phase === 'running', mode, phase: j.phase, tail: j.tail || '' });
            if (j.phase !== 'running') {
              clearInterval(timer); pollTimer.current = null;
              setToast(j.phase === 'done' ? (mode === 'full' ? '全量重跑完成' : '报告已重跑') : ('执行失败：' + (j.error || j.phase)));
              reloadAll();
            }
          } catch { clearInterval(timer); pollTimer.current = null; setRunState({ running: false, mode, phase: 'poll-failed', tail: '' }); }
        }, 800);
      };

      const startRun = async (mode) => {
        if (mode === 'full' && !window.confirm('全量重跑会重新采集本周会话，约 2–5 秒，可能更新本周数据。继续？')) return;
        setRunState({ running: true, mode, phase: 'queued', tail: '' });
        try {
          const r = await fetch(API + '/ui/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
          const j = await r.json();
          if (!r.ok || !j.jobId) throw new Error(j.error || ('HTTP ' + r.status));
          setRunState({ running: true, mode, phase: 'running', tail: '' });
          pollJob(j.jobId, mode);
        } catch (e) {
          setRunState({ running: false, mode, phase: 'failed', tail: String(e.message || e) });
          setToast('启动失败：' + e.message);
        }
      };

      const createRepeatCandidate = async (repeatKey) => {
        try {
          const r = await fetch(API + '/ui/repeat-candidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: repeatKey }) });
          const j = await r.json();
          if (!r.ok || !j.ok) { setToast('生成候选失败：' + (j.error || ('HTTP ' + r.status))); return j; }
          setToast(j.already ? `候选已存在：${j.key}` : `候选已生成：${j.key}（仍需采纳）`);
          candidates.reload();
          setTab('candidates');
          return j;
        } catch (e) { setToast('生成候选失败：' + e.message); return { ok: false, error: e.message }; }
      };

      const body = (() => {
        if (tab === 'overview') return h(OverviewTab, { overview: overview.data, metrics: metrics.data, onRun: startRun, runState, onOpenReport: () => window.open(API + '/report', '_blank') });
        if (tab === 'portrait') return h(PortraitTab, { findings: findings.data });
        if (tab === 'repeats') return h(RepeatsTab, { findings: findings.data, onToast: setToast, onCreateCandidate: createRepeatCandidate });
        if (tab === 'candidates') return h(CandidatesTab, { data: candidates.data, onReload: candidates.reload, onToast: setToast });
        return h(HistoryTab, { data: history.data });
      })();

      const err = overview.error || metrics.error || findings.error || candidates.error || history.error;
      return h('div', { style: S.panel },
        h('div', { style: S.head },
          h('span', { style: S.title }, T('周报', 'Weekly Retro')),
          overview.data?.week ? h('span', { style: { fontSize: 10.5, opacity: 0.6 } }, overview.data.week) : null,
          overview.data ? h(Freshness, { f: overview.data.freshness }) : null,
          h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
            runState.running ? h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: 10, opacity: 0.7 } }, T(`运行中 · ${runState.phase}`, `Running · ${runState.phase}`)) : null,
            h(Tip, { text: HELP.reportOnly(), align: 'right' },
              h('button', { style: { ...S.btn(), padding: '4px 8px' }, disabled: runState.running, onClick: () => startRun('report') }, T('只重跑', 'Rerun'))),
            h(Tip, { text: HELP.fullRerun(), align: 'right' },
              h('button', { style: { ...S.btn(), padding: '4px 8px' }, disabled: runState.running, onClick: () => startRun('full') }, T('全量', 'Full'))),
            h(Tip, { text: HELP.openReport(), align: 'right' },
              h('button', { style: { ...S.btn(), padding: '4px 8px' }, onClick: () => window.open(API + '/report', '_blank') }, T('报告', 'Report'))),
            h(Tip, { text: HELP.refresh(), align: 'right' },
              h('button', { style: { ...S.iconBtn, padding: '4px 8px' }, onClick: reloadAll, 'aria-label': T('刷新数据', 'Refresh data') }, overview.loading ? '…' : T('刷新', 'Refresh'))))),
        h('div', { style: S.tabs, role: 'tablist', 'aria-label': T('周报视图', 'Weekly views') },
          ...TABS.map(([id, zh, en, helpKey, align]) => h(Tip, { key: id, text: HELP[helpKey](), align },
            h('button', {
              role: 'tab', 'aria-selected': tab === id, 'aria-controls': 'weekly-retro-panel',
              style: S.tab(tab === id), onClick: () => setTab(id),
            }, T(zh, en))))),
        runState.running ? h('div', { style: { padding: '4px 10px 0', flex: '0 0 auto' }, role: 'status', 'aria-live': 'polite' },
          h('div', { style: { ...S.barTrack, height: 3 } }, h('div', { style: { height: '100%', width: '65%', background: `linear-gradient(90deg, ${TOKENS.blue}, ${TOKENS.purple})`, borderRadius: 4 } }))) : null,
        err ? h('div', { role: 'alert', style: { padding: 12, fontSize: 11, color: ink(TOKENS.red) } }, T('加载失败：', 'Load failed: ') + err, h('button', { style: { ...S.btn(), marginLeft: 8 }, onClick: reloadAll, title: HELP.retry() }, T('重试', 'Retry')))
          : h('div', { id: 'weekly-retro-panel', role: 'tabpanel', 'aria-label': T('周报面板', 'Weekly retro panel'), className: 'weekly-scroll', style: S.body }, body),
        h(Toast, { msg: toast, onClose: () => setToast('') }));
    }

    function MainPanel() {
      // B1：顶部 hero 与 Panel 头部信息重复，合并为单层；高度全部让给内容。
      return h('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h(Panel, {}));
    }

    function PanelTitle() {
      return h('span', { style: { fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', { style: { width: 7, height: 7, borderRadius: 2, background: BLUE, display: 'inline-block' } }), T('周报', 'Weekly Retro'));
    }

    // 侧栏条目只提供图标：宿主标准行负责 36px 高度、label 文字与点击
    function Entry({ size }) {
      const s = typeof size === 'number' && size > 0 ? size : 18;
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', style: { display: 'block' },
      },
        h('path', { d: 'M7 3.5h7.5L19 8v12.5H7z' }),
        h('path', { d: 'M14.5 3.5V8H19' }),
        h('path', { d: 'M4.5 9.5a5 5 0 0 0 1.2 6.6' }),
        h('path', { d: 'M4 13.6l.5-4.1 4.1.5' }),
        h('path', { d: 'M9.2 16.5h6.3' }),
        h('path', { d: 'M9.2 13.4h4.2' }));
    }

    function apply(ctx) {
      LANG = detectLang();
      ensureScrollStyles();
      try {
        const loc = ctx && ctx.locale;
        if (loc) {
          if (typeof loc.register === 'function') {
            if (typeof ctx.effect === 'function') ctx.effect(() => loc.register(NS, MESSAGES));
            else loc.register(NS, MESSAGES);
          }
          if (typeof loc.bind === 'function') {
            const bound = loc.bind(NS);
            HOST_LOCALE = (k) => { const v = bound(k); return v && v !== k ? v : null; };
          } else if (typeof loc.t === 'function') {
            HOST_LOCALE = (k) => { const v = loc.t(NS + '.' + k); return v && v !== NS + '.' + k ? v : null; };
          }
        }
      } catch (e) { console.warn('[weekly-retro] locale 不可用，回退内置文案', e); }
      LANG = detectLang();
      const reg = (slot, key, comp, extra) => {
        try {
          ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, ...extra, ...(key ? { key, id: key } : {}) }, comp));
        } catch (e) { console.warn('[weekly-retro] slot 注册失败', slot, e); }
      };
      // 侧栏条目点击默认调用 layout.selectPanel(id)，必须有同 id 的 main 面板兜住
      // 单一入口：侧栏「周报」→ main 洞察页（不再重复注册右侧 pane tab）
      reg('main', 'weekly-retro', MainPanel, { label: () => T('周报', 'Weekly Retro'), locale: NS });
      reg('sidebar.panellist', 'weekly-retro', Entry, {
        order: 30, label: () => T('周报', 'Weekly Retro'), locale: NS,
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    } catch (e) {
      // 最后一道保险：client 初始化失败也只降级为空实现，绝不让 web 启动挂起
      console.error('[weekly-retro] client init failed:', e);
      try { exports.apply = () => {}; exports.inject = []; } catch {}
    }
    return module.exports;
  },
});
