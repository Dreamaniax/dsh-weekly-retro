# Weekly-Retro 迁移基线（Phase 0）

> 采集时间：2026-11-16 00:11（Asia/Shanghai）  
> 采集范围：迁移前技能、插件、真实周报数据。  
> 结论：**Phase 0 PASS；Phase 1 已在其上完成。尚未删除任何技能，也未切换生产入口。**

## 1. 代码与版本

| 项 | 基线值 |
|---|---|
| 插件仓库 | `/Users/dreamania/Documents/deepseek-harness/default-workspace/dsh-weekly-retro` |
| 插件版本 | `0.4.9` |
| Git HEAD | `77f6f8a` |
| 未跟踪文件 | `docs/MIGRATION-WEEKLY-RETRO.md`（迁移计划） |
| 顶层 inject | `['tools', 'webServer']` |
| 路由 | 13 |
| 工具 | `weekly_status` / `weekly_run` / `weekly_land` / `weekly_validate` |
| 插件命令 | `/weekly` |

## 2. 技能入口与文件

`/weekly-retro` 是**技能名**，由 DSH 的 skill 服务按用户显式 `/name` 调用；不是独立插件命令。插件命令是 `/weekly`，二者不要混为一谈。

| 文件 | sha256 | 行数 / 字节 |
|---|---|---|
| `/Users/dreamania/.dsh/skills/weekly-retro/SKILL.md` | `0459e846cc68ea456c588849643cdadc83001e212242f87078838a8daac371b1` | 180 行 / 12566 字节（含 frontmatter） |
| `/Users/dreamania/dsh-config/skills/weekly-retro/SKILL.md` | 同上 | 同上 |
| 插件包内 `skills/weekly-retro/SKILL.md`（无 frontmatter 正文） | `3260a7be9ad88a6a1771bf391b0d5c6ae8a43afe9575bf036401fa040f163380` | 175 行 / 12194 字节 |

两份用户技能内容一致；迁移前均未被修改或删除。

## 3. 基线验收输出

### 测试

```text
node --test test/*.test.mjs
tests 9 · pass 9 · fail 0
```

### Boot

```text
PASS: tools=4 · commands=1 · routes=13
diagnostics.ok = true
```

### 真实周报数据（`summary()`）

```json
{
  "week": "2026-W46",
  "sessions": 43,
  "mainSessions": 12,
  "turns": 238,
  "portrait": null,
  "repeats": null,
  "candidates": 0,
  "findingsRejected": "portrait[3].sessions 含未知会话 session-6407810a-ba97-46a9-bb1c-61f96c6a53c2；portrait[4].sessions 含未知会话 session-9e60926f-ffc1-473d-a39b-42287a5da1fa；portrait[4].sessions 含未知会话 session-d88850a7-7d70-484d-b028-fcac253db14f"
}
```

**重要基线缺陷**：当前真实 `findings.json` 的 portrait 引用了 3 个未知会话，校验拒绝后 portrait/repeats 为 `null`，candidates 为 0。这不是迁移造成的，但 Phase 3 的等价性验收必须先修复或明确保留这个缺陷；不能把空画像当成“迁移成功”。

## 4. 备份

```text
/Users/dreamania/dsh-config-backups/weekly-retro-pre-plugin-20261116-0011/
├── local-skill/SKILL.md
├── config-skill/SKILL.md
└── weekly-meta/{digest,findings,proposals}.json
```

- `weekly-meta` 目录 `0700`，文件 `0600`；包含会话相关中间数据，不要提交到 git/npm。
- 备份位于两个技能根目录之外，可读、可回滚。
- `weekly-meta` sha256：
  - `digest.json` `f170ceb4bceeaefc251b07d7351864133da950347684fc963c673d2cef08809c`
  - `findings.json` `458e455ed3dcc9f4d7147b121e89f88296198155827ed179c6cabe97f727a5a8`
  - `proposals.json` `19f3ae220dd4f2b22964fb8acfaaa96af299b3f56b4f83f81975888a67a30920`

## 5. Phase 0 验收结论

| 检查 | 结果 |
|---|---|
| 两份技能仍可用 | ✅ 未改动 |
| 备份可读、在技能根目录之外 | ✅ |
| 基线命令有输出 | ✅ 本文件第 3 节 |
| 入口类型已确认 | ✅ 技能名，不是命令 |
| 已知数据缺陷已记录 | ✅ 第 3 节 `findingsRejected` |

## 6. Phase 1 追加证据

Phase 1 在基线之上完成，不改变生产入口：

- 10/10 测试通过（新增 `test/skill-registration.test.mjs`）。
- `test/skill-canary.sh`：隔离 `DSH_HOME`、无用户技能，`skill=true · bytes=12194 · tools=4 · routes=13`。
- 同名冲突探针：隔离环境同时放入用户技能，runtime 注册仍成功、无注册错误；**具体解析优先级未在 Phase 1 定论**，留到 Phase 3 用模型行为探针验证。
- `npm pack --dry-run --json`：35 files，包含 `skills/weekly-retro/SKILL.md`。

## 7. 回滚

删除插件内 `skills/` 或回退 `lib/index.js` 的 `ctx.inject(['skills'])` 注册即可；用户技能和定时任务未动。生产 profile 未安装本阶段包，无需回滚生产。
