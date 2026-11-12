# Security · dsh-weekly-retro

## 边界

- 插件在本机 DSH 进程内运行，读写 `~/.dsh/learning`（或 `DSH_LEARNING`）。
- 数据路由默认仅回环访问；写路由仅同源或 `X-Weekly-Token`。
- `report` 的 `week` 参数白名单 `^\d{4}-W\d{2}$`，防路径穿越；JSON/HTML 响应 `no-store` + `nosniff`。
- 不加载远程代码、不执行网络下发脚本。

## 报告漏洞

请优先使用 GitHub Security Advisories（私密），或在 issue 中只描述复现步骤，**不要附带真实会话/周报数据**。

请包含：版本、DSH 版本、复现命令、期望/实际、影响面。

## 已知非目标

- 不防御已控制本机账户/进程的攻击者；
- 不替代反向代理/隧道层的认证；
- 不审计 `~/.dsh/learning/scripts` 与 `land-sync.sh` 本身（属于用户本机脚本）。
