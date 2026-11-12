# 周报插件 · 侧边栏可视化交互 UI 设计规范（v0.1 草案）

> 状态：**已批准并实施 P0–P3**（面板+条目 / 采纳+运行 / 完整五 Tab，分两批上线）。参照物：已安装插件 `dsh-context`（上下文洞察）。
> 目标：把 `/weekly` 的纯文本输出升级为"常驻侧边栏工作台"——看清本周、就地操作、状态可观测。

---

## 1. 参照物分析（dsh-context，有源码证据）

| 维度 | dsh-context 做法 | 对本插件的启示 |
|---|---|---|
| 入口 | `sidebar.panellist` 一级入口 + `sidebar.right.pane.tab` 右侧面板 + `main` 洞察页 + `conversation.view` + `plugins.bundle.config` 偏好卡 | 先做 **panellist 入口 + 右侧面板**两个，主页面后置 |
| 数据 | 13 条 `/api/dsh-context/*` 路由（overview/detail/facts/fleet/commands/skills/heads/snapshot/balance/attachment/backfill/version/recom） | 前端不读文件，全部同源 HTTP；新增 `/ui/*` 只读 + 复用 `/run`、`/land` 写路由 |
| client 依赖 | `dsh.client.inject = [api-remotes, client-connection, client-locale, ui-conversation, ui-settings, ui-sidebar-right]` | **必须逐条验证本机可用**（历史事故就是 inject 写错导致 web 启动挂起） |
| 信息架构 | 总览 KPI → 组成/趋势 → 事件/明细；面板内分 tab，避免一次灌满 | 概览 / 画像 / 重复 / 候选 / 历史 五段式 |
| 交互 | 筛选、搜索、时间范围、会话跳转、命令弹窗、偏好设置 | 周切换、结论筛选、候选采纳、运行进度、确认弹窗 |

---

## 2. 功能目标（按优先级）

1. **一眼看清本周**：会话/轮次/画像/重复/候选/压缩与纠偏，带数据新鲜度。
2. **就地决策**：候选展开看证据与评分 → 采纳（写 decisions + 落地同步）→ 状态回显。
3. **可观测执行**：「只重跑报告 / 全量重跑」→ 异步 job + 进度 + 失败原因，绝不冻结 UI。
4. **跨周连续**：周列表 + 趋势 + 历史报告跳转 + 采纳时间线。
5. **不添乱**：插件坏了不影响宿主；写操作必须二次确认且可回滚。

---

## 3. 入口与布局

### 3.1 入口清单（分阶段启用）

| 入口 | slot | 阶段 | 说明 |
|---|---|---|---|
| 侧边栏条目「周报」 | `sidebar.panellist` | P2 | 图标 + 标题 + 候选数 badge；点击聚焦右侧面板 |
| 右侧面板 tab「周报」 | `sidebar.right.pane.tab` (+`.title`) | P2 | 主工作台，宽度自适应 320–480px |
| 偏好设置卡 | `plugins.bundle.config` | P4 | 默认 tab、badge 开关、轮询间隔 |
| `/weekly` 面板指令 | 命令既有 | P4 | `/weekly panel` 打开右侧面板（可选） |
| 主视图洞察页 | `main` | P5（可选） | 大屏复盘页，复用同一组件集 |

### 3.2 线框（右侧面板 360px）

```
┌────────────────────────────────────────────┐
│ ◈ 周报 · 2026-W46        ● 3 天前   ⟳ ⋯  │  ← 头部：标题/新鲜度/刷新/更多
├────────────────────────────────────────────┤
│ 概览   画像   重复   候选   历史           │  ← tabs（键盘 ←→ 切换）
├────────────────────────────────────────────┤
│ ┌────────┬────────┬────────┬────────┐      │
│ │ 12 会话│ 84 轮 │ 3 候选 │ 4 压缩 │      │  ← KPI 四宫格（主/全量副标）
│ └────────┴────────┴────────┴────────┘      │
│ ⚠ findings 被拒收：…（可展开原因）          │  ← 数据质量告警条（条件显示）
│ ┌──────────────────────────────────────┐   │
│ │ 报告 25,273B · 08:27 生成             │   │  ← 运行状态卡
│ │ [只重跑报告] [全量重跑]  [打开报告]   │   │
│ └──────────────────────────────────────┘   │
│ 候选速览（Top 3）                          │
│  [skill] Demo 文档流水线  7 分 ›      │
│  [skill] Demo 评审模板      6 分 ›      │
│  [plugin] week_query 取数工具  5 分 ›      │
└────────────────────────────────────────────┘
```

