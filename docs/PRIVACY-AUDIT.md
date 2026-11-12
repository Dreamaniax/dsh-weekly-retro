# Privacy audit · dsh-weekly-retro v0.4.8

> 审计目标：发布到 GitHub / DSH 插件市场前，确认 (A) 不会泄露作者信息；(B) 下载者不会意外暴露自己的数据。

## 结论

| 问题 | 严重度 | 状态 |
|---|---|---|
| 数据路由无认证：`/summary`、`/ui/*`、`/report` 可返回会话派生数据（含候选标题） | **P0** | **已修**：全部路由默认仅回环访问；LAN 实测 403 |
| README 含作者绝对路径 `/Users/...` | P1 | 已修：安装命令改为 `$(pwd)` |
| 设计文档/线框含真实候选名与真实统计 | P1 | 已修：替换为合成 Demo 数据；线框 PNG 删除 |
| README 截图含真实会话/候选/统计 | P1 | 已修：用合成 fixture 重新截图（12 会话 / 84 轮 / Demo 候选） |
| npm 包携带未使用的大图（约 6MB） | P2 | 已修：`files` 收敛，1.7MB |
| 缺少 LICENSE/隐私/安全说明 | P2 | 已补：MIT（待作者确认）、PRIVACY.md、SECURITY.md |
| `weekly_validate file` 可读 `weekly/` 外任意 JSON | P2 | 已修：路径白名单 |
| “采纳并同步”未明示会执行 `land-sync.sh`/git push | P2 | 已修：UI 确认文案 + README 明示 |
| `digest.json` 含用户消息片段（本地明文） | P2 | 已在 PRIVACY 披露；建议 `chmod 600` |
| 反向代理下只能看到直连地址 | P3 | 已在 PRIVACY/SECURITY 披露 |

## A. 作者信息暴露面

- 包内 `package.json`：无 `author`/邮箱/手机号；`license: MIT`（版权人为 contributors）。
- 全仓扫描：无作者用户名、无绝对 home 路径、无 token/私钥模式；PNG 无文本元数据。
- npm tarball 扫描：仅 21 个运行时/文档文件，PII 命中 0。
- 截图：全部由 `DSH_LEARNING=/tmp/dsh-demo` 的合成数据生成，无真实会话/候选/路径。

## B. 下载者数据暴露面

- 插件无出站网络、无 telemetry/analytics/远程配置；只请求同源 `/dsh-weekly-retro/*`。
- 读取本机 `~/.dsh/learning`（或 `DSH_LEARNING`）与 DSH 会话，写入同一目录；PRIVACY.md 已列明文件与内容。
- 所有数据路由默认 loopback-only；远程需 `DSH_WEEKLY_ALLOW_REMOTE=1` 或 `X-Weekly-Token`。实测 LAN 访问 `/summary`、`/ui/overview`、`/ui/candidates`、`/report` 均 403。
- 写路由：同源或 token；`report` week 参数白名单防路径穿越；`validate` 限制 `weekly/`。
- `land-sync.sh` 只由用户显式“采纳并同步”触发，可能 git push 到用户自己的私有仓库；已明示。
- 不自动运行采集：只有用户点击/调用工具才读会话。

## 生成物落盘（本轮新增）

- 全部周报/digest/packet/proposals/findings/history/decisions/logs 权限收紧为 `0600`，目录 `0700`；README/PRIVACY 列明路径。
- 报告默认生成 `*.redacted.*` 分享副本（标题/路径/候选/技能名脱敏）；`/report` 默认返回该副本，完整版需本机 `?full=1` 或 `DSH_WEEKLY_REPORT_FULL=1`。
- 现有历史周报已生成脱敏副本，并逐项验证 `private_hits=0`、`/Users/=0`、`~/=0`。
- 中间产物 `digest.json`/`packet.md` 仍含消息片段（分析必需），权限 600；提供 `pipeline/privacy-scrub.mjs` 在分析后清理。

## 证据

```bash
# PII 全仓
grep -rInE 'token=|sk-|ghp_|BEGIN [A-Z ]*PRIVATE KEY|/Users/[A-Za-z]' . --exclude='*.png'

# 发布包
npm pack --dry-run                 # 21 files / ~1.5MB
npm pack --pack-destination /tmp/x && tar -xzf /tmp/x/*.tgz
grep -rInE 'token=|sk-|ghp_|/Users/[A-Za-z]' /tmp/x/package   # 0 命中

# 远程边界（绑定 LAN IP 后）
curl -s -o /dev/null -w '%{http_code}' http://<LAN-IP>:<port>/dsh-weekly-retro/summary   # 403
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/dsh-weekly-retro/summary # 200

# 回归
node test/client-runtime.test.mjs && node test/preflight.test.mjs && node test/robustness.test.mjs
DSH_NO_PATCH=1 DSH_VERIFY_PORT=62381 bash test/boot-verify.sh
```

## 发布前仍需决定（非隐私缺陷）

1. ~~流水线依赖~~ **已解决**：确定性脚本已内置 `pipeline/`；有本机 `~/.dsh/learning/scripts` 时优先本机版本，无则回退内置。`land-sync.sh` 仍由用户本机提供；无它时采纳只写 `decisions.json`。
2. **仓库信息**：已填 `Dreamaniax/dsh-weekly-retro` 与公开 handle。
3. **License**：MIT（contributors），已确认。
4. **Marketplace 提交**：使用仓库 README + icon + PRIVACY/SECURITY；不要上传真实周报截图。

## 开发者注意

- `test/boot-verify.sh` 会把本机 profile 的 `package.json`/`cordis*.yml` 复制到临时目录（退出删除），不会上传；共享机器上运行前请知悉。
- `test/host.test.mjs`/`ui-contract` 会读取本机 learning 数据（只读、本地）；CI 建议用合成 `DSH_LEARNING`。
- 不要把 `~/.dsh/learning`、截图、日志提交进仓库。


## 0.4.8 密钥兜底

- 发现 AnySearch Bearer token 被用户粘贴进会话，周报 digest 复制了它；profile `cordis.patch.yml` 也有明文。
- 已移除 profile 明文（11 份配置/备份），token 仅保留在本机 `~/.dsh/secrets.env`（0600）；**该 token 必须轮换**。
- `redact-report.mjs` / `privacy-scrub.mjs` 增加 Bearer / `as_sk_` / `sk-` / `ghp_` 等密钥兜底；`run-weekly.sh` 报告生成后执行 `--secrets-only`。
- `test/privacy-secret.test.mjs` 验证 digest/report/log 中的假 token 都被替换为 `<secret>`。
