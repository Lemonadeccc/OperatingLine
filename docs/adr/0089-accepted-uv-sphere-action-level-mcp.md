# ADR 0089：已接受 UV Sphere 回放的 action-level MCP 执行

- 状态：已接受
- 日期：2026-08-20

## 背景

ProcedureTree 已能保存带具体参数顺序的 menu、shortcut 与 MCP 数组，受管 replay 也已把目录物化、人工审批、
Companion report、Observation、恢复证明和 Blender 原生 Undo checkpoint 串成审计链。但此前所有 MCP 轨迹仍为
`unavailable`；MCP 客户端只能生成或查询树，不能在不接收任意 Python、action 名称和参数的前提下执行一个已经
由用户接受的叶节点。

把通用 `bpy`、operator 名称或调用方提供的 action arguments 暴露成 MCP 工具，会绕过 immutable replay
binding、Blender 本地 Proposal 接受状态、当前游标和 Observation 成功门。同步等待 Blender 完成也会把 MCP
请求生命周期与 Companion 轮询、断线重连和 Runtime 重启混在一起。

## 决策

InteractionCatalog `1.34.0` 只为 `blender.mesh.create_uv_sphere` 的封闭 recipe 声明
`catalog.action_level_mcp`；`1.33.0` 保存为逐字历史快照。MaterializationResult `1.4.0` 生成恰好一次
`operatingline.blender.action.execute` 调用。调用数组保存：

- 固定 server/tool 身份；
- `requestId`、`replayId` 和 `expectedState` 的运行时占位；
- 从 leaf Action 深复制的具体 `actionArguments`；
- `accepted_leaf_action` 参数来源与该叶节点的 Companion state report 结果绑定。

运行时公开两个异步 MCP 工具：

- `operatingline.blender.action.execute` 只接收格式版本、新 UUID request、已有 replay ID 和精确
  `{reportId, sequence}` CAS；
- `operatingline.blender.action.status` 返回 `queued`、`dispatched`、`succeeded`、`failed`、`rejected` 或
  `recovery_required`。

Runtime 从持久化 replay binding、accepted decision、相同实例的 lease receipt 和当前 Companion state
推导完整 action。只有单一 UV Sphere executable step、已经接受并 Start、尚未执行任何 step、没有 Observation
阻塞且存在 `start` native Undo checkpoint 时才能入队。公开请求不能提供 action、参数、Plan/step ID 或 Python。

Companion 端点要求 Bearer 鉴权、当前实例的协商 lease 和 Guide protocol `1.5.0`。Blender 再以本地保存的
accepted proposal、Plan hash、execution ID、最后 report、exact next step 和完整 action arguments 做第二次
compare-and-set，随后只调用既有 canonical `bpy.ops.operating_line.next()`。它不会把 MCP 输入映射为任意
`bpy.ops`。

状态通过 append-only execution events 保存。第一次 poll 把队列绑定到当前有效 lease 并生成唯一 delivery；
同 request 重试幂等，冲突 identity fail closed，同实例同时只能有一个非终态请求。Runtime 在 dispatch 后重启时
把请求置为 `recovery_required`，不自动重放不确定动作。接受后、dispatch 前的正常 Companion 重连可以把 queued
delivery 绑定到新 lease；dispatch 后的 session identity 不再改变。

执行结果必须由同一 dispatch lease 提交。带报告的结果只有在精确 report ID/sequence 已先被 Runtime 确认，且
该报告仍是目标 Companion 最新状态时才可完成。报告、结果和 native Undo commit 均不得早于 dispatch；成功还须
精确匹配 dispatched step 的 Observation 数量、顺序、kind 与 parameters，全部 satisfied/supported，并携带
对应 `next` checkpoint 和唯一 step receipt。`rejected` 不得携带执行报告。

## 证明边界

- `succeeded` 证明这一个 MCP request 经 Companion 调用了已接受回放的 canonical Next，并取得绑定的当前报告；
  它不开放通用 Blender 自动化。
- 既有 replay attestation 仍只证明 Companion-reported managed Action，不单独标记 UI/MCP entry point；其不可变
  MCP grounding claim 不能脱离 action execution status 当作执行证明。
- menu 与 shortcut 数组仍是目录 grounding 或候选教学轨迹，不因 managed Action 成功而升级为真实逐控件/按键
  执行样本。
- Icosphere、其他 primitive、Edit Mode、Modifier、Geometry Nodes、蒙皮、权重、骨骼、动画和渲染 action-level
  MCP 均未由本决策开放。

## 验证

- 协议与生成 JSON Schema 拒绝任意 action/Python、非 UV Sphere delivery、身份不一致及非法终态证据；
- coordinator 测试覆盖幂等、目标互斥、lease 重连、冲突结果和重启后的 `recovery_required`；
- Runtime 集成测试覆盖接受/Start/CAS、缺失报告、dispatch 前证据、Observation 参数错配、旧报告、lease 缺失、
  成功与重复结果；
- Python 单元测试覆盖精确 report-before-result 顺序和无关高序号报告不能解锁结果；
- Blender 4.5.3 与 5.1.1 前台测试覆盖本地 Proposal/游标校验、canonical Next、成功报告和本地拒绝。

## 后续

下一步按 action 独立增加 InteractionCatalog 声明、强 Observation 与真实双版本回放，而不是从 operator 名称推导
通用执行。`recovery_required` 的人工检查、原生 Undo 恢复和重新入队仍属于独立恢复切片；逐控件 menu/shortcut
执行器也保持独立，避免把受管 Action 与 UI 教学轨迹混为同一种证据。
