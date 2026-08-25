# ADR 0111：Light Trails 逐操作 MCP 与原生 Undo lineage

- 状态：Accepted
- 日期：2026-08-24

## 背景

ADR 0109 与 0110 已把固定 no-bake Light Trails recipe 表达并实现为 54 项本地操作：资源预检、modifier、
20 个具名节点、12 个就地参数、19 条稳定 socket 连接和最终验证。Blender 内部已有连续指纹、聚合 receipt、
LIFO 回退、失败补偿、强 Observation 与原生 Undo/Redo，但远程 replay 仍一次执行整个 action，MCP 客户端无法
沿可视树逐项驱动或观察同一操作轨迹。

Transform Geometry 的 operation-level 通道证明了四字段请求、服务端派生 ordinal、不可变 delivery、持久前缀和
显式恢复边界。Light Trails 需要复用该边界，同时解决两个新增问题：54 个微操作各自建立原生 checkpoint，最终
checkpoint 不会直接指向授权起点；Blender RNA 浮点 socket 使用 float32，不能与调用方输入的十进制 double 做
未经规范化的严格相等比较。

## 决策

冻结 `interaction-catalog-1.54.0.json`，发布仍绑定 ActionCatalog `1.26.0` 的 InteractionCatalog `1.55.0`。
当前 Light Trails recipe 的 menu 与 shortcut 保持 unavailable；MCP materialization 改为
`catalog.operation_level_mcp`，固定工具为：

- `operatingline.blender.geometry-nodes.light-trails.execute-next`
- `operatingline.blender.geometry-nodes.light-trails.status`

公开 execute 请求严格只有 `formatVersion`、`requestId`、`replayId` 和 `expectedState`。Runtime 从不可变 replay、
目录 materialization 与此前已认证成功前缀派生唯一的下一 ordinal、operation ID 和参数。调用方不能提交 action、
leaf、ordinal、节点、socket、RNA、Python 或 action 参数。历史目录保留原有 atomic action-level 权限；它们不会
继承 `1.55.0` 的逐操作权限，当前 Light Trails replay 也不能发送到通用 action executor。

共享 leaf-operation coordinator 同时支持 Transform 11 步与 Light Trails 54 步 profile。每个 delivery 绑定完整
operation ID 数组、目录/物化/MCP 内容哈希、派生参数、accepted Proposal、Plan、execution、Companion document
authority 和同一未推进的 state CAS。01–53 只提交同一 run/binding/receipt 的连续 fingerprint 与精确 graph-stage
Observation；54 通过完整 `light_trails_ready` success gate 后才发布唯一 `step_succeeded` report 并提交终态结果。

服务端按 Blender 实际 RNA 存储语义派生 float evidence。所有浮点 socket 预期值先转换为 IEEE-754 float32；因此
例如接受值 `0.22` 对应的证据是 Blender 实际返回的 `0.2199999988079071`，而不是放宽为容差或信任客户端舍入。
节点、连接、整数计数、完整 operation prefix 与 before/after SHA-256 仍保持严格相等。

## 原生 Undo lineage

每个微操作继续拥有独立 Blender 原生 checkpoint。Companion 的最终 checkpoint attestation 在 journal 中附带从
当前进程内历史根到当前 checkpoint 的唯一 `lineageCheckpointIds`。协议要求 ID 唯一，且最后两个 ID 必须分别等于
`previousCheckpointId` 与 `checkpointId`。

Runtime 在最终结果中找到 accepted replay 的授权起点，只接受从该起点开始、长度恰为 `operationCount + 1` 的
suffix。对 Light Trails 即授权起点加 54 个新 checkpoint；末端必须与最终 `next` checkpoint 的当前边完全一致。
这既保留逐操作 Undo，又避免把任意不相干的最终 checkpoint 当成 Start-to-Next 证明。缺失、重复、长度错误、起点
错误或末端错误的 lineage 全部 fail closed。

已派发但未确认的 operation 仍进入 `recovery_required`，不会自动重放。`prefix_restored`、`operation_applied` 与
`document_incarnation_retired` 继续使用 ADR 0108 的同文档、同 lease/document authority 和隔离规则。

## 验证

协议与协调器测试固定两种 profile、Light Trails 54 个唯一 operation ID、严格参数位置、请求 schema、完整持久前缀、
float32 stage evidence、lineage 唯一性/长度/末端负例，以及错误 profile/status 拒绝。Blender transport 与 Companion
测试覆盖第一项、最终项、混合 profile 拒绝和最终 report 顺序。

真实前台 E2E 在 Blender 4.5.3 LTS 与 5.1.1 均完成：

- accepted Proposal、Start 与目标创建后，连续 54 次 MCP queue、delivery、执行、result ACK；
- 最终 20 个节点、19 条连接、13,824 个 evaluated vertices；
- `light_trails_ready` semantic signature、link topology 与 vertex count 全部满足；
- 54 项 operation receipt、完整 checkpoint lineage、Bake 数量为 0；
- 调用方隐藏 ordinal、错误 Transform profile 和错误 status 查询均被拒绝。

## 结果与边界

Codex 或其它 MCP 客户端现在可以沿同一可视树远程执行并观察 Light Trails `01→54`，而不是生成任意 Blender
Python 或一次性创建后只看结果。该能力只授权当前目录中这一张固定拓扑；它不证明原生逐 socket 鼠标点击、任意
Geometry Nodes 图、任意 menu/shortcut 执行，亦不扩大 Edit Mode、Modifier、蒙皮、骨骼或动画覆盖。