### 3.3 五个 Tab 的信息架构

| Tab | 内容 | 交互 |
|---|---|---|
| **概览** | KPI 四宫格、数据质量告警、运行状态卡、Top3 候选、报告/诊断入口 | 刷新、运行（report/full）、打开报告、查看诊断 |
| **画像** | `findings.portrait[]` 卡片：主线名、质心、强度、证据会话 | 展开证据、按强度/类型筛选、点会话跳转（若宿主支持） |
| **重复** | `findings.repeats[]` 表：模式、次数、证据数、估算节省、关联候选 | 排序、搜索、行展开证据 |
| **候选** | 候选卡：verdict 徽标、形态、总分、what/evidence/steps、4×0–2 评分矩阵、saving/effort | 采纳（确认+同步结果回显）、跳过、复制 key、按 verdict 筛选、查重提示 |
| **历史** | `history.jsonl` 周列表 + 趋势 sparkline + 每周报告入口 + decisions 时间线 | 选周、打开 `report?week=`、看采纳 where/commit |

---

## 3.4 量化数据与图表清单（已实现，数据来自 /ui/metrics）

| 图表 | 数据 | 用途 |
|---|---|---|
| 环状图 · 会话构成 | `sessionSplit`：主会话 / 子会话 | 看清有多少是用户主会话 |
| 环状图 · 轮次构成 | `turnSplit`：主会话轮次 / 子会话轮次 | 区分真实工作量与子代理放大 |
| 直方图 · 压缩分布 | `compactionHistogram`：0/1/2/3+ | 对应 AGENTS「压缩≥1 必复盘」 |
| 环状图 · 候选形态 | `verdictDonut`：skill/skill-lite/rule/plugin/… | 本周挖出了什么类型 |
| 条形图 · 重复劳动 | `repeatBars`（次数降序 Top8） | 哪些模式最值得自动化 |
| 条形图 · 主线证据量 | `portraitBars`（证据会话数） | 哪些工作线占大头 |
| 条形图 · 采纳漏斗 | `funnel`：候选→本周落地→历史决策→已同步→已跳过 | 落地转化率 |
| 热力图 · 活跃时段 | `hourHeat` 24 格 | 一天里何时在干活 |
| 折线图 · 周趋势 | `weeklyTrend`：会话/轮次/候选 | 跨周趋势（不足 2 周时提示不可用） |
| 评分矩阵 | `scoreMatrix` 4 维 × 候选 | 候选质量可解释 |
| 工具榜 | `toolTop` Top8 | 工具使用结构 |
| 会话轮次榜 | `sessionTurns` Top8 | 最重的会话 |

## 4. 组件清单（设计系统）

