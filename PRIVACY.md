# Privacy · dsh-weekly-retro

本插件是**本机工具**：不联网、不上报、不建账号。下面说明它读写什么、哪些边界由 DSH 宿主控制。

## 插件读取什么

通过内置的确定性流水线（`pipeline/`，优先使用本机 `~/.dsh/learning/scripts`）读取：

- DSH 会话记录：会话标题、用户消息/意图消息片段、轮次、工具调用、写入的文件路径、时间戳、压缩/纠偏计数；
- 本机技能库数量与调用/失败计数；
- `~/.dsh/learning/weekly/` 下已有的 digest / proposals / findings / history / decisions / 报告。

这些读取都发生在**本机进程内**，不会发送到任何远端。

## 插件写入什么

默认写入 `~/.dsh/learning/`（可用 `DSH_LEARNING` 覆盖）：

- `weekly/digest.json`：**含用户消息片段**的会话摘要；
- `weekly/proposals.json`、`findings.json`、`history.jsonl`、`decisions.json`；
- `weekly/*.md`、`weekly/*.html` 周报；
- 采纳时写 `decisions.json`（写前备份），并调用本机 `~/.dsh/learning/scripts/land-sync.sh`。

> `land-sync.sh` 可能执行 `git push`，把技能/profile 同步到**你自己的**私有配置仓库。只有你点击“采纳并同步”或调用 `weekly_land` 时才会触发；不在后台自动运行。

## 网络与远程访问

- 插件自身**没有出站网络请求**：没有 telemetry、analytics、license 校验、更新检查或远程配置。
- 面板只请求同源相对路径 `/dsh-weekly-retro/*`。
- 所有数据路由（`/summary`、`/ui/*`、`/report`）**默认只允许本机回环地址**（127.0.0.1 / ::1）；非本机请求返回 403。
- 远程使用必须显式设置 `DSH_WEEKLY_ALLOW_REMOTE=1`（仅建议在已有认证的反代/内网后），或携带 `X-Weekly-Token`（`DSH_WEEKLY_TOKEN`）。
- 反向代理场景：插件只能看到代理的直连地址；如果代理把请求转发到 127.0.0.1，回环判断会放行，**必须由代理层负责认证**。

## 数据留存与删除

- 数据只在你本机，删除 `~/.dsh/learning/weekly/` 即可清除周报产物；卸载插件不会自动删除这些文件。
- `digest.json` 默认按系统 umask 创建（常见 0644）。多用户机器上如担心同机其他账户读取，请自行 `chmod 600 ~/.dsh/learning/weekly/*.json` 或收紧目录权限。
- 仓库内 README 截图使用**合成演示数据**（Demo 会话/候选），不含真实会话内容。

## 第三方

- 无第三方 SDK、无 CDN、无远程字体/图片。
- 依赖的 DSH 宿主、Node 运行时与 `weekly-retro` 流水线脚本各自遵循其隐私策略。

## 联系

隐私问题请在本仓库开 issue（不要粘贴真实周报内容/会话文本）；安全问题见 [SECURITY.md](./SECURITY.md)。


## 报告保存在哪、里面有什么

默认根目录 `~/.dsh/learning/`（`DSH_LEARNING` 可覆盖）：

| 路径 | 内容 | 权限 |
|---|---|---|
| `weekly/latest.md` / `latest.html` | 完整周报（含会话标题、工作区/文件路径） | `0600` |
| `weekly/<week>.md` / `<week>.html` | 历史完整周报 | `0600` |
| `weekly/latest.redacted.md/html`、`<week>.redacted.*` | **分享用脱敏版**：标题/路径/候选/技能名均替换 | `0600` |
| `weekly/digest.json`、`digest-<week>.json` | 会话摘要，**含用户消息片段** | `0600` |
| `weekly/packet.md`、`packet-<week>.md` | 分析用 packet，**含消息片段与路径** | `0600` |
| `weekly/proposals.json`、`findings.json`、`history.jsonl`、`decisions.json` | 候选/画像/历史/采纳 | `0600` |
| `weekly/*.bak-*` | `decisions.json` 写前备份 | `0600` |
| `logs/` | 流水线 stdout/stderr | `0700` 目录 / `0600` 文件 |
| `scripts/history.jsonl` | 跨周历史种子 | `0600` |

- 报告路由 `/dsh-weekly-retro/report` **默认返回 `*.redacted.html`**（若已生成）；本机要看完整版用 `?full=1` 或 `DSH_WEEKLY_REPORT_FULL=1`。远程仍被 loopback 门禁拦住。
- 完整报告包含你的会话标题/路径（这是周报的价值）；**任何对外分享请用 `.redacted.*`**，不要发 `latest.md/html`、`digest.json`、`packet.md`。
- 分析完成后可清理中间正文：`node pipeline/privacy-scrub.mjs --logs`（会清空 digest 消息、packet 正文与日志；报告保留）。
