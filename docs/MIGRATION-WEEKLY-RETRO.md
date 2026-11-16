# Weekly-Retro → dsh-weekly-retro 规范迁移计划

> 状态：**Phase 0–3 代码路径通过，Phase 4 隔离预演通过；真实技能未移动、生产未切换、尚未删除任何技能**
> 目标版本：`dsh-weekly-retro@0.5.0`  
> 当前生产版本：`0.4.9`
> 本地预演包：`0.5.0-rc.1`（未发布）
> 迁移原则：**先等价、后切换、最后删除；任何一步验收不过就回滚。**
>
> 执行记录：Phase 0 基线见 [`migration-baseline.md`](migration-baseline.md)；Phase 1 的隔离 canary 为 `test/skill-canary.sh`，2026-11-16 实测 `skill=true · bytes=12194 · tools=4 · routes=13`（Phase 1 当时；Phase 2 后为 `bytes=11283 · tools=5`）。

### 执行状态

| 阶段 | 状态 | 证据 | 是否切换生产 |
|---|---|---|---|
| Phase 0 冻结与基线 | ✅ 完成 | `docs/migration-baseline.md`；备份可读；9/9 基线测试 | 否 |
| Phase 1 内置技能骨架 | ✅ 完成 | 10/10 测试；隔离 `DSH_HOME` canary PASS；npm tar 含 `skills/weekly-retro/SKILL.md` | 否 |
| Phase 2 分析桥与改写 | ✅ 完成 | 14/14 测试；`weekly_guide` 三 topic；9 步 E2E 通过 | 否 |
| Phase 3 等价性验收 | 🟡 代码路径通过 | 合成 9 步 E2E、真实 digest 冒烟、canary 均有记录；真实模型归纳质量待人工确认 | 否 |
| Phase 4 生产切换 | 🟡 隔离预演通过 | `0.5.0-rc.1` 隔离 profile：no-user / with-user / moved 三种模式均 `tools=5 · routes=13`；真实技能未移动 | 否 |
| Phase 5 删除并同步 | ⬜ 未开始 | 等待真实切换确认；禁止提前删除 | 否 |

## 1. 目标与非目标

### 目标

最终只保留插件这一份实现，并满足：

1. 用户说「跑周报 / 周复盘 / 看看这周学了什么 / `/weekly-retro`」时，模型仍能加载完整的 9 步分析规范。
2. 画像、重复劳动、候选、校验、报告重跑、采纳落地、跨周记忆、汇报格式、隐私约束，全部有插件内对应物。
3. 删除本机 `~/.dsh/skills/weekly-retro/` 与仓库 `~/dsh-config/skills/weekly-retro/` 后，功能不降级。
4. 删除结果同步到 `dsh-config`，可用 git 历史恢复，不留下第二份“活”的技能副本。
5. 定时任务仍只跑确定性流水线，不因迁移改成常驻模型任务。

### 非目标

- 不重写已经稳定的 `collect → condense → report → html` 流水线。
- 不把模型分析变成定时自动执行；分析仍由用户触发，插件只提供入口、规范、校验和报告。
- 不把周报原文、会话内容、token、绝对路径打进 npm 包或仓库。
- 不在迁移期间改变现有报告的数据格式；`findings.json` 仍是分析产物。

## 2. 当前依赖审计

| 资产 | 当前位置 | 是否依赖技能 | 结论 |
|---|---|---|---|
| 模型分析规范 | `~/.dsh/skills/weekly-retro/SKILL.md` | 是 | 唯一需要迁移的“活”资产 |
| 仓库副本 | `~/dsh-config/skills/weekly-retro/SKILL.md` | 是 | 与上者内容一致，迁移后删除 |
| 定时任务 | launchd `com.dreamania.dsh.weekly-retro` → `~/.dsh/learning/scripts/run-weekly.sh` | **否** | 保持原样，不纳入删除范围 |
| 确定性脚本 | `~/.dsh/learning/scripts/*.mjs`、插件 `pipeline/` | 否 | 插件已有打包副本，继续复用 |
| 插件入口 | `/weekly` 命令 + 4 个工具 + 13 条路由 + 五 Tab UI | 否 | 作为迁移后的唯一入口扩展 |
| 分析产物 | `~/.dsh/learning/weekly/findings.json` | 否 | 路径不变，继续由模型写、插件校验 |
| 落地同步 | `land-sync.sh` / `weekly_land` | 否 | 工具已能触发；迁移后写进规范 |

