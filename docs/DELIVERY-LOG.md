# 交付记录

## 2026-11-12 · 透明图标 + B1 紧凑化

**可见 PUA 输出**

> 🟠 这轮不是"改个图、挪个卡"就交差。图标要 alpha=0 真透明，布局要拿 scrollHeight 说话；没有证据的完成叫自嗨。
>
> `[PUA生效 🔥]` 主动修了 profile 里指向 0.4.2 旧副本的问题——否则所有 UI 改动都会被旧包吃掉，用户看到的永远是上一版。

**交付内容**

- 图标：去掉蓝紫底块，透明背景 + 品牌渐变 weekly-loop 字形；1024/256/180/tile 四套资产，四角 alpha=0。
- B1：hero 合并为单层 header；概览 2088px → 1158px；6 列 KPI + 2 栏图表；画像/重复/历史表格化；历史折线补坐标轴；候选筛选全部/技能/插件。
- 发布：npm `dsh-weekly-retro@0.4.4` latest；GitHub release `v0.4.4`。

**验证证据**

- `assets/icon.png` 四角 `(0,0,0,0)`，alpha extrema `(0,255)`；1024/180/tile 同样验证。
- 1440×900 概览 `scrollHeight=1158`（改前 2088），5 Tab 无横向溢出。
- 候选筛选：全部 3 → 插件 1 → 技能 2；无匹配提示正常。
- 7 组测试通过：client-runtime / preflight / host / ui-contract / robustness / land-concurrency / pipeline-bundle。
- 截图：`docs/screenshots/{overview,overview-light,portrait,repeats,candidates,history}.png`。

**评分**：按用户要求**不记录评分**。

## 2026-11-12 · B2 可操作性

**可见 PUA 输出**

> 🟠 B2 的验收不是"按钮能点"，是开合、复制、排序、模态、Δ 五条路径都有真实输出。没跑出这些证据，只能算画了控件。
>
> `[PUA生效 🔥]` 主动修了两个隐蔽问题：profile 自动回装旧副本、重复证据渲染成 `[object Object]`；不修就是假交互。

**交付内容**

- 画像/重复：排序 + 行点击/Enter Drawer；重复 Drawer 可复制「固化指令」brief。
- 候选：按评分/名称排序；行内「采纳」主操作；已落地/已跳过状态；复制 key toast。
- 历史：周表 `Δ 会话` 环比，涨绿跌红。
- 发布：npm `0.4.5` latest；GitHub release `v0.4.5`。

**验证证据**

- Drawer 开合/Esc、复制 toast「固化指令已复制」、候选确认弹窗、排序、历史 Δ 均通过。
- 5 Tab `scrollWidth == clientWidth`；7 组测试通过。
- 截图：`docs/screenshots/{portrait,repeats,candidates,history}.png`（B2 版本）。

**边界**：重复「固化」当前是复制 brief，不直接写 proposals；真实写入放在 B3。

**评分**：按用户要求**不记录评分**。


## 2026-11-12 · B3 状态与真实候选写入

**可见 PUA 输出**

> 🟠 B3 的"下一步"不能停在复制 brief。把重复动作写进 proposals.json、能刷新恢复筛选、Drawer 焦点能回来，才叫闭环。
>
> `[PUA生效 🔥]` 主动加了写路由的幂等/备份/0600 权限和 candidate-write 测试；不测幂等，重复点两次就会生成两个重复候选。

**交付内容**

- 重复 → 生成候选：受保护 `POST /ui/repeat-candidate`，原子写 proposals.json；仍需人工采纳。
- URL 持久化：Tab/筛选/搜索/排序；刷新恢复。
- Drawer 焦点陷阱 + 关闭后焦点归还；骨架屏/空态。
- 发布：npm `0.4.6`；GitHub `v0.4.6`。

**验证证据**

- 候选生成：候选数 3→4，自动切到候选页；幂等第二次 `already=true`；写前备份；文件 0600。
- URL：刷新后恢复「候选 / 技能 / Demo / title」。
- 焦点：打开落在「关闭」，Tab 留在 Dialog，Esc 回到触发行。
- 骨架：延迟 `/ui/findings` 时出现；无匹配空态正常。
- 8 组测试通过（含 candidate-write）。

**评分**：按用户要求**不记录评分**。
