# Weekly Retro（DSH 周报复盘）

> **唯一权威来源就是插件包内本文件。** 旧用户技能目录里的副本只作迁移期备份；两者冲突时以本文件为准，不要从旧副本恢复流程。

## 何时用

- 用户说「跑周报 / 周复盘 / 看看这周学了什么 / 有什么可以优化」
- 每周日 22:00 定时任务已经自动采集过（只采集，不调模型），用户来问结果时
- 用户想把手头重复劳动沉淀成技能、规则或插件之前

## 工具与数据

本流程只使用插件工具；**不要直接调用旧脚本，也不要假设本机 `scripts/` 目录存在。**

| 工具 / 位置 | 用途 |
|---|---|
| `weekly_status` | 读本周概要、候选、趋势、报告和 packet 的新鲜度；只读 |
| `weekly_run({mode:'full'})` | 采集 → 分析包 → 报告；确定性流水线，不调模型 |
| `weekly_run({mode:'report'})` | 只重跑报告，把已有 findings 灌进 md/html |
| `weekly_guide({topic:'packet'})` | 读分析包（最多 20k 字符，超出会标 `truncated`） |
| `weekly_guide({topic:'findings-template'})` | 读 findings 模板 |
| `weekly_guide({topic:'plugin-criteria'})` | 读技能/规则/插件/定时/watcher 判据 |
| `weekly_validate` | 校验 findings；`list:true` 时列本周真实会话 id |
| `weekly_land({key,note,sync})` | 写 decisions 并触发落地同步 |
| `~/.dsh/learning/weekly/` | 周报数据目录：digest、packet、报告、findings、proposals、decisions、history |

`packet` 里有每会话的**用户诉求**、**轮次骨架**、**命令聚合**、**写入产物**、**上下文信号**；没有 assistant 正文、工具输出和文件内容。**看不到 ≠ 没发生**，证据不足就写「证据不足」。

## 步骤

### 1. 先看有没有新数据

调用 `weekly_status`。若没有报告、packet 缺失，或报告超过 7 天：

```text
weekly_run({ mode: 'full' })
```

它会产出 digest → packet → md/html。

- **0 会话 fail-closed**：不会把上一份好报告覆盖成空壳；工具返回失败就停，不要手工补空数据。
- **单实例锁**：同一 learning 目录并发跑第二个会失败；等前一个结束，不要绕过锁。
- **回填模式**：`weekly_run({ mode:'full', windowEnd:'2026-11-08T22:00:00+08:00' })` 只写对应周，不动最新周。
- 采集失败、超时、没有新数据时，如实报告；不要用旧报告假装本周结果。

### 2. 读分析包

```text
weekly_guide({ topic: 'packet' })
```

只读返回的 `content`，不要直接读 digest 全文。若 `truncated=true`：

- 先基于已返回部分分析，并明确告诉用户「分析包被截断」；
- 需要完整上下文时，用返回的 `path`（已脱敏为 `~` 路径）读取文件；
- 不要把截断当成完整证据。

### 3. 写 findings

先取模板：

```text
weekly_guide({ topic: 'findings-template' })
```

把模板内容写到 `~/.dsh/learning/weekly/findings.json`（用当前可用的文件写入工具；不要写进报告正文）。三块：

- `portrait[]`：本周 3–5 条主线（目标 / 产出 / 依据会话 id / 哪一步最费劲）
- `repeats[]`：重复劳动（pattern / 次数 / 每次成本 / 建议形态 / 依据会话）
- `candidates[]`：≤6 条，每条必须带 `evidenceSessions`（真实会话 id）与四项评分

会话 id 从 packet 元信息复制，或调用：

```text
weekly_validate({ list: true })
```

不要编造会话 id；找不到证据就删掉该条，不要凑数。

### 4. 校验（不通过不许往下走）

```text
weekly_validate()
```

不通过就按报错改，别绕过去。报告环节遇到坏 findings 会回退旧规则，并在周报里写明原因，等于这周白分析。