| 组件 | 规格 | 状态 |
|---|---|---|
| `PanelHeader` | 标题 14px/600；新鲜度徽标（新鲜 ≤1d 绿、2–7d 琥珀、>7d 红）；刷新按钮旋转 600ms | normal/refreshing/stale |
| `TabBar` | 下划线指示条；等宽；支持 ←→ Home End | active/hover/focus |
| `KpiTile` | 数值 20px/700 + 标签 11px；副标「主 X / 全 Y」；数字等宽字体 | normal/warn(0) |
| `AlertBar` | 琥珀=拒收/过期，红=失败，蓝=信息；含展开详情 | collapsible |
| `RunCard` | 两枚按钮 + 进度条 + 最近一次 tail（≤3 行）+ 耗时 | idle/running/done/failed/timeout/locked |
| `CandidateCard` | verdict 色点 + 标题 + 关键词 chips + 分数；展开区评分矩阵 | collapsed/expanded/adopted/skipped/duplicate |
| `RepeatTable` | 三列自适应；行展开证据；空态插画 | empty/filtered |
| `HistoryList` | 周行 + mini 趋势（SVG polyline，无第三方库）+ 采纳角标 | normal/current-week |
| `ConfirmDialog` | 标题 + 影响说明 + 取消/确认（危险红）；Esc 关闭 | open/busy |
| `Toast` | 右下角 3s；成功/失败/进行中 | auto-dismiss |
| `EmptyState` | 图标 + 一句原因 + 一个动作（如「先跑一次报告」） | — |
| `ErrorState` | 错误码 + 重试 + 诊断链接 | — |
| `Skeleton` | 3 行 shimmer，仅在首次加载 | — |

**设计 token**：背景 `--dsh-bg`、卡片 `--dsh-surface`、边框 `--dsh-border`、主色 `#4D6BFE`、成功 `#2F9E6E`、告警 `#C98A00`、危险 `#C7433B`；圆角 10/8；间距 4 的倍数；字体继承宿主，数字用等宽。

---

## 5. 交互行为清单

| 场景 | 行为 | 失败处理 |
|---|---|---|
| 打开面板 | 立即渲染骨架 → 拉 `/ui/overview` + `/ui/candidates` | 超时 8s → ErrorState + 重试 |
| 切换 tab | 懒加载该 tab 数据，缓存 60s | 局部 ErrorState，不影响其它 tab |
| 刷新 | 清缓存 + 重新拉取；按钮旋转 | Toast「刷新失败」 |
| 只重跑报告 | `POST /run {mode:"report"}`（job）→ 进度条 → 完成后刷新 | 409（忙）/504（超时）文案区分 |
| 全量重跑 | ConfirmDialog 明示「会重新采集，约 2–5s，可能更新本周数据」 | 同上；失败给 tail |
| 采纳候选 | ConfirmDialog 显示 key/标题/同步目标 → `POST /land` → 回显 commit 或「已落地但未同步」 | 400/409 文案；成功后卡片置 adopted |
| 跳过候选 | 本地标记 + `/land?skip`（可选，P4） | 失败回滚本地状态 |
| 筛选候选 | verdict chips 多选 + 搜索（key/title/what） | 无结果 → EmptyState |
| 查看证据 | 展开 evidence 会话 id 列表；点击复制 id | 无证据 → 「未附证据」 |
| 历史选周 | 切换周 → 概览/候选按周取数（只读），顶部标「回填周」 | 该周缺文件 → EmptyState |
| 键盘 | Tab 焦点环；Esc 关确认框；`/` 聚焦搜索；↑↓ 列表导航 | — |
| 轮询 | 仅面板可见时 5s 一次 overview；`document.visibilityState` 暂停 | 连续 3 次失败降级为手动刷新 |

---

## 6. 数据契约（新增只读路由 + 复用写路由）

> 全部同源 `fetch`，响应 `application/json`；写操作沿用同源校验（跨源 403）。

| 路由 | 方法 | 返回（摘要） |
|---|---|---|
| `/ui/overview` | GET | week、sessions/mainSessions、turns/turnsAll、portrait/repeats 计数、compactions/corrections、candidates 计数与 top3、report/packet 元信息、新鲜度、findingsRejected、skippedLanded |
| `/ui/candidates` | GET | 全量候选对象（key/title/verdict/shape/what/evidence/steps/scores/saving/effort/plugin_spec），含已采纳/已跳过标记 |
| `/ui/findings` | GET | portrait[]、repeats[]（含证据会话 id 与计数） |
| `/ui/history` | GET | history.jsonl 按周聚合 + decisions 时间线（key/title/where/commit/landed_at） |
| `/ui/decisions` | GET | decisions 原始条目（脱敏，仅 key/title/where/note/时间） |
| `/ui/report?week=` | GET | 302/HTML（复用现有 `/report`） |
| `/run` | POST | 现有；新增 `jobId` 模式：立即 202 + `{jobId}`，`/ui/job/:id` 轮询 `{phase,tail,ms}` |
| `/land` | POST | 现有；返回 `{where, synced, commit, backup}` |
| `/ui/prefs` | GET/POST | 默认 tab、badge 开关、轮询间隔（写入 profile 设置，P4） |

