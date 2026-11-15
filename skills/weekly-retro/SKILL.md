# Weekly Retro（DSH 周报复盘）

## 何时用

- 用户说「跑周报 / 周复盘 / 看看这周学了什么 / 有什么可以优化」
- 每周日 22:00 定时任务已经自动采集过（只采集，不调模型），用户来问结果时
- 用户想把手头重复劳动沉淀成技能、规则或插件之前

## 数据在哪

| 文件 | 内容 |
|---|---|
| `~/.dsh/learning/weekly/digest.json` | 原始采集（schema 3）：会话/轮/步、工具、命令聚类、写入产物、上下文信号（模型、压缩次数、窗口外轮次、按天事件） |
| `~/.dsh/learning/weekly/packet.md` | **分析包**：给模型读的压缩上下文（≤20k 字符，含每会话诉求/轮骨架/命令/产物，不含 assistant 正文） |
| `~/.dsh/learning/weekly/<ISO周>.md` / `latest.md` | 确定性周报（统计 + 纠偏信号 + 候选） |
| `~/.dsh/learning/weekly/latest.html` | 可视化周报（勾选候选可复制采纳指令；有 findings 时多出画像/重复清单/分组） |
| `~/.dsh/learning/weekly/proposals.json` | 机器可读候选（有 findings 时还带 portrait / repeats） |
| `~/.dsh/learning/weekly/findings.json` | **分析产物**：你写的画像 / 重复清单 / 候选（格式见 `findings.template.json`） |
| `~/.dsh/learning/scripts/` | `collect.mjs` `condense.mjs` `report.mjs` `report-html.mjs` `check-findings.mjs` `findings-lib.mjs` `history.mjs` `selftest.sh` `PLUGIN-CRITERIA.md` |
| `~/.dsh/learning/logs/` | 每次运行的日志 |

## 步骤

1. **先看有没有新数据**：`ls -lt ~/.dsh/learning/weekly/ | head`。若 latest.md 超过 7 天或没有，先跑一次（确定性流水线，不调模型）：
   ```bash
   bash ~/.dsh/learning/scripts/run-weekly.sh
   ```
   它会依次产出 digest → packet → md/html。
   - **0 会话会 fail-closed**（exit 2）：不会把上一份好报告覆盖成空壳；
   - **单实例锁**：同一 learning 目录并发跑第二个会 exit 3；
   - **回填模式**：`DSH_WINDOW_END=2026-11-08T22:00:00+08:00 bash run-weekly.sh` 只写 `<周>.md/html/packet`，不动 `latest.*` 与 `packet.md`。

2. **读分析包（不要直接读 digest 全文）**：读 `~/.dsh/learning/weekly/packet.md`。
   - 包里有：每会话的**用户诉求**、**每轮工具骨架**、**命令聚类**、**写入产物**、**上下文信号**（步数/模型/压缩次数/窗口外历史）
   - 包里**没有**：assistant 正文、工具输出、文件内容，以及**窗口外历史**（`preWindowTurns > 0` 的会话只含本周部分）
   - 所以：**看不到 ≠ 没发生**；证据不足就写「证据不足」，不要补全成故事

3. **写 findings.json**（这是本技能唯一需要模型产出的东西）：
   ```bash
   cp ~/.dsh/learning/scripts/findings.template.json ~/.dsh/learning/weekly/findings.json
   ```
   然后用 `Write` 覆盖成真实内容。三块：
   - `portrait[]`：本周 3-5 条主线（目标 / 产出 / 依据会话 id / 哪一步最费劲）
   - `repeats[]`：重复劳动（pattern / 次数 / 每次成本 / 建议形态 script|skill|rule|plugin / 依据会话）
   - `candidates[]`：≤6 条，每条必须带 `evidenceSessions`（真实会话 id）与四项评分

   会话 id 从 packet 的「元信息」行复制，或用：
   ```bash
   node ~/.dsh/learning/scripts/check-findings.mjs --list
   ```

4. **校验（不通过不许往下走）**：
   ```bash
   node ~/.dsh/learning/scripts/check-findings.mjs
   ```
   不通过就按报错改，别绕过去——报告环节遇到坏 findings 会回退旧规则并在周报里写明原因，等于这周白分析。

5. **重跑报告，把分析灌进周报**：
   ```bash
   cd ~/.dsh/learning/scripts && node report.mjs && node report-html.mjs
   ```
   有 findings 时 md/html 会多出「工作流画像」「重复劳动清单」，候选按技能/规则/插件分组。

