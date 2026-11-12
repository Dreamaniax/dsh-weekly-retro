# Release checklist · dsh-weekly-retro v0.4.3

发布前逐项打勾；未完成项不要 publish。

## 0. 需要作者确认

- [x] License：**MIT**（版权人 `dsh-weekly-retro contributors`）
- [x] GitHub 仓库：`Dreamaniax/dsh-weekly-retro`（已填 `package.json`）
- [ ] 作者字段：留空，或使用公开 GitHub handle（不要写邮箱/手机号）
- [x] **流水线依赖**：已选 B，内置 `pipeline/`（`land-sync.sh` 仍由用户本机提供）
- [ ] 发布前确认内置脚本无本机数据/路径
  - [ ] A.（未选）伴侣插件：README 已写明需先安装 `~/.dsh/learning/scripts`；市场页注明前置依赖
  - [x] B. 已内置 `pipeline/` + 路径回退

## 1. 内容与隐私

- [ ] `npm pack --dry-run` 只含：lib / cordis.patch.yml / README / LICENSE / PRIVACY / SECURITY / docs/screenshots / 4 个 icon 文件
- [ ] tarball PII 扫描 0 命中：
  ```bash
  npm pack --pack-destination /tmp/x && tar -xzf /tmp/x/*.tgz
  grep -rInE 'token=|sk-|ghp_|BEGIN [A-Z ]*PRIVATE KEY|/Users/[A-Za-z]' /tmp/x/package
  ```
- [ ] 全仓无作者用户名、无 `/Users/<name>`、无真实候选/会话标题
- [ ] README 截图全部为合成演示数据（`DSH_LEARNING=/tmp/dsh-demo` 生成）
- [ ] `docs/ui-wireframe.png` 已删除（含真实候选）
- [x] `~/.dsh/learning`、日志、临时截图、`.tgz` 不在 git 跟踪内
- [x] 报告/日志权限 `0600`、目录 `0700`；`*.redacted.*` 已生成并验证无标题/路径
- [x] 中间产物清理命令 `pipeline/privacy-scrub.mjs --logs` 已文档化

## 2. 安全边界

- [ ] 所有数据路由默认 loopback-only；LAN 实测 `/summary`、`/ui/*`、`/report` 均 403
- [ ] `report?week=` 非法值 400；`weekly_validate file` 不允许 `weekly/` 外路径
- [ ] 写路由同源/token 门禁；`land` 确认文案明示会执行 `land-sync.sh`（可能 git push）
- [ ] `PRIVACY.md` / `SECURITY.md` 链接有效，内容与实现一致

## 3. 质量门

```bash
node test/client-runtime.test.mjs
node test/preflight.test.mjs
node test/host.test.mjs
node test/ui-contract.test.mjs
node test/robustness.test.mjs
node test/land-concurrency.test.mjs
DSH_NO_PATCH=1 DSH_VERIFY_PORT=62382 bash test/boot-verify.sh
```

- [ ] 全部通过；真实浏览器 5 Tab、roleImgs=10、`pageErrors=[]`

## 4. GitHub

- [ ] `git init`，首次提交只包含项目文件（无 `node_modules`/截图源数据）
- [ ] 推送 `<owner>/dsh-weekly-retro`，默认分支 `main`
- [ ] tag `v0.4.3`；Release 附 tarball + 隐私说明链接
- [ ] 仓库开启 Security Advisories（SECURITY.md 指向）

## 5. Marketplace

- [x] 名称：`dsh-weekly-retro`；版本 `0.4.3`；icon `assets/icon.png`
- [ ] 描述与 README 一致；标注前置依赖与“本机数据、无遥测”
- [ ] **目录 PR**：`awesome-dsh-plugin` 要求仓库创建满 1 天；本仓库创建于 2026-11-12，最早 2026-11-13 提交 `data/plugins/Dreamaniax__dsh-weekly-retro.yml`（内容见 `docs/marketplace-entry.yml`）
- [ ] 提交审核后，在干净 profile 安装验证：
  - [ ] 启动无 `did not activate`
  - [ ] 首页空数据可打开、不崩
  - [ ] 远程（LAN）访问数据路由 403

## 6. 发布后

- [ ] `npm view dsh-weekly-retro version` 可查（当前名称未被占用）
- [ ] 记录 release commit / tarball sha256
- [ ] 如发现 PII 残留：立即撤回版本、清理 git 历史、轮换任何泄露凭据