**约束**：单响应 ≤ 200KB；候选/证据都只给 id 与标题，不返回会话正文；`/ui/*` 全部只读且无 token（本机同源），写操作保持校验。

---

## 7. 非功能要求

- **启动安全**：client 半不得让 web boot 出现 "entry did not activate"；inject 逐条对照宿主 boot manifest。
- **性能**：首屏 ≤ 300ms（本地）；tab 切换 ≤ 100ms；轮询请求 ≤ 20KB。
- **可访问性**：焦点可见、aria-label、对比度 ≥ 4.5:1、`prefers-reduced-motion` 关闭动画。
- **主题**：跟随宿主深浅色；不硬编码白色背景。
- **隔离**：面板任何异常只影响面板，不影响聊天与会话。
- **可回滚**：client 半可单独禁用（bundle 摘除/feature flag），host 工具不受影响。

---

## 8. 分阶段任务与验收

### P0 契约与安全（0.5 天）
- [ ] 对照宿主 boot manifest 确定 `dsh.client.inject` 最小集合
- [ ] `package.json` 增加 `dsh.client`（platform web）+ `exports["./client"]`；client 入口 module loader 包装
- [ ] 隔离启动验证：`boot-verify.sh` 断言 `did not activate` 计数为 0（新增断言）
- **交付**：manifest diff + 启动日志证据
- **门禁**：不通过 P0 不允许装回 profile

### P1 数据端点（0.5–1 天）
- [ ] `/ui/overview`、`/ui/candidates`、`/ui/findings`、`/ui/history`、`/ui/decisions`
- [ ] `/run` job 模式 + `/ui/job/:id`
- [ ] 契约测试：隔离 DSH_HOME 起 web，node fetch 断言字段与大小上限
- **交付**：路由实现 + 契约测试输出 + JSON 样例

### P2 UI 骨架（1 天）
- [ ] `sidebar.panellist` 条目（图标+标题+badge）
- [ ] `sidebar.right.pane.tab` 面板骨架：头部、tabs、概览 tab、骨架/空/错三态
- [ ] 主题 token 与深浅色
- **交付**：本地构建（client bundle）+ 浅/深色截图（360px 宽）
- **门禁**：真实重启后无 boot 异常，面板可开合

### P3 核心交互（1–1.5 天）
- [ ] 候选展开/筛选/搜索/采纳（确认+同步回显）
- [ ] 运行 job 进度与失败文案
- [ ] 画像/重复/历史三个 tab
- **交付**：交互演示录屏或步骤截图 + 写操作回滚验证（decisions 备份）

### P4 打磨（0.5–1 天）
- [ ] 键盘可达性、aria、对比度检查
- [ ] 轮询/可见性暂停/缓存
- [ ] `/weekly panel` 命令、偏好卡、i18n（zh/en）
- **交付**：a11y 清单勾选 + 性能数字（首屏/tab/轮询）

### P5 发布（0.5 天）
- [ ] README 截图与使用说明、变更日志、版本 0.2.0
- [ ] （可选）`main` 洞察页复用组件
- **交付**：GitHub release + 文档

---

## 9. 交付物清单