6. **向用户汇报**（中文，控制在 15 行内）：
   - 本周覆盖几个工作区 / 多少会话 / 主要做了什么（按**主线**说，不要罗列工具名）
   - 画像 3-5 条：每条一句话讲清「在做什么、产出什么」
   - 重复劳动：出现次数 + 每次成本 + 你判断该固化成什么
   - 纠偏信号：最多 3 条
   - 候选：按下面的「汇报格式」逐个讲
   - **上下文信号**：哪几个会话被压缩过（撑爆上下文＝长任务/返工），哪些是跨周会话（只能看到本周部分）

7. **征求确认**：明确问「哪几条要落地？」不要擅自创建技能、插件或改 AGENTS.md。

8. **落地**（用户确认后）——落地与同步是一个动作：
   - 技能：`~/.dsh/skills/<name>/SKILL.md`（name 与目录一致，description 写清"做什么 + 何时用"）
   - 规则：把纠偏点写成 AGENTS.md 里一条可执行规则
   - 插件：按 `~/.dsh/learning/scripts/PLUGIN-CRITERIA.md` 的判据确认形态，先写最小范围（注册什么、是否常驻），再动手
   - 同步：
     ```bash
     bash ~/.dsh/learning/scripts/land-sync.sh "落地 <技能名>（<ISO周> 周报采纳）"
     ```
     推送成功把 commit 短哈希写进 `~/.dsh/learning/weekly/decisions.json` 的 `where`（同时写 `key`，与 findings 的 key 保持一致，否则下次去重匹配不上）
   - 周报数据（learning/ 下的 md/html/digest/proposals/findings/decisions）**不进仓库**

9. **记录**：不用手写 `<ISO周>.md`——它每次报告都被整文件重写，手写内容必丢。落地情况一律写进 `~/.dsh/learning/weekly/decisions.json`（报告第 8 节自动渲染），字段：`week / key / candidate / verdict / where / note`。

## 自成长：跨周记忆与技能遥测（观察期，先本地）

周报不再每周从零重算，有两块记忆让它越跑越准：

| 资产 | 位置 | 作用 |
|---|---|---|
| `history.jsonl` | canonical 在 `~/.dsh/learning/weekly/`；**脱敏副本进仓库** `dsh-config/weekly/history.jsonl`（同步前跑 `history-merge.mjs`，换机首次运行自动播种） | 每周一条：主会话/轮次/纠偏数、画像主线、重复模式（带 key）、候选与判定、技能使用与失败 |
| packet 的「跨周趋势」块 | 由 `condense.mjs` 自动注入 | 告诉模型：哪些重复模式在更早的周出现过、哪些候选已经提过（别当新发现） |

**分析时的用法（硬规则）**
1. 先看 packet 的「跨周趋势」：出现过的候选 = 不要重复推荐；要提就写清"这周多出的证据"。
2. 重复模式复现时，在 `repeats` 里**沿用同一个 `key`**（模板里有这个字段），系统才能把两周串起来。
3. 报告里会自动标 `🔁 第 N 周出现`（只标注，**不改分级**；是否提级由用户拍板）。
4. **不要手改 `history.jsonl`**：它由 `report.mjs` 幂等写入（同一周覆盖）。

**技能遥测（digest schema 3 起）**
- `skillsCalled` / `skillFails`：本周哪些技能真被调用、失败几次；`skillLibraryCount` 是技能库总数。
- 用途：修"反复失败"的技能、评估"新技能有没有人用"；**不要拿"从未使用"直接删技能**（可能只是没遇到场景）。
- 候选生成仍以 findings 为准，脚本只提供信号，不替模型下结论。

**采纳率回归（观察期后再做）**
- 需要 `decisions.json`（是否采纳）× 后续周的使用记录，才能回测 4 维评分准不准；两周数据后接第二刀。
- 明确不做：让周报自动改 SKILL.md / 自动调阈值（无外部闸门的自修改会把误判固化成长期行为）。

## 分析环节的硬约束（会被脚本校验）

