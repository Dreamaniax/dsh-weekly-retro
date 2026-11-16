# 判据：技能 / 规则 / 插件 / 定时 / watcher

> 用途：让「从对话挖技能」和「从对话挖插件」有同一把尺子。
> 具体环境以实际探测为准，不把示例数量当成本机事实。

## 决策树（从上到下，第一个命中即定形态）

| # | 判据 | 形态 | 成本 | 常驻 | 典型例子 |
|---|---|---|---|---|---|
| 1 | 只需模型遵守，没有稳定触发入口 | **规则**（AGENTS.md） | 极低 | 否 | 长任务先出阶段清单 |
| 2 | 一次会话内跑完、靠模型执行流程 | **技能**（SKILL.md） | 低 | 否 | 联网调研打包 |
| 3 | 流程是确定性的、要嵌进已有命令链，不需要新工具 | **插件·bundle-patch** | 低 | 否 | 周报里的 condense 步骤 |
| 4 | 需要给模型/用户新增一个可调用的工具或命令 | **插件·tool** | 中 | 否 | `watch_*`、`dsh_sync_status` |
| 5 | 需要 GUI 呈现（面板、滑块、组件） | **插件·client-ui** | 高 | 否 | model-effort-chips |
| 6 | 需要按时间自动跑 | **定时任务** | 低 | 是（系统级） | 周报采集 |
| 7 | 需要响应外部事件（仓库、文件变化） | **watcher** | 中 | 是 | 监听 issue |

**成本闸门**：`persist = true` 的候选（6/7）默认降级成「按需触发版」，除非收益明确大于常驻开销。

## 写进分析环节的硬约束

1. 每条候选必须带 `evidenceSessions`，且 id 必须真实存在于本周 digest，否则丢弃（防编造）。
2. 每周候选上限 6 条；`decisions.json` 里 landed / skipped 的一律不再重复推荐。
3. `plugin` 类候选必须填 `plugin_spec`：注册什么、读写哪些路径、是否常驻、最小验证命令。
4. 插件候选必须先过判据表第 3/4/5 条之一——不能因为「听起来高级」就推荐插件。
5. 数据不足（主会话 < 3 或轮数 < 10）时，只写「证据不足」，不出候选。

## findings.json 的枚举

```text
shape   : rule | skill | plugin | schedule | watcher
trigger : bundle-patch | tool | client-ui | mcp     （仅 shape=plugin 时）
persist : true | false
cost    : low | mid | high
scores  : { freq, trigger, capability, verifiable }   // 各 0-2
verdict : skill | skill-lite | rule | plugin | schedule | watcher | skip
```

## 评分与判定

四项各 0-2：频率 / 触发可预测 / 是否新增能力 / 可否自动验收。

- 纯纪律型（`capability=0`）→ **规则**，写进 AGENTS.md。
- 总分 ≥6 且有触发词 → **技能**。
- 总分 ≥5 → 轻量技能。
- 需要确定性工具入口 / 跨会话状态 / UI / 原生能力 → **插件**（按需触发优先）。
- 需要按时间自动跑 → **定时任务**；需要监听外部事件 → **watcher**（常驻成本高，默认不建议）。

脚本只校验「形态与分数是否自洽」，不替模型判定；最终形态由用户拍板。
