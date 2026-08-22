# ADR 0103：可信执行失败候选的人工审查事务

- 状态：Accepted
- 日期：2026-08-21
- 后续：[ADR 0104](0104-reviewed-execution-track-override.md) 已用 Guide 1.6 取代下述
  `strategy_switch` 表达限制；语义候选限制保持不变。

## 背景

[ADR 0102](0102-trusted-execution-failure-replan.md) 已把唯一终态 managed-action failure、不可变 replay
binding、自动回退 attestation 和精确目录绑定为可过期的确定性候选。该阶段故意只读：它不创建
GuideProposal，也没有人工身份、一次性决策或并发事务门。

直接把候选交给通用 Proposal API 会丢失失败证据与审查决策之间的精确绑定，也无法保证 Plan 未漂移、目标
revision 仍唯一、同一候选只终结一次。MCP 客户端自身也不是 Blender Companion，不能代替当前宿主实例
声明“已经人工审查”。

## 决策

Runtime 增加两种只读查询：

- MCP `operatingline.procedure.failure-replan.review.get`；
- HTTP `GET /api/v1/procedure/failure-replan/review?requestId=...`。

查询返回 `pending` 预览或已持久化的 `reviewed` 终态。严格 `evidenceBinding` 明示候选内容、候选事件、source
binding、当前 GuidePlan identity/content hash、ActionCatalog 与 InteractionCatalog 版本/content hash、terminal
action event、replay binding 和 rollback attestation hash；`reviewBindingSha256` 再覆盖该公开对象及可接受时将
产生的完整 artifacts。相同 `evidenceBinding` 原样进入 review 结果与终态事件。查询不接受调用方 evidence，
不改变审查状态，不调用 Provider，也不执行 Blender。

唯一可变入口是 `POST /api/v1/procedure/failure-replan/review`。请求必须通过严格 Schema，并携带候选目标
adapter/instance 当前协商的 `x-operatingline-companion-lease`。Runtime 只在审查事件中保存 lease 的 SHA-256
fingerprint。请求同时绑定一次性 `reviewId`、`requestId`、`proposalId`、预览给出的
`reviewBindingSha256`、决策和可信时间；accept 还必须逐字确认已审查精确候选、精确基线，并知悉本操作不会
调用 Provider 或执行宿主动作。

`parameter_repair` 只有在未过期、原 action 参数仍等于 `before`、新参数通过精确 ActionCatalog Schema、
Observation obligations 能同步改写且完整新版 GuidePlan 通过目录和 planning-quality 校验时才能接受。接受
会确定性生成 revision request/proposal identity，并在一个 `BEGIN IMMEDIATE` 事务中重新检查：

- 当前 Companion Plan identity 与内容 hash 未变化；
- 新 Proposal revision 正好是当前已知最大 revision 的下一版；
- 不存在活动 revision dialogue、同 identity 修订请求或 Proposal、以及目标实例的其它待审 Proposal；
- durable failure candidate event 与审查绑定仍逐字一致。

同一事务写入 GuideRevisionRequest、下一 revision 的 pending GuideProposal、两者关联、唯一审查记录和
`procedure.execution-failure-replan.reviewed` 事件。该终态只是“允许创建待审 Proposal”，不是
GuideProposal acceptance；它不发布或安装 Plan，不排队 action，也不启动 Blender 执行。

discard 只写唯一审查记录与事件，不创建 GuideRevisionRequest 或 GuideProposal。候选已过期时禁止 accept，
但在当前可信证据仍可重建时允许 discard。完全相同的 request、review 和 lease fingerprint 重试返回
`duplicate`；同一 request/review identity 的其它内容或相反决策返回 conflict。持久层在事务内重读所有权威
输入，冲突时不留下部分 revision、Proposal 或审查记录。

## 不支持的接受路径

- `strategy_switch` 目前不能安全编码进 GuidePlan 的 action/observation shape，因此以
  `strategy_track_not_representable_in_guide_protocol` 拒绝 accept；它仍可 discard。
- 语义候选没有签名、单次消费且绑定精确 packet 的 Provider authority，因此以
  `semantic_replan_requires_signed_provider_authority` 拒绝 accept；它仍可 discard。
- 不提供 mutating MCP review tool。只有精确目标 Companion 的 lease-authenticated HTTP 请求能终结审查。

## 结果

- 确定性参数修复可以安全进入现有 Blender Proposal 人工审批链，而不会绕过第二次 Accept/Reject。
- 审查、revision request 和 pending Proposal 在崩溃或并发冲突下保持全有或全无；终态可在重启后读取。
- Provider 调用和宿主执行均保持为显式 false；审查不能被解释为当前 Blender 状态证明或执行成功证明。
- 后续 strategy switch 需要 GuidePlan 的 execution-track 表达；语义局部重规划需要独立的签名 Provider
  authority 与 locality/质量/人工接受门。