- `week` 必须等于 digest 当前周（写错=分析过期，报告拒收）
- 每个候选的 `evidenceSessions` 必须是本周 digest 里真实存在的会话 id（防编造）
- 候选 ≤6 条；超过直接判不合法
- 四项评分各 0-2；`total` 由脚本重算，别自报
- 判 `plugin` 必须带 `plugin_spec.trigger ∈ {bundle-patch, tool, client-ui, mcp}`，并写 `persist`
- 形态判据（技能 vs 规则 vs 插件 vs 定时/watcher）见 `PLUGIN-CRITERIA.md`；**默认按需触发，不推荐常驻**
- `portrait` / `repeats` 也校验结构：`mainline` 必须是字符串、`outputs`/`sessions`/`evidence` 必须是数组且会话 id 真实、`repeats[].count` 必须是数字
- `verdict=plugin` 必须给 `plugin_spec.persist`（布尔）；`verdict=rule` 要求 `capability=0`；`shape` 与 `verdict` 不得互相矛盾
- `decisions.json` 每条尽量带 `key`（与 findings 的 key 一致），否则去重只能靠后缀模糊匹配
- `--budget` 必须 ≥1000 的数字；packet **严格**不超过预算（含尺寸行与硬截断说明）

## 调度（跨平台）

定时任务由仓库的 `scripts/schedule.sh` 安装，不要手改 launchd plist 或 schtasks：

```bash
cd ~/dsh-config && ./scripts/schedule.sh            # 默认 每周日 22:00
./scripts/schedule.sh --time 21:30 --days 14       # 改时间/窗口
./scripts/schedule.sh --status                     # 装了没
./scripts/schedule.sh --run-now                    # 立刻跑一次
./scripts/schedule.sh --uninstall
```

- 定时任务**只做确定性采集**（collect → condense → report/html），**不调模型**；分析（步骤 2-5）在用户来问时由会话完成，一周一次。
- macOS → launchd `com.dreamania.dsh.weekly-retro`；Windows → 任务计划程序 `DSH-WeeklyRetro`（跑 `scripts\win\weekly.cmd`）；Linux → 打印 cron 行。
- 依赖：node + zstd（多帧 zstd 必需）。
- 隔离试跑：`DSH_LEARNING=/tmp/t DSH_WEEKLY_DAYS=7 bash ~/.dsh/learning/scripts/run-weekly.sh`。
- **改完先自检**：`bash ~/.dsh/learning/scripts/selftest.sh`（32 项，全部在临时目录跑，不碰生产数据；不过就别提交）。定时任务收尾也会自动跑一次（`DSH_NO_SELFTEST=1` 可跳过），失败只写日志并用退出码 4 标出，不阻断已生成的周报。

## 原则

- 只根据 digest / packet 里真实存在的数据下结论；数据不足就直说，不要编造"本周学到"。
- 候选必须可复用（明确触发词与输入输出），不要提议"提高效率"这类空话。
- 周报是给人看的：先结论、后证据。
- 不把会话原文贴进周报（隐私）；只引用用户短句且必要时脱敏。
- 没 findings 时周报保持旧样式（研究/统计版）；有 findings 才多出画像与重复清单两节——别为了"看起来新"而硬凑。

## 汇报格式（按候选逐个讲，不许只念标题）

每个候选必须讲四件事：
1. **它具体是干什么的** —— 用大白话描述这条流程从头到尾做什么
2. **本周依据** —— 数字 + 具体目录/文件/会话（来自 `evidenceSessions` 与 evidence）
3. **落地形态** —— 输入是什么、输出是什么、中间几步；插件还要说**是否常驻**、最小范围
4. **成色判断** —— `verdict`（skill / skill-lite / rule / plugin / schedule / watcher / skip）、`total`（0-8）和理由

成色评分四项各 0-2：频率 / 触发可预测 / 是否新增能力 / 可否自动验收。
判定规则（`PLUGIN-CRITERIA.md` 是判据来源；脚本只校验「形态与分数是否自洽」，不替你判定）：
- 纯纪律型（capability=0）→ **规则**，写进 AGENTS.md
- 总分 ≥6 且有触发词 → **技能**
- 总分 ≥5 → 轻量技能
- 需要确定性工具入口 / 跨会话状态 / UI / 原生能力 → **插件**（按需触发优先）
- 需要按时间自动跑 → **定时任务**；需要监听外部事件 → **watcher**（常驻成本高，默认不建议）

汇报时明确告诉用户「哪些该做技能、哪些该写规则、哪些只该观察、为什么」，再问采纳哪些。

## 落地即同步（硬规则）

用户采纳候选后：
1. 创建技能 / 更新 AGENTS.md / 写插件
2. 跑 `bash ~/.dsh/learning/scripts/land-sync.sh "落地 <名字>（<ISO周> 周报采纳）"`
3. 确认输出里有「已推送」与远端 commit
4. 把 commit 短哈希写进 decisions.json

例外：用户明确说「这次不同步」才跳过，并要说明原因。