### 5. 重跑报告

```text
weekly_run({ mode: 'report' })
```

有 findings 时 md/html 会多出「工作流画像」「重复劳动清单」，候选按技能/规则/插件分组。重跑失败就报告失败，不要手写 `<ISO周>.md`——报告每次都会被整文件重写。

### 6. 向用户汇报（中文，≤15 行）

- 本周覆盖几个工作区 / 多少会话 / 主要做了什么（按**主线**说，不要罗列工具名）
- 画像 3–5 条：每条一句话讲清「在做什么、产出什么」
- 重复劳动：出现次数 + 每次成本 + 判断该固化成什么
- 纠偏信号：最多 3 条
- 候选：按下面的「汇报格式」逐个讲
- **上下文信号**：哪几个会话被压缩过（撑爆上下文＝长任务/返工），哪些是跨周会话（只能看到本周部分）

### 7. 征求确认

明确问「哪几条要落地？」不要擅自创建技能、插件或改 AGENTS.md。

### 8. 落地（用户确认后）——落地与同步是一个动作

- 技能：`~/.dsh/skills/<name>/SKILL.md`（name 与目录一致，description 写清「做什么 + 何时用」）
- 规则：把纠偏点写成 AGENTS.md 里一条可执行规则
- 插件：先调用 `weekly_guide({topic:'plugin-criteria'})` 确认形态，写最小范围（注册什么、是否常驻、最小验证）再动手
- 周报数据（weekly/ 下的 md/html/digest/proposals/findings/decisions）**不进仓库**
- 落地后调用：

```text
weekly_land({ key: '<候选 key>', note: '<一句话备注>', sync: true })
```

返回 `synced=true` 且有 commit 才能说「已同步」；返回 `已落地但未同步` 或 `synced=false` 时，必须原样告诉用户「已落地但未同步」并附错误摘要。**不许把未同步说成已同步。**

### 9. 记录

不要手写周报 md，也不要手工维护 decisions。`weekly_land` 会写 `~/.dsh/learning/weekly/decisions.json`，字段为 `week / key / candidate / verdict / where / note`。报告第 8 节自动渲染。

## 自成长：跨周记忆与技能遥测

周报不再每周从零重算：

| 资产 | 位置 | 作用 |
|---|---|---|
| `history.jsonl` | `~/.dsh/learning/weekly/`；脱敏副本可同步到 `dsh-config/weekly/history.jsonl` | 每周一条：主会话/轮次/纠偏数、画像主线、重复模式、候选与判定、技能使用与失败 |
| packet 的「跨周趋势」块 | 由流水线注入 | 告诉模型哪些模式出现过、哪些候选已提过 |

**分析时的硬规则**

1. 先看 packet 的「跨周趋势」：出现过的候选不要重复推荐；要提就写清「这周多出的证据」。
2. 重复模式复现时，在 `repeats` 里**沿用同一个 `key`**，系统才能把两周串起来。
3. 报告里的 `🔁 第 N 周出现` 只标注、不改分级；是否提级由用户拍板。
4. 不要手改 `history.jsonl`；它由报告流程按周覆盖。

**技能遥测**：`weekly_status.skills` 给出本周哪些技能被调用、失败几次、技能库总数。用途是修反复失败的技能、评估新技能有没有人用；**不要拿「从未使用」直接删技能**，可能只是没遇到场景。候选仍以 findings 为准，工具只提供信号，不替模型下结论。

## 分析环节的硬约束（会被 `weekly_validate` 校验）

