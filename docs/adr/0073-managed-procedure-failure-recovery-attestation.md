# ADR 0073：受管 Procedure 失败、回退与修复恢复证明

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0065–0072 已能证明七种 primitive 的受管 Action 成功结果、报告时原生 Undo checkpoint，以及按需当前状态
复核。但 `step_observation_failed`、自动补偿回退、`retain_for_repair`、回退失败后的人工修复和
`observation_recovered` 仍只作为孤立 Companion report 存在。调用方无法证明这些 report 属于同一个已审批
replay，也无法区分“Action 成功”“失败后未保留”“失败后保留并最终修复”。

把 recovered report 交给原有成功 finalizer 也不正确：它没有原始失败证据，而且会掩盖本次执行曾进入阻塞
恢复路径。

## 决策

新增等价入口：

- MCP `operatingline.procedure.replay.failure-recovery.finalize`；
- HTTP `POST /api/v1/procedure/replay/failure-recovery/finalize`。

请求绑定 `replayId`、唯一 `attestationId`、`failureReportId`，以及修复路径必需的 `recoveryReportId`。Runtime
重新读取不可变 replay binding、accepted decision、完整 Companion reports 和服务端 receipts，不信任调用方
重述的 Plan、Action、参数或结果。

一个 replay 只能保存下列互斥终态之一：

1. 原有 `step_succeeded` 成功 attestation；
2. `automatically_rolled_back`：`rollback_step` 的强 Observation 失败，Companion 成功执行补偿动作并报告
   `failed_rolled_back`；
3. `recovered_after_repair`：`repair_required` 或 `rollback_failed` 的阻塞失败保留精确 leaf receipt，随后
   `observation_recovered` 重新通过完整强 Observation。

成功 finalizer 与 failure/recovery finalizer 共用同一追加式 attestation 唯一约束；一条路径落盘后，另一条路径
以及不同 report/attestation identity 均返回 conflict，相同请求幂等返回 duplicate。

恢复终态的 failure 与 recovery report 会在同一数据库事务中登记为 attestation 的组成证据；每个 report id 在
所有 replay attestation 之间全局唯一，不能被第二个 replay 重新认领。原有单 report 成功证明会由迁移自动回填
同一关联，因此历史数据保持相同的防复用约束。

## Observation 与 Undo 证据

失败 report 必须属于精确 target、Plan/revision/content hash、execution 和 leaf，只有一个与 Action 对应且
`satisfied: false` 的 Observation，并保留 accepted 参数与 `supported: true`。gate strategy/status 必须与物化
leaf 的 policy 一致：

- `failed_rolled_back` 仅允许 `rollback_step`，Session 不保留 active/completed leaf 或 receipt。该操作恢复到
  已有 checkpoint，未产生新的可声明 terminal checkpoint，因此证据明确写为
  `not_applicable_no_retained_step`，不会伪造 Undo commit；
- `repair_required` 仅允许 `retain_for_repair`，`rollback_failed` 仅允许 `rollback_step`。两者必须为 blocked，
  active leaf 与 receipt 被保留，Companion 先提交 `next` 原生 Undo checkpoint，再上报失败；
- 修复 report 必须属于同一 Plan/execution/leaf，gate 为 `recovered` 且 failure strategy 不变，唯一强
  Observation 的完整参数、所有权、拓扑与 Mesh 内容重新通过，并携带包含唯一 leaf receipt 的 `recheck`
  checkpoint。

`decision` 与初始 failure report 必须来自同一 negotiated lease。人工修复可能跨越 lease TTL 或 Companion
重连，因此 recovery report 可以来自同一 target 的新 negotiated lease；attestation 分别保存 execution 与
recovery session fingerprint，并以服务端单调 receipt 序列证明 proposal → decision → failure → recovery。

## 证据范围

failure/recovery attestation 明确记录：

- `managedActionAttempt: observation_failed`；
- rollback 是 Companion 报告成功、报告失败或未请求；
- recovery 是不需要或由强 Observation 与 recheck checkpoint 报告验证；
- menu 仍为 `catalog_grounded_not_executed`，shortcut 仍为 candidate 未执行或 unavailable，MCP 仍为
  unavailable；
- `currentHostStateAfterReport: not_verified`。

nonce current-state challenge 接受 checkpoint-backed 的 `recovered_after_repair`，并以 recovery report 的强
Observation/hash 和同一 attestation 内容哈希为基准；`automatically_rolled_back` 没有保留 managed leaf，仍
明确拒绝挑战。failure/recovery outcome 不会被错误投影成原有直接成功 evidence。

## 兼容性与导出

- 原有成功 attestation Schema、finalizer 和历史数据不变。
- managed replay proposal 现在接受 `rollback_step` 或 `retain_for_repair` 成功门；仍限定同一七种 primitive、
  单一 leaf 与 compensating action。
- failure/recovery 使用现有 `procedure.leaf-replay.attested` 追加事件，因此按 execution host/Plan 自动进入现有
  Eval/replay 导出，不增加隐式可变状态。
- 通用 native Undo checkpoint 仍要求 receipt 属于 completed step；唯一例外是
  `step_observation_failed` 的 `repair_required`/`rollback_failed` active retained blocked step，且 checkpoint
  必须明确包含该 step，不能夹带其他未完成 receipt。

## 验证

- 协议与公开 JSON Schema 测试覆盖 recovered、automatic rollback、错误 outcome/scope、checkpoint operation
  与互斥 report 形状。
- Runtime 集成测试覆盖 MCP/HTTP finalization、同 lease receipt、强恢复 Observation、幂等、成功/失败终态
  互斥、recovered current-state challenge，以及 automatic rollback challenge 拒绝。
- Blender 集成回归验证自动回退不生成伪 checkpoint，retain failure 产生 `next` checkpoint，恢复产生
  `recheck` checkpoint。

## 后续

该合同尚未证明逐控件菜单/快捷键执行或 action-level MCP，也未覆盖七种 primitive 之外的 Edit Mode、Modifier、
Geometry Nodes、骨骼、动画、灯光、相机和渲染 Action。失败自动诊断和策略化重试仍需后续切片。