### 关键事实

- 插件 README 已明确：**“周报归纳依赖模型分析环节；插件只跑确定性流水线，不做模型判断。”**
- Phase 2 插件工具：`weekly_guide`、`weekly_status`、`weekly_run`、`weekly_land`、`weekly_validate`。
- 当前插件没有注册任何技能，也没有 `skills` 注入；`package.json.files` 不含技能内容。
- DSH 的 `@deepseek-ai/dsh-skill` 提供运行时技能注册：
  - `ctx.skills.register(skill: SkillRegistration): () => void`
  - `SkillRegistration` 支持 `name`、`description`、`whenToUse`、`content`、`resourceBase`、`invocation`。
  - 结论：**插件可以自己拥有同名 `weekly-retro` 技能，不需要依赖 `~/.dsh/skills`。**

## 3. 目标架构

```text
dsh-weekly-retro/
├── lib/index.js                 # inject: ['tools','webServer','skills']
├── skills/weekly-retro/
│   ├── SKILL.md                 # 迁移后的完整 9 步规范（唯一权威）
│   └── references/
│       ├── findings.template.json
│       └── PLUGIN-CRITERIA.md
├── pipeline/                    # 原确定性脚本
├── docs/MIGRATION-WEEKLY-RETRO.md
└── package.json                 # files 增加 skills/
```

运行时注册伪代码：

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const skillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'weekly-retro');
const content = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

export const inject = ['tools', 'webServer', 'skills'];