- `week` 必须等于 digest 当前周（写错=分析过期，报告拒收）
- 每个候选的 `evidenceSessions` 必须是本周 digest 里真实存在的会话 id（防编造）
- 候选 ≤6 条；超过直接判不合法
- 四项评分各 0–2；`total` 由脚本重算，别自报
- 判 `plugin` 必须带 `plugin_spec.trigger ∈ {bundle-patch, tool, client-ui, mcp}`，并写 `persist`
- 形态判据（技能 vs 规则 vs 插件 vs 定时/watcher）以 `weekly_guide({topic:'plugin-criteria'})` 为准；**默认按需触发，不推荐常驻**
- `portrait` / `repeats` 也校验结构：`mainline` 必须是字符串，`outputs`/`sessions`/`evidence` 必须是数组且会话 id 真实，`repeats[].count` 必须是数字
- `verdict=plugin` 必须给 `plugin_spec.persist`（布尔）；`verdict=rule` 要求 `capability=0`；`shape` 与 `verdict` 不得互相矛盾
- `decisions.json` 每条尽量带 `key`（与 findings 的 key 一致），否则去重只能靠后缀模糊匹配
- `weekly_run` 的 packet **严格**不超过预算（含尺寸行与硬截断说明）；返回 `truncated` 时按步骤 2 处理

## 调度（跨平台）

定时任务由现有系统调度器安装和运行；本插件只保证确定性入口，**不手改 launchd plist 或 schtasks**。

- 定时任务**只做确定性采集**（collect → condense → report/html），**不调模型**；分析（步骤 2–5）在用户来问时由会话完成，一周一次。
- 调度命令、时间、跨平台实现属于部署层，不在本技能里硬编码；需要改调度时按当前系统的安装方式处理，并保留「采集不调模型」的边界。
- 依赖：node + zstd（多帧 zstd 必需）。
- 需要自检时用 `weekly_run({mode:'full', withSelftest:true})`；自检失败只写日志并标记退出码，不阻断已生成的报告。

## 原则

- 只根据 packet / 工具返回的真实数据下结论；数据不足就直说，不要编造「本周学到」。
- 候选必须可复用（明确触发词与输入输出），不要提议「提高效率」这类空话。
- 周报是给人看的：先结论、后证据。
- 不把会话原文贴进周报（隐私）；只引用用户短句且必要时脱敏。
- 没 findings 时周报保持旧样式（研究/统计版）；有 findings 才多出画像与重复清单两节——别为了「看起来新」而硬凑。

## 汇报格式（按候选逐个讲，不许只念标题）

每个候选必须讲四件事：

1. **它具体是干什么的** —— 用大白话描述这条流程从头到尾做什么
2. **本周依据** —— 数字 + 具体目录/文件/会话（来自 `evidenceSessions` 与 evidence）
3. **落地形态** —— 输入是什么、输出是什么、中间几步；插件还要说**是否常驻**、最小范围
4. **成色判断** —— `verdict`（skill / skill-lite / rule / plugin / schedule / watcher / skip）、`total`（0–8）和理由

成色评分四项各 0–2：频率 / 触发可预测 / 是否新增能力 / 可否自动验收。

判定规则（`weekly_guide({topic:'plugin-criteria'})` 是判据来源；工具只校验「形态与分数是否自洽」，不替你判定）：

- 纯纪律型（`capability=0`）→ **规则**，写进 AGENTS.md
- 总分 ≥6 且有触发词 → **技能**
- 总分 ≥5 → 轻量技能
- 需要确定性工具入口 / 跨会话状态 / UI / 原生能力 → **插件**（按需触发优先）
- 需要按时间自动跑 → **定时任务**；需要监听外部事件 → **watcher**（常驻成本高，默认不建议）

汇报时明确告诉用户「哪些该做技能、哪些该写规则、哪些只该观察、为什么」，再问采纳哪些。

## 落地即同步（硬规则）

用户采纳候选后：

1. 创建技能 / 更新 AGENTS.md / 写插件
2. 调用 `weekly_land({key, note, sync:true})`，不要再调用旧同步脚本
3. 确认返回里有 `synced=true` 与远端 commit
4. 若返回「已落地但未同步」，在回复里明确写「已落地但未同步」+ 错误摘要；下次会话先补同步
5. 不把未同步说成已同步；不伪造 commit

例外：用户明确说「这次不同步」才跳过，并要说明原因。