| 类型 | 文件/产物 |
|---|---|
| 设计 | 本文档、组件 token 表（线框 PNG 已移除，避免泄露真实候选信息） |
| 代码 | `lib/client.js`（UI）、`lib/ui/*` 组件、`lib/index.js` 新路由、`lib/data.js` 只读聚合 |
| 测试 | `test/ui-contract.test.mjs`、`test/boot-verify.sh` 增断言、UI 手工验收清单 |
| 证据 | 启动日志（0 未激活）、浅/深色截图、交互步骤截图、性能数字 |
| 发布 | README 更新、release notes、版本号 |

---

## 10. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| client inject 写错导致 web 启动挂起（历史事故） | 中 | P0 门禁：boot manifest 对照 + `did not activate` 断言 + 最小 inject + 挂起即回滚 |
| 浏览器渲染无法自动化验证 | 高 | 交付前必须真实重启并截图；否则标注"未验证" |
| 大 payload / 轮询压力 | 低 | 响应上限 + 缓存 + 可见性暂停 |
| UI 写操作误触 | 中 | 二次确认 + 服务端同源校验 + decisions 备份 + 失败回滚 |
| HMR 不可用需重启 | 高 | 文档写明；开发用 `pnpm run dev:web` 才热更新 |

---

## 11. 待拍板（影响范围）

1. 入口范围：**只要右侧面板** / **右侧面板 + 侧边栏条目**（推荐）/ 再加一级「洞察页」。
2. 写操作范围：只读（先看） / + 采纳候选 / + 运行流水线（推荐全部，带确认）。
3. 首个版本范围：MVP=概览+候选只读（P0–P3 精简）还是完整五 tab（推荐）。


---

## 12. 实施状态（2026-11-11）

| 项 | 状态 |
|---|---|
| P0 client 安全门 | ✅ `preflight` 断言 inject ∈ 白名单、ModuleLoader 包装、语法检查 |
| P1 数据端点 | ✅ `/ui/{overview,metrics,candidates,findings,history,job}` + `/ui/run`；`ui-contract.test.mjs` 全绿 |
| P2 UI 骨架 | ✅ 入口 + 右侧面板 + 五 Tab + 图表 + 三态（待重启目视验收） |
| P3 核心交互 | ✅ 候选筛选/搜索/展开/采纳确认、job 轮询、历史/画像/重复 |
| P4 打磨 | ⏳ 键盘/aria/i18n/偏好卡 |
| P5 发布 | ⏳ release + 截图 |


## 13. Client 半事故复盘（2026-11-12）

- **现象**：重启后 `web boot: 1 entry did not activate — dsh-weekly-retro: import failed: exports is not defined`。
- **根因**：client 入口 factory 里漏了 `var module = { exports: {} }; var exports = module.exports;`，`node --check` 只查语法，查不出"运行到才炸"。
- **修复**：补声明；factory 整体 try/catch 兜底（初始化失败降级为空实现，不阻塞 web 启动）。
- **流程升级（硬门禁）**：
  1. client 半必须通过 `test/client-runtime.test.mjs`（执行 factory、断言导出、stub slot 注册）；
  2. 必须验证 `inject` 在宿主 boot manifest 白名单内；
  3. 安装后重启，grep 启动日志不得出现 `dsh-weekly-retro.*import failed|did not activate`；
  4. 任何一条不通过，不装回 profile。


## 14. 真实浏览器验收（2026-11-12，Playwright）

用隔离 `DSH_HOME` + `dsh --profile web` 起真实服务，Playwright Chromium 打开带 token 的 URL，逐项断言。已修复的三个真实故障：

1. `import failed: exports is not defined` → factory 内必须声明 `var module = { exports: {} }; var exports = module.exports;`。
2. `pending (waiting for service: @deepseek-ai/dsh-client-ui-sidebar-right)` → **client 导出的 `inject` 必须是短服务名 `['slots']`**；`package.json` 的 `dsh.client.inject` 只影响宿主排序，不能替代模块导出。
3. `layout.selectPanel: main panel "weekly-retro" is not registered` → `sidebar.panellist` 点击默认调用 `layout.selectPanel(id)`，必须同时注册同 id 的 `main` 面板。

