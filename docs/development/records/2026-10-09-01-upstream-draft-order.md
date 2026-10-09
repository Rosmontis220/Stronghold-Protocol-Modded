# DEV-20261009-01 · 采用上游 0.2.2 的组内轮选顺序

## 基本信息

| 字段 | 内容 |
|---|---|
| 开始 / 最后更新 | 2026-10-09 / 2026-10-09，Asia/Shanghai |
| 状态 | 已完成：规则实现、上游测试、golden 及文档一致性检查通过；撰写时改动仍在工作区，未推送或部署 |
| 类型 | 功能 |
| 分支与开始 HEAD | `integrate/paper-0161-upstream-v021`，`6a1fdd0432d50a302c807bf1873c894211863bb9`；20 人功能登记的分支仍是 [D008](../DECISIONS.md#d008) 的 `feat/IncreasePlayerCapacity` |
| 上游基线 | 上游 0.2.2，标签 `v0.2.2`，`62eb113419123d9a3a63606107bbf85230c5dd2f`；本地缓存，未联网核实远端最新。本分支此前合并的基线为 v0.2.1，`c2a2ef778cf728ff29b953b9842b2a39b1e9cbea` |
| 提交归属 | 与本次功能同一提交；通过 `git log -- docs/development/records/2026-10-09-01-upstream-draft-order.md` 查询 |
| 关联 | [D014](../DECISIONS.md#d014) 替代 [D004](../DECISIONS.md#d004)；[D012](../DECISIONS.md#d012)、[D010](../DECISIONS.md#d010)、[PLAYER_CAPACITY.md](../../PLAYER_CAPACITY.md)、[原真人优先记录](2026-10-07-02-manual-drafts.md)、[前次任务](2026-10-08-05-parallel-group-drafts.md) |

## 需求、范围与验收

用户要求比较本分支 D004 的组内真人优先规则与上游 0.2.2 的轮选顺序语义。看到本分支的三条规则（D004 加 [PLAYER_CAPACITY.md](../../PLAYER_CAPACITY.md)）都是刻意实现，而上游把自己的跳过规则标为 `[ASSUMED]` 之后，用户仍选择上游：「感觉上游的实现更好，改成上游」；在被告知采用它会需要改写 D004、`group-drafts` 规格测试、并可能影响 golden 之后，用户第二次确认。本次逐条采用上游语义，不保留本分支自己的顺序规则。

- 组内顺序就是抽签结果本身：开局对本组座位洗一次牌，此后整个轮选期间固定；托管切换、掉线和重连都不重排，只有「跳过」移动席位。
- 房间选项「AI 队友最后选择」（`room.setAiPicksLast`，默认关闭）开启时，在同一次洗牌之后把本组全部真人席位整体前置，真人内部与 AI 内部各自保持抽签顺序，不额外消耗随机数；关闭时抽签结果原样生效，AI 队友可能先选。
- 「跳过」只在自己是本组顺序最后一位时以 `ERR.BAD_TARGET` 拒绝；成功后跳到本组顺序末尾，开启选项时跳到其他待选真人之后、AI 席位之前；跳过不跨组。
- 策略轮选的顺序保存本组全部座位（含退出和淘汰者，轮到它们时跳过）；机变轮选的顺序只保存本组存活座位。
- 不改变任何随机流、战斗算法和 golden 基准；不把上游 `[ASSUMED]` 的跳过规则写成官方规则。
- 只按改动范围做针对性验证；未授权推送或部署，也不修改项目外文件与上游 CHANGELOG。

## 调查与决定

| 问题 | 证据或来源 | 结论及确定程度 |
|---|---|---|
| 上游语义 | 上游 0.2.2 的 `enterBandDraft` / `enterSpDraft`、GitHub #338、PR #368、[0.2.2 历史](../../history/0.2.2.md) §27.4 | 已确认：顺序开局洗一次即固定，托管、掉线和重连都不重排；选项只在同一顺序上做稳定划分，不消耗随机数。 |
| 上游跳过规则 | 上游源码注释 | 已确认：上游自己把「跳过排到本组最后、开启选项时排到其他待选真人之后」标为 `[ASSUMED]`，注释写明这是重制版取舍、没有官方出处。记录照录该标记，不作为官方规则。 |
| 本分支旧规则 | D004、[PLAYER_CAPACITY.md](../../PLAYER_CAPACITY.md)、`Match.js`、`bandDraft.js` | 源码确认：`prioritizeDraftOrder()` 与 `manualDraftPicker()` 按「在线未托管真人 / 自动席位」稳定划分，连接与托管变化会重排本组未选席位；跳过还会在没有其他手动队友时拒绝，客户端用 `hasManualTeammateAfter` 复刻同一条件。这些都要随旧规则删除。 |
| 顺序的成员范围 | `makeDraftGroups`、`audit.js` | 源码确认：策略轮选取本组全部座位（上游取 `this.order`），机变轮选只取存活座位（上游取 `alivePlayers()`）；审计按整组成员核对策略顺序，机变按存活人数核对。 |
| 用户取舍 | 用户两次答复 | 已确认：明知本分支规则是刻意实现、上游跳过规则是 `[ASSUMED]`，仍选择统一到上游，接受更简单的「抽签结果原样生效、跳过排到最后」模型。 |
| golden 影响 | `npm run golden` | 已确认：283 个场景全部一致，本次不需要 `golden:update`。 |

## 实现或操作

| 文件 / 函数 | 变化与理由 |
|---|---|
| `server/match/match/phases.js` | 删除 `prioritizeDraftOrder()` 与 `manualDraftPicker()`；`makeDraftGroups({ shuffle, living })` 增加 `living`，策略轮选取本组全部座位、机变只取存活座位；顺序只在开局洗一次，`refreshDraftPriority` 不再重排，只在当前席位刚转为托管时立即开回合；`skipBand` 改为「自己是顺序最后一位」才拒绝，并把跳过者插到本组末尾（开启选项时插到其他待选真人之后、AI 之前）。 |
| `server/match/match/spDraft.js` | 机变按 `living: true` 建组，洗牌后只做 `humansFirst` 前置，不再 `prioritizeDraftOrder`；`startSpTurn` 同样不再重排。 |
| `server/match/audit.js` | 删除按真人/自动席位的顺序断言；策略轮选改为核对顺序集合等于本组座位集合，并在「AI 队友最后选择」开启时检查真人都在 AI 席位之前。 |
| `public/js/screens/bandDraft.js`、跳过相关文案 | 客户端镜像服务端的跳过规则：`canPassTurn(draft, myId, skipsLeft)` 取代 `hasManualTeammateAfter`，只要本组顺序里还有自己的后续席位就能跳过；按钮提示改为「跳过本轮，稍后再选／本组没有其他待选席位」，各语言包补齐新文案。 |
| 测试 | 上游自带的 `test/match/ai-picks-last.test.js`、`test/lobby-ai-last.test.js`、`test/ui/ai-picks-last.test.js` 未修改直接通过；本分支的 `test/match/group-drafts.test.js`、`test/match/draft.test.js`、`test/match/connection.test.js`、`test/match/lobby-integration.test.js`、`test/ui/bandDraft.test.js`、`test/ui/group-draft-views.test.js` 把旧 D004 断言改成上游语义（顺序即本组座位、只有跳过移动席位、最后一位不能跳过）。 |
| 文档 | 新增 [D014](../DECISIONS.md#d014) 并把 D004 标为被替代；[PLAYER_CAPACITY.md](../../PLAYER_CAPACITY.md) 的轮选段落按新规则重写；[UPSTREAM.md](../UPSTREAM.md) 的能力表行、[入口](../README.md)索引及本记录索引同步。 |

## 验证

环境：Windows，Node `v24.21.0`，仓库根目录执行。以下为实际执行的针对性检查，各检查之间有重复目标，计数不相加。

| 实际命令或检查 | 结果与边界 |
|---|---|
| `node --test test/match/ai-picks-last.test.js` | 11/11 通过，且该文件与上游 `v0.2.2` 逐字节一致（`git diff v0.2.2 -- test/match/ai-picks-last.test.js` 为空）。覆盖选项默认关闭、仅 `true` 生效、单人房无效、开关两态随机流完全一致、真人整体前置、托管/掉线/已退出真人仍按真人排序，以及「跳过传给其他真人、最后一个真人的跳过排到最后 `[ASSUMED]`」。 |
| `npm run golden` | 283/283 一致（roster 49、bonds 46、fields 22、matches 18、standins 10、diy 138），exit 0。**未运行 `golden:update`**：本次只改轮选顺序，不触碰战斗算法与黄金基准，因此没有场景移动。 |
| `node --test test/match/group-drafts.test.js test/match/group-draft-audit.test.js test/match/group-draft-generation.test.js test/match/draft-capacity.test.js test/match/draft.test.js test/match/ai-picks-last.test.js test/lobby-ai-last.test.js test/ui/ai-picks-last.test.js test/ui/group-drafts.test.js test/ui/group-draft-views.test.js test/ui/bandDraft.test.js` | 132/132 通过；覆盖分组并行、组内顺序即抽签、最后一位不能跳过、审计的整组成员核对与选项开启时的真人前置、选项协议与客户端按钮条件。 |
| `node --test test/docs-consistency.test.js test/docs-paths.test.js` | 31/31 通过；D014 锚点与文档相对链接均正常。 |
| `git diff --check` | 通过，无空白错误。 |
| `test/match/` 全目录一次运行（`node --test`） | 870 项：866 通过、2 失败、2 跳过。两项失败出现在同一工作区被并发改写的中间态（`group-drafts` 尚未改写的旧断言、`lobby-integration` 的观战 WebSocket 用例）；两文件单独重跑分别 27/27 与 1/1 通过，最终状态无失败。 |

未运行完整 `npm test`、浏览器端到端或真人压力测试：本次不改战斗模拟、经济或界面布局，上述针对性检查覆盖轮选状态机、审计、选项协议、客户端跳过条件与文档。20 名真人并发性能仍属 [I002](../README.md#待办与未确定事项)。

## 结果、遗留与接手

- 实现结果：二十人分组引擎的策略与机变轮选改用上游 0.2.2 的抽签顺序语义；D004 的组内真人优先、连接状态重排和「没有其他手动队友不可跳过」全部移除，见 [D014](../DECISIONS.md#d014)。客户端跳过按钮与服务端规则一致。
- 未确定或未完成：上游的跳过规则本身是 `[ASSUMED]`（重制版取舍，无官方出处），本分支照录、不作为官方规则，用户已明确接受；既有 I001–I003 不变。20 名真人同时连接的性能仍未实测。
- 提交 / 远程 / 素材 / 线上：撰写时功能与文档改动仍在工作区，未推送、未部署，未修改远程 `master`；本次不涉及素材更新。
- 接手入口：`server/match/match/phases.js`、`match/spDraft.js`、`server/match/audit.js`、`public/js/screens/bandDraft.js`、`test/match/ai-picks-last.test.js`、`test/match/group-drafts.test.js`；决定见 [D014](../DECISIONS.md#d014)，玩法说明见 [PLAYER_CAPACITY.md](../../PLAYER_CAPACITY.md)。

## 后续补充

暂无。