export function apply(ctx) {
  ctx.skills.register({
    name: 'weekly-retro',
    description: '周报复盘：运行确定性流水线、读分析包、产出 findings、校验并生成画像/重复/候选。',
    whenToUse: '用户说「跑周报 / 周复盘 / 看看这周学了什么 / /weekly-retro」时。',
    content,
    resourceBase: { kind: 'directory', path: skillRoot },
    invocation: { modelInvocable: true, userInvocable: true },
  });
}
```

### 3.1 入口映射

| 触发 | 迁移后行为 |
|---|---|
| 用户说「跑周报 / 周复盘」 | 模型加载运行时 `weekly-retro` 技能，按 9 步执行 |
| `/weekly` | 保留现有插件命令：概要 / 全量跑 / 只重跑报告 |
| `/weekly-retro` | 若当前是用户侧命令，Phase 3 增加 command alias；若只是技能名，保留同名技能即可。**Phase 0 先确认它到底是哪一种入口，不能凭假设迁移。** |
| 定时任务 | 继续跑 `run-weekly.sh`，只采集和生成确定性报告 |

## 4. 9 步规范迁移矩阵

| 原技能步骤 | 原动作 | 插件内目标 | 迁移类型 | 验收 |
|---|---|---|---|---|
| 1. 新数据 | `ls -lt` / `run-weekly.sh` | `weekly_status` 判断新鲜度；`weekly_run(mode=full)` 采集 | 已有工具 + 规范改写 | 0 会话 fail-closed；回填模式保留 |
| 2. 读分析包 | 读 `packet.md` | **新增 `weekly_guide(topic='packet')`**，返回 packet 正文、路径、截断标记（≤20k） | 新增只读工具 | 截断可见；不返回 assistant 正文 |
| 3. 写 findings | 复制模板、写 `findings.json` | 规范内嵌模板 + `weekly_guide(topic='findings-template')`；模型用 write 写文件 | 规范 + 模板工具 | 模板字段完整；不覆盖损坏文件 |
| 4. 校验 | `check-findings.mjs` | `weekly_validate` | 已有工具 | 非法 week / 伪会话 / >6 候选全部拒绝 |
| 5. 重跑报告 | `report.mjs && report-html.mjs` | `weekly_run(mode='report')` | 已有工具 | 画像/重复/候选出现在 md/html |
| 6. 汇报 | 15 行内、先结论后证据 | 原规范全文迁入 SKILL.md | 规范 | 汇报仍含上下文信号与证据 |
| 7. 征求确认 | 问「哪几条要落地」 | 原规范全文迁入 SKILL.md | 规范 | 不擅自创建技能/插件 |
| 8. 落地 | 创建技能/规则/插件 + `land-sync.sh` | `weekly_land` 写 decisions + 同步；创建动作由模型按规范执行 | 已有工具 + 规范 | commit 或「已落地但未同步」必须如实返回 |
| 9. 记录 | `decisions.json` | `weekly_land` 写入 | 已有工具 | key/where/verdict 可回读 |

### 4.1 非步骤章节

| 原章节 | 处理 |
|---|---|
| 数据在哪 | 改为插件工具 + 数据目录说明，不再指向 `~/.dsh/learning/scripts` |
| 自成长 / 跨周记忆 | 保留；`weekly_status.trend`、`historyWeeks`、`packet` 跨周趋势块为数据源 |
| 技能遥测 | 保留说明；数据来自 `weekly_status.skills`，不新增采集 |
| 硬约束 | 全文保留，并补插件侧校验命令 |
| 调度 | 保留 launchd / Task Scheduler / cron 说明；明确不常驻 |
| 原则 | 全文保留；补“插件不替模型下结论” |
| 汇报格式 | 全文保留；补 `weekly_status` 候选字段来源 |
| 落地即同步 | 改为 `weekly_land(sync=true)`；保留“未同步必须明说” |

## 5. 分阶段执行

### Phase 0 — 冻结与基线（只读 + 备份）✅

> 2026-11-16 完成。基线快照见 [`migration-baseline.md`](migration-baseline.md)；备份位于 `~/dsh-config-backups/weekly-retro-pre-plugin-20261116-0011/`。

**做什么**

1. 记录当前版本、commit、`boot-verify`、全部测试结果、两份技能文件的 sha256。
2. 把两份技能目录备份到技能根目录之外：
   - `~/dsh-config-backups/weekly-retro-pre-plugin-<date>/`
3. 确认 `/weekly-retro` 的真实入口类型（技能名 / 用户命令 / 纯提示词）。
4. 记录当前一次真实周报的 `findings.json`、报告页、候选 key，作为行为对照。

**产出**：`docs/migration-baseline.md`（可并入本文件附录）。

**验收**

- 两份技能仍可用；备份可读；备份不在 `~/.dsh/skills` 或 `dsh-config/skills` 下。
- 基线命令全部有输出记录。

**回滚点**：无代码改动，无需回滚。

### Phase 1 — 插件内置技能骨架（不切换）✅

> 2026-11-16 完成：`skills/weekly-retro/SKILL.md` 已入包；`ctx.inject(['skills'])` 可选注册；10/10 测试、隔离 canary、npm tar 三项通过。生产入口仍未切换。

**做什么**

1. 新建 `skills/weekly-retro/SKILL.md`，先原样迁入，再改路径引用。
2. `lib/index.js` 增加 `skills` 注入和 `ctx.skills.register`。
3. `package.json.files` 增加 `skills`。
4. 新增 `test/skill-registration.test.mjs`：mock `ctx.skills.register`，断言 name/description/content 非空、resourceBase 存在。
5. 构建、`npm pack`，检查 tar 包确实含 `skills/weekly-retro/SKILL.md`。

**不做什么**

- 不删除任何现有技能。
- 不把生产入口切到运行时技能。
- 不改定时任务。

**验收**

- 测试通过；tar 包有技能文件；插件 boot 仍为 `tools=5 routes=13`。
- 隔离 `DSH_HOME`（不含用户技能）里，`skill` 目录出现 `weekly-retro`，source 为 `runtime`。
- 生产环境同名冲突行为被记录，不假设谁覆盖谁。

**Phase 1 实测记录（2026-11-16）**

- `node --test test/*.test.mjs`：**10/10 pass**。
- `bash test/skill-canary.sh`（无用户技能）：`skill=true · skillName=weekly-retro · tools=5 · routes=13`，无注册错误。
- `WITH_USER_SKILL=1 bash test/skill-canary.sh`（同名冲突）：runtime 注册仍成功、无报错。后续读 `@deepseek-ai/dsh-skill@0.0.1-rc.1` 源码确认：同一层 **runtime > user**；同名 runtime 先到先得；更近的 scoped 层优先。当前用户技能是全局 filesystem 提供者，理论上被 runtime 覆盖；preset-scoped 用户技能仍是 Phase 4 风险。
- `npm pack --dry-run --json`：35 files，含 `skills/weekly-retro/SKILL.md`；包体 833508 bytes。
- 生产 profile 未加载本阶段包；用户技能、定时任务均未动。

### Phase 2 — 分析桥与规范改写 ✅

**做什么**

1. 新增 `weekly_guide` 只读工具：
   - `topic='packet'`：返回 `packet.md`，上限 20k，带 `truncated` 与 path。
   - `topic='findings-template'`：返回包内模板。
   - `topic='plugin-criteria'`：返回包内判据。
2. 把 SKILL.md 的 9 步全部改写成插件工具调用；删除对 `~/.dsh/learning/scripts/*.mjs` 的直接依赖。
3. 保留以下原文语义，不得压缩掉：
   - 0 会话 fail-closed、单实例锁、回填模式
   - `findings` 的 week/evidence/≤6/评分硬约束
   - 汇报格式四件事、15 行限制
   - 落地即同步与失败口径
   - 隐私原则：不贴会话原文
4. 在 SKILL.md 顶部写明“唯一权威来源是插件包内此文件”。

**验收**

- 9 步逐步能在隔离数据上走通。
- `weekly_guide` 不返回原文正文、token、绝对路径（路径字段除外且可脱敏）。
- 所有旧脚本路径在 SKILL.md 中为 0 处（除迁移说明）。

**Phase 2 实测记录（2026-11-16）**

| 检查 | 结果 |
|---|---|
| `weekly_guide` 三个 topic | ✅ packet / findings-template / plugin-criteria |
| packet 上限与脱敏 | ✅ 20k 字符上限；隔离用例把 `/Users/...` 与 Bearer 都替换为 `<path>` / `<secret>` |
| 包内判据 | ✅ `pipeline/PLUGIN-CRITERIA.md`，随 npm tar 打包 |
| SKILL.md 旧脚本路径 | ✅ 0 处（`learning/scripts`、`run-weekly.sh`、`land-sync.sh`、`check-findings.mjs`、`report*.mjs`、`selftest.sh`、`history-merge.mjs` 全部清零） |
| SKILL.md 绝对路径 | ✅ 0 处 `/Users/` `/home/` |
| 约束保留 | ✅ 0 会话 fail-closed、单实例锁、回填、≤6、评分、15 行、四件事、未同步口径、隐私 |
| 测试 | ✅ 14/14 pass（Phase 3 E2E 加入后） |
| 隔离 canary | ✅ `tools=5 · routes=13 · skillBytes=11283` |
| npm tar | ✅ 36 files / 835553 bytes，含技能与判据 |
| 9 步全流程隔离 E2E | ✅ 合成 digest 9 步通过；见 Phase 3 实测记录 |

**结论**：Phase 2 的“工具桥 + 规范改写 + 静态隐私门禁”已完成，9 步代码路径已在 Phase 3 跑通；模型归纳质量不等同于代码路径通过，继续在 Phase 3 单独记录。

### Phase 3 — 等价性验收（隔离环境）

**做什么**

1. 用隔离 `DSH_HOME` + 合成 digest（≥3 会话、≥2 重复、≥2 候选）跑完整 9 步。
2. 对照旧技能产出：
   - findings 结构通过 `weekly_validate`
   - 报告包含 portrait/repeats/candidates
   - 采纳写入 decisions，`sync=false` 时明确“未同步”
   - 坏 findings 被拒绝，且旧报告不被覆盖
3. 测入口：
   - 生产技能仍在时，记录同名解析结果。
   - 隔离环境移除用户技能后，`weekly-retro` 必须由 runtime 提供。
4. 测边界：packet 截断、空数据、并发跑、`DSH_WEEKLY_SCRIPTS` 缺失、远程请求 403。

**验收门槛**

- 全部用例通过；至少一次真实（脱敏）周报走通。
- 没有发现“插件技能能加载但 9 步走不通”的半成品状态。

**回滚点**：删除隔离环境；生产未动。

**Phase 3 实测记录（2026-11-16）**

| 检查 | 结果 |
|---|---|
| 合成 9 步 E2E | ✅ `test/phase3-e2e.test.mjs`；`status → guide(packet/template) → validate → run(report) → land(sync=false) → decisions` |
| E2E 计数 | ✅ `sessions=3 · portrait=3 · repeats=2 · candidates=2 · steps=9` |
| 坏 findings | ✅ 未知 session 被拒；校验不覆盖旧报告；`weekly_run(report)` 回退非空壳并标记 `findingsRejected` |
| `sync=false` 语义 | ✅ `synced:false`，`where=已落地但未同步（sync=false）`，decisions 同口径 |
| 真实 digest 冒烟 | ✅ 当前 W46 的 `digest.json`/`packet.md` 复制到隔离目录；3 个真实 session id、2 重复、2 候选；报告与 `weekly_land(sync=false)` 均通过 |
| 入口 no-user canary | ✅ `skill=weekly-retro · bytes=11283 · tools=5 · routes=13` |
| 入口 with-user canary | ✅ 同名冲突不报注册错误；源代码规则为同层 runtime > user，preset-scoped 层仍可能更近 |
| 边界 | ✅ 现有 `test/robustness.test.mjs`（17 项）、`test/land-concurrency.test.mjs`（10/10）、`test/guide-isolation.test.mjs`、packet 截断、空数据、并发、缺脚本、远程 403 均通过 |
| 全量测试 | ✅ 14/14 pass |
| boot 验收 | ✅ `bash test/boot-verify.sh` → `tools=5 · commands=1 · routes=13`，且改为挂载当前工作区插件，不再误验 profile 内旧包 |
| 未完成 | ⬜ 真实模型对真实 packet 的归纳质量、生产入口实际调用、Phase 4 切换 |

**结论（保守）**：Phase 3 的确定性代码路径与真实数据 schema 已通过；**不把固定 findings fixture 当成模型分析验收**。Phase 4 仍需人工确认“真实模型产出质量”后才能开始；不删技能、不切生产。

### Phase 4 — 切换入口（可回滚）

**做什么**

1. 将 `~/.dsh/skills/weekly-retro/` 与 `~/dsh-config/skills/weekly-retro/` 移到 Phase 0 的备份目录；**不要直接 `rm -rf`**。
2. 重启/重载 DSH，确认 `weekly-retro` 来自插件 runtime。
3. 在生产数据上跑一次只读 `weekly_status` + 一次 `weekly_guide(packet)`；不立刻跑全量采集。
4. 用最近一周已有数据重跑报告，确认画像/重复未消失。
5. 若失败：把两个目录移回原位，重载，恢复旧技能；插件可保留但禁用注册。

**验收**

- `skill` 目录只有一份 `weekly-retro`，source=runtime。
- 触发词能加载完整 9 步。
- 报告、候选、采纳均与基线一致。
- 定时任务仍正常。

**Phase 4 预演实测记录（2026-11-16）**

| 检查 | 结果 |
|---|---|
| 本地 rc 包 | ✅ 从工作区 `npm pack` 得到 `0.5.0-rc.1`，包含 `skills/weekly-retro/SKILL.md` |
| 真实技能备份 | ✅ `/Users/dreamania/dsh-config-backups/weekly-retro-phase4-20261116-093407`；`local-skill` / `config-skill` / `MANIFEST.txt`，目录 700 |
| 真实技能移动 | ⛔ 未执行。真实 `~/.dsh/skills/weekly-retro` 与 `~/dsh-config/skills/weekly-retro` 仍在，hash 仍为 `0459e84…` |
| 隔离 no-user | ✅ `skill=true · bytes=11283 · tools=5 · routes=13` |
| 隔离 with-user | ✅ 同名冲突不报注册错误；runtime 仍注册成功 |
| 隔离 moved | ✅ 仅在临时 DSH_HOME 内把技能副本移走，runtime skill 仍为 `11283` bytes |
| 生产 profile | ⛔ 仍是 `0.4.9`，未安装 rc，未重载 |
| 同步/删除 | ⛔ 未执行 `land-sync.sh`，未删除任何技能 |

**结论**：Phase 4 的可回滚预演通过，但真实生产切换没有发生。**不要直接进入 Phase 5 删除**；下一步必须先让生产 profile 加载 `0.5.0-rc.1`（或正式 `0.5.0`），再备份/移走真实技能并做一次只读验证。预演脚本：`test/phase4-switch.sh`。

### Phase 5 — 删除、同步、发布

**做什么**

1. 确认 Phase 4 稳定后，从备份目录删除两份旧技能（备份保留到发布后 7 天）。
2. 版本升到 `0.5.0`；更新 README/PRIVACY/迁移文档。
3. 运行完整测试、`boot-verify`、`npm pack` PII 扫描。
4. `npm publish` + GitHub tag/release。
5. 在 `~/dsh-config` 执行同步并推送删除：
   ```bash
   bash ~/.dsh/learning/scripts/land-sync.sh "迁移 weekly-retro 到 dsh-weekly-retro 插件（0.5.0）"
   ```
6. 验证远端 commit、`dsh-config/skills/weekly-retro` 不存在、本机技能目录不存在。
7. 更新 DSH marketplace 条目说明（若需要）。

**验收**

- `~/.dsh/skills/weekly-retro` 不存在。
- `~/dsh-config/skills/weekly-retro` 不存在，且已推送。
- 插件包内 `skills/weekly-retro/SKILL.md` 存在。
- 新会话触发「跑周报」仍加载插件技能。
- 发布产物无 PII / 无 token / 无本机路径。

### Phase 6 — 观察与收尾

- 观察 2 周：技能是否被加载、失败次数、报告是否仍生成。
- 若出现“从未使用”不要直接判定失败；按原技能原则，可能只是没遇到场景。
- 删除临时备份（保留 git 历史即可）。
- 在 README 移除“插件不做模型判断”的旧限制，改为“分析规范由插件内置技能提供”。

## 6. 总验收清单

- [ ] 9 步全部有插件内对应物，且逐步演练通过。
- [ ] 运行时技能名、描述、触发词与旧技能等价。
- [ ] 两份旧技能目录已删除，`dsh-config` 已同步。
- [ ] 插件包包含 `skills/`，安装后无需用户技能目录。
- [ ] 0 会话 fail-closed、并发锁、回填、坏 findings 拒收均通过。
- [ ] 报告仍含画像/重复/候选；采纳仍写 decisions 并可同步。
- [ ] 定时任务、`/weekly` 命令、五 Tab UI 未回归。
- [ ] 隐私：npm 包与报告无 PII；数据路由仍 loopback-only。
- [ ] 回滚演练：恢复备份目录后旧技能立即可用。

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 同名技能解析顺序不确定 | 删文件后可能仍加载旧副本，或 runtime 被遮蔽 | Phase 1 做冲突探针；Phase 4 用隔离环境 + 生产双验证 |
| 插件未注入 `skills` 服务 | `ctx.skills.register` 不执行 | `inject` 加 `skills`；boot 诊断记录注册结果 |
| 运行时技能内容与旧技能漂移 | 行为降级 | 单一源文件；迁移矩阵逐项对照；Phase 3 用旧产出做基线 |
| npm `files` 漏掉 `skills/` | 安装后技能缺失 | `npm pack` 解包检查；CI 断言 |
| `weekly_guide` 泄露路径/原文 | 隐私回归 | 只返回 packet 与模板；路径字段单独脱敏；测试断言 |
| `land-sync.sh` 缺失 | 采纳只写 decisions | 保留现有“已落地但未同步”口径，不伪造推送 |
| 删除后无法恢复 | 入口中断 | 先移动不删除；备份在技能根目录外；保留 7 天 |
| `/weekly-retro` 实际是用户命令而非技能 | 触发词丢失 | Phase 0 先验证；若是命令，Phase 3 增加 command alias |

## 8. 回滚方案

1. 把备份目录移回：
   - `~/.dsh/skills/weekly-retro/`
   - `~/dsh-config/skills/weekly-retro/`
2. 重载 DSH；确认旧技能可加载。
3. 若插件版本有问题，回退到 `0.4.9` 或禁用插件注册。
4. 不动 `~/.dsh/learning/weekly` 数据；报告与 findings 不受影响。
5. `dsh-config` 用 git revert 恢复删除提交，不 force push。

## 9. 交付物

- `skills/weekly-retro/SKILL.md`（唯一权威）
- `skills/weekly-retro/references/findings.template.json`
- `skills/weekly-retro/references/PLUGIN-CRITERIA.md`
- `lib/index.js` 技能注册 + `weekly_guide`
- `test/skill-registration.test.mjs`、`test/migration-parity.test.mjs`
- `docs/MIGRATION-WEEKLY-RETRO.md`（本文件）
- `docs/migration-baseline.md`（Phase 0 产出）
- 版本 `0.5.0` 的 npm/GitHub 发布

## 10. 执行顺序（一句话版）

**冻结基线 → 包内技能骨架 → 分析桥 + 规范改写 → 隔离等价验收 → 生产切换 → 删除并同步 → 观察收尾。**

没有通过 Phase 3，不进入 Phase 4；没有通过 Phase 4，不执行 Phase 5 的删除。