最终验收（真实浏览器）：`tabsSeen=[概览,画像,重复,候选,历史]`、`svgCount=24`、`pageErrors=[]`、侧栏出现「周报」。

### 硬门禁（新增，缺一不装）

```bash
node test/client-runtime.test.mjs     # factory 真执行 + 导出/slot 断言（inject 必须 ['slots']，4 个 slot）
node test/preflight.test.mjs
node test/host.test.mjs && node test/ui-contract.test.mjs
node test/robustness.test.mjs && node test/land-concurrency.test.mjs
DSH_NO_PATCH=1 DSH_VERIFY_PORT=62340 bash test/boot-verify.sh
# 真实浏览器（需 npx playwright install chromium）
DSH_HOME=<隔离目录> dsh --profile web --no-open --port 62332  → Playwright 打开 token URL
#   断言：无 "did not activate/import failed"，侧栏含「周报」，点开后 5 Tab + SVG>20，pageErrors 为空
```


## 15. 重启后自查（2026-11-12 11:2x）

真实 App 重启后：最新 crash 日志停在 10:43（本次启动无新崩溃）、`weekly_status` 工具正常、12 条路由全部 200（1–2ms）、隔离真实启动 PASS、真实浏览器五 Tab/24 SVG/pageErrors=0。

自查发现并修复的 4 个风险：

| 风险 | 证据 | 修复 |
|---|---|---|
| `/report?week=` 路径穿越（`../../etc/passwd`） | 可读到任意 `.html` 路径 | week 白名单 `^\d{4}-W\d{2}$`，非法 400 |
| 配了 `DSH_WEEKLY_TOKEN` 会把自己面板锁死 | `mutatingAllowed` 先判 token | token 只作外部附加通道，同源始终放行 |
| JSON/HTML 无缓存与嗅探头 | `curl -I` 无 `Cache-Control` | `no-store` + `nosniff` + `no-referrer` |
| 运行中卸载面板，轮询定时器泄漏 | `setInterval` 无 unmount 清理 | `pollTimer` ref + unmount clear |

验证：路径穿越 400、正常 week 200、响应头齐全、五 Tab 仍全绿。
注意：host 侧加固需再重启一次生效（client 已生效）。


## 16. P4/P5 收口（v0.2.0，2026-11-12）

| 缺口 | 交付 | 验收证据 |
|---|---|---|
| SVG 图表可访问性 | 6 类图表全部 `role="img"` + 摘要 `aria-label`；Tab 具备 `tablist/tab/tabpanel` + `aria-selected` | 真实浏览器：`roleImgs=6`、`tabs` 语义正确、`pageErrors=[]` |
| 文案 locale | 客户端 `inject=['slots','locale']`；优先宿主 `locale.t`，回退浏览器语言内置中/英 | `zh-CN` 显示「概览/画像/…」，`en-US` 显示「Overview/Portrait/…」 |
| 双入口收敛 | 删除 `sidebar.right.pane.tab(.title)` 注册，只保留 `main` + `sidebar.panellist` | `client-runtime` slots=2；`preflight` 断言不得再出现右侧 pane tab |
| README / P5 洞察页 | README v0.2.0 + 5 张真实截图；`MainPanel` 曾增加「本周洞察」hero（B1 已移除，合并到单层 header） | `docs/screenshots/{overview,portrait,repeats,candidates,history}.png`；主面板渲染 hero |

版本：`package.json` → `0.2.0`。新增回归门：preflight 校验 `role="img"`、`tablist/aria-selected`、单一入口、`locale` 注入。


## 17. v0.2.1：语言与点击修复（2026-11-12 13:xx）

真实桌面端反馈：侧栏显示 `Weekly Retro`（系统中文）、条目点不动。

