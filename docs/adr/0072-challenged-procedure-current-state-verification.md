# ADR 0072：挑战绑定的 Procedure 当前状态复核

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0065–0071 的 replay attestation 是追加式历史证据。它证明 terminal Companion report 发生时受管
Action、强 Observation 和原生 Undo checkpoint 一致，但之后的 Undo、Back、用户编辑或文件重载不会删除该
事件。因此 `currentHostStateAfterReport: not_verified` 是必要限制，调用方不能通过重新读取旧 attestation
回答“对象现在是否仍保持被证明的状态”。

直接采用最新 Companion report 仍不够：report 可能早于查询，且没有绑定本次查询。让 Orchestrator 主动调用
Blender action 则会混淆只读验证与场景执行，并绕过 Companion 主线程边界。

## 决策

Runtime 新增两组等价入口：

- MCP `operatingline.procedure.replay.current-state.request` 与 HTTP
  `POST /api/v1/procedure/replay/current-state/request`；
- MCP `operatingline.procedure.replay.current-state.get` 与 HTTP
  `GET /api/v1/procedure/replay/current-state`。

调用方提交已 finalize 的 `replayId` 和唯一 `verificationId`。Runtime 从不可变 attestation 构建挑战，绑定
attestation ID/content hash、目标 instance、Plan/revision/content hash、execution、leaf 和期望强 Observation
的规范内容 hash。requested 事件先追加持久化；相同 ID 幂等，ID 冲突、同一 replay 的并发未完成请求以及超过
64 个全局 pending 请求均 fail closed。重启时由 requested/completed 事件恢复 pending 状态。

只有持有当前协商 Companion lease 且协议为 1.5 的目标 Blender 实例会在 Guide poll 中收到挑战。Transport
在单次连接内去重投递；响应丢失时同一 report 重试，重启或重连后未完成挑战可以重新投递。

## Blender 只读复核

Companion 在 Blender 主线程处理挑战，按 request step ID 重新运行当前 Action 的 Observation evaluator。该
路径不调用 action、rollback、Start、Next、Back 或原生 Undo，不修改 active index、receipt、gate、Session
snapshot 或场景。它生成 `current_state_rechecked` report，逐字回显挑战，并在可用时重新读取当前 Scene
marker、journal Session snapshot 和产物备份证明；读取异常只会令 checkpoint 证据缺失，不会伪造成功。

Runtime 只接受同一目标 lease、同一 pending 挑战且服务端 receipt 晚于 requested 事件的 report。确定性结果
按以下优先级分类：

1. `session_identity_mismatch`；
2. `step_state_mismatch`；
3. `observation_mismatch`；
4. `native_undo_checkpoint_mismatch`；
5. `verified`。

只有 Plan/execution、completed/active/step、强 Observation 完整内容和唯一 leaf receipt checkpoint 全部一致时，
结果才是 `verified_at_report`。其他结果保存为 `not_verified`，不会把失败解释为对象不存在之外的更具体原因。

## 证据、时效与导出

completed verification 保存原 request、完整 Companion report、协商 lease fingerprint、服务端 report receipt、
分类、验证范围和规范内容 SHA-256，并写入：

- `procedure.leaf-replay.current-state.requested`；
- `procedure.leaf-replay.current-state.completed`。

两类事件按目标 adapter/instance/Plan 进入 Eval/replay 导出。即使结果为 verified，合同仍明确保留
`currentHostStateAfterReport: not_verified`：它回答的是挑战响应发生时的状态，不是无限期的“现在”。需要更新鲜
答案时必须创建新的 `verificationId`。

## 安全与兼容性

- 旧 Companion delivery 不出现新字段；只有存在 pending 挑战时才添加可选字段，旧响应形状保持不变。
- `current_state_rechecked` 仅允许协议 1.5，并必须回显完整挑战；legacy presence 不能接收或提交该证明。
- 历史 replay attestation 仍可读取，但缺少 ADR 0071 checkpoint 范围的旧 attestation 不能创建当前状态挑战。
- 复核不授权场景修改、自动修复、自动恢复、菜单/快捷键执行或 action-level MCP 执行。

## 验证

- 协议与公开 JSON Schema 测试覆盖 request、pending/completed result、完整性、错误 scope 和 drift 结果。
- Runtime 集成测试覆盖 challenge delivery、幂等、verified、Observation drift、协商 receipt 和 Eval 导出。
- Python 测试覆盖 Transport 单连接去重与 Session 只读 Observation。
- Blender 4.5.3 与 5.1.1 前台回归证明复核前后 Session snapshot 相同，并复用同一真实 native Undo
  checkpoint；完整雪人、蒙皮动画和机器人基准继续通过。

## 未选择方案

- **把 attestation 查询称为当前状态**：没有请求 nonce 或新宿主观察，时效声明不成立。
- **复用 `Recheck Observations` Operator**：该 Operator 只处理 blocked gate 且会提交新的 Undo checkpoint；
  当前状态查询必须是只读的。
- **检查对象是否存在即可**：无法证明参数、拓扑、所有权、receipt、Mesh 内容和 checkpoint 一致。
- **verified 后移除时效限制**：任何后续宿主操作仍可能改变状态。

## 后续

该合同完成成功 replay 的按需当前状态复核。失败执行、自动回退、人工修复与恢复过程仍需要独立的 replay
failure/recovery attestation；逐控件 UI、快捷键、action-level MCP 和七种 primitive 之外的 Action 覆盖也不在
本切片内。
