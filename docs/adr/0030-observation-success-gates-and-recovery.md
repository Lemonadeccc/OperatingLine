# ADR 0030：Observation 成功门与显式恢复策略

- 状态：已接受
- 日期：2026-08-12

## 背景

Guide protocol `1.0.0` 与 `1.1.0` 把 `expectedObservations` 定义为动作执行后的遥测。即使 observation
返回 `satisfied: false`，Companion 仍会推进步骤并上报 `step_succeeded`。这种行为适合早期证据采集，
但无法把“动作已调用”与“动作结果已满足计划”区分开，也没有描述失败后应自动补偿还是保留现场供
用户修复。

直接改变旧协议行为会让同一签名 payload 在新旧宿主中产生不同结果，因此成功门必须显式版本化，
不能由 observation 是否存在或 action 类型隐式推断。

## 决策

Guide protocol 升级为 `1.2.0`。可执行叶节点可以声明：

- `{ "mode": "telemetry" }`：保持只读遥测；
- `{ "mode": "success_gate", "failureStrategy": "rollback_step" }`：动作后只评估一次；任一 observation
  不满足或求值失败时，先以该步 receipt 自动补偿。补偿成功后不推进步骤，`Next` 可重新执行；
- `{ "mode": "success_gate", "failureStrategy": "retain_for_repair" }`：保留动作结果与 receipt，当前步骤
  不计入完成，并锁住后续 `Next`。用户可修复宿主状态后使用 `Recheck Observations`，或用 `Back` 补偿。

只有 `1.2.0` Plan 可以携带 `observationPolicy`；`1.0.0`/`1.1.0` 继续按原遥测语义读取。success gate
必须位于 action 叶节点且至少有一条 expected observation。当前 `snowman-demo` revision 6 的 25 个
可执行叶节点全部采用 `rollback_step`，revision 4 历史 fixture 保持不变。

## 状态与报告

Companion protocol 增加：

- phase `blocked`；
- transition `step_observation_failed` 与 `observation_recovered`；
- `observationGate`，记录精确 step、`failed_rolled_back | repair_required | rollback_failed | recovered`、
  failure strategy 和面向用户的恢复说明。

`repair_required` 与 `rollback_failed` 必须使用 `blocked` phase；blocked step 不进入 `completedStepIds`。
自动回滚成功使用 `failed_rolled_back`，会保留失败证据但不锁住重试。自动回滚若因外部修改失败，
receipt 与步骤位置保持不变，状态升级为 `rollback_failed`，避免覆盖用户修改。恢复 transition 回传同一次
Recheck 的 observation；成功步骤也缓存并回传放行时的单次评估结果，报告不会再次读取可变场景。

Blender Sidebar 会禁用 blocked 状态下的 `Next`、保留 `Back`，展示恢复策略并提供 Recheck。原生菜单
入口和 viewport look-ahead 同步显示 locked，不能绕过门禁。

## 兼容性

- 通用读端接受 Guide protocol `1.0.0`、`1.1.0` 与 `1.2.0`；当前生产端生成 `1.2.0`。
- `GuideGoalRequest` 与 revision history 继续读取 `1.1.0` 历史记录；当前 Blender/Orchestrator 生产
  `1.2.0`。`1.1.0+` Proposal 和 Revision Request 仍要求 thread/diff 约束。
- `observationGate` 只允许出现在 `1.2.0` Companion report 中，并在该版本中显式为 object 或 `null`；
  旧报告不得携带此字段。
- ActionCatalog、InteractionCatalog、Planning Packet 和 quality baseline 的版本线互相独立，本次不
  改写它们的 `1.1.0` 格式语义。

## 验证与失败语义

- 协议测试覆盖旧版拒绝 policy、success gate 空 observation、非 action policy、blocked/report 状态
  组合、strategy/status 一致性和生成 JSON Schema。
- 纯 Python session 测试覆盖自动回滚、不重复执行、保留现场、Recheck 恢复、回滚冲突与 Back 恢复。
- Blender 4.5.3 与 5.1.1 集成测试真实执行失败门：确认自动回滚删除结果且不推进、保留现场时二次
  `Next` 不重复创建、Recheck 后进入完成，并证明成功报告复用第一次门评估证据。
- 完整 revision 6 雪人 25 步在两个 Blender 版本中逐步通过 success gate、生成 PNG 并完整反向补偿。

## 未选择的方案

- **默认把所有 observation 变成门**：会破坏既有 `1.0.0`/`1.1.0` replay。
- **门失败统一抛宿主 error**：会丢失“可修复业务状态”和“执行基础设施错误”的区别，也无法表达
  自动回滚已经成功。
- **Recheck 时重新执行 action**：可能重复创建资源或扩大副作用；Recheck 必须只读。
- **评估后在 report 中再次评估**：场景可能在两次读取之间变化，使报告与实际放行决定不一致。

## 后续

本决策发布时不接入 Blender 原生 Undo，Back 仍使用可审查 receipt 补偿。后续独立状态机已经在
[ADR 0031](0031-blender-native-undo-history.md) 接入 `undo_post`/`redo_post`、Session checkpoint、
RNA pointer 重绑定和文件产物恢复；该宿主历史层没有改写本 ADR 的成功门或补偿语义。