| 症状 | 根因 | 修复 |
|---|---|---|
| 中文系统显示英文 | 语言取 `navigator.language`（桌面 Chromium 为 `en-US`），而宿主 UI 语言在 `document.documentElement.lang`（`zh-CN`） | `detectLang()` 优先 `html[lang]`；并接入宿主 `ctx.locale.register(NS, {zh,en})` + `ctx.locale.bind(NS)`，随宿主语言实时翻译 |
| 条目无法点击 | Entry 是纯 `div`，完全依赖宿主包装点击；桌面端未生效 | Entry 改为原生 `<button>`，自带 `onClick → ctx.layout.selectPanel('weekly-retro')`，并保留宿主包装兜底 |

真实浏览器验收：条目文本 `周报`、原生鼠标点击打开面板、原生点击「画像」Tab 切换成功（`aria-selected=true`）、`pageErrors=[]`、`roleImgs=6`。


## 18. v0.2.2：侧栏条目尺寸 + 图标候选（2026-11-12 14:xx）

真实桌面端反馈：左侧「周报」条目比其它插件大。

**根因**：`sidebar.panellist` 的组件在宿主里是**行内图标（glyph）**，宿主已提供 36px 标准行、label 文字与点击；我们却把整张卡片（边框+副标题+徽标+内层按钮）塞进 glyph，行高被撑到 57px，文字重复。

**修复**：Entry 改为纯 24×24 线性 SVG（接收宿主 `size`，实际 16px），文字交给宿主 `label`；不再嵌套 button。

验收（隔离真实浏览器）：`周报` 行高 **36px** = `插件` 行高；glyph **16×16**；页面仅 1 个「周报」条目；原生点击打开面板、5 Tab 正常、`pageErrors=[]`。

图标候选：`assets/icon-candidates/`（6 个 SVG + `preview.png`）；当前默认 `weekly-loop`。


## 19. v0.3.0：六智能体交付（2026-11-12 14:xx）

按「每点 2 个子智能体：实现 + 独立审查」串行完成，审查者不采信实现者自证。

| 点 | 实现 | 独立审查 | 结果 |
|---|---|---|---|
| P1 滚动 | scroll-dev | scroll-review | body 677×1154、wheel scrollTop +477、滚动条 8px 可见、高度链 host 900 |
| P2 提示 | help-dev | help-review | hover 10/10、focus 9/9、aria/title、零遮挡；5 Tab/4 按钮/运行标题全覆盖 |
| P3 视觉+图表 | feat-auditor | adv-tester | 8 色 token + 60-30-10、4 类新图、概览 roleImgs=10；复审抓出对比度 1.15–4.33 后返修，22 目标全 ≥4.5（worst 5.17） |

Lead 终验（独立）：侧栏行 36px/图标 16px；面板 body 690×2088、wheel scrollTop 600；5 Tab；roleImgs=10；tooltip 文案正确；无横向溢出；pageErrors=[]；6 套测试 + boot-verify PASS。

已知遗留（P2，不阻断）：浅色下旧组件次级文字 contrast 3.51–4.17（inactive Tab、Donut 图例、25KB、Area 轴、Gauge 说明），下轮单独 task 提亮。

图标：采用 `weekly-loop`（`assets/icon-candidates/weekly-loop.svg`），侧栏 16px 线性图标。


## 20. v0.3.1：次级文字对比度全量收口（2026-11-12 15:xx）

P4 先修 5 类已知（inactive Tab / Donut 中心 / 25KB / StackedArea 轴 / Gauge 说明），P4b 再按“修一类不修一条”扫掉同模式 10 处（Histogram 分桶轴、LineChart 周轴、Radar 空态、画像证据、候选箭头、维度标签、已跳过、搜索空态、只有 N 周、暂无采纳）。

独立审查（adv-tester，两主题 × 8 场景，16 次采集）：10/10 类 ≥4.5，最差浅色 **6.44**；插件内全文本 TreeWalker 扫描 `<4.5 = 0`。仅剩宿主 UI 侧栏「工作区」3.55，不属插件范围。

回归：5 Tab、roleImgs=10、滚动、tooltip、hover、空数据、1440/1100/900 无溢出、pageErrors=[]、6 套测试、boot-verify 全过。版本 0.3.1。
