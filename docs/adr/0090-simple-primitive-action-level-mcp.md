# ADR 0090：简单 primitive 的 action-level MCP 执行

- 状态：已接受
- 日期：2026-08-20

## 背景

ADR 0089 首先为已接受的 UV Sphere replay 建立了严格 action-level MCP 执行链。该链不接受调用方提供的
Blender action、参数或 Python，而是从不可变 replay binding、人工接受结果、当前 Companion 状态和精确
InteractionCatalog 版本推导下一步动作。InteractionCatalog `1.34.0` 因此只授权 UV Sphere；代码能够识别
其他受管 primitive 不等于对应目录轨迹已经获得执行权限。

Icosphere、Cube 与 Plane 已分别具备受管 Action、强 Observation、补偿、原生 Undo checkpoint 和双 Blender
版本证明。它们可以复用同一执行工具与安全链，但仍必须通过新的目录版本逐项显式授权，不能修改或重新解释
`1.34.0` 的历史事实。

## 决策

InteractionCatalog `1.35.0` 冻结 `1.34.0`，并为以下四个 Action 声明
`catalog.action_level_mcp`：

- `blender.mesh.create_uv_sphere`；
- `blender.mesh.create_icosphere`；
- `blender.mesh.create_cube`；
- `blender.mesh.create_plane`。

四种 Action 都物化为唯一的 `operatingline.blender.action.execute` operation，使用
`accepted_leaf_action` 参数来源、accepted leaf 的完整 Action arguments、运行时
`requestId`/`replayId`/`expectedState` 占位和 Companion state report 结果绑定。公开 execute 请求仍只接受
格式版本、新 UUID request、replay ID 与精确 `{reportId, sequence}` CAS；调用方不能提交 action 名称、参数、
Plan/step ID、Blender operator 或 Python。

Runtime 必须按 replay 固定的 InteractionCatalog 版本重新验证 MCP materialization。`1.34.0` binding 仍只允许
UV Sphere；更早版本中 unavailable 的 Icosphere、Cube 或 Plane binding 不会因为活动目录升级而获得权限。
只有使用 `1.35.0` 精确物化、由原目标实例接受并 Start 的 replay 才能执行本次新增 Action。

授权范围扩大不改变 ADR 0089 的执行安全链：

1. Proposal、accepted decision 与 Start report 必须按服务端 receipt 顺序成立；
2. execute 必须匹配当前未移动的 Companion report CAS，且同一实例只有一个非终态请求；
3. dispatch 必须绑定当前有效 lease，结果必须来自同一 dispatch lease；
4. Runtime 只信任先接收、晚于 dispatch 且仍为最新状态的 Companion report；
5. 成功报告必须精确匹配 dispatched Action 的强 Observation kind、参数、顺序与 satisfied/supported 状态；
6. 成功必须提交唯一 step receipt 和对应的 `next` Blender 原生 Undo checkpoint，且它的
   `previousCheckpointId` 必须精确指向 execute CAS 所绑定 Start report 的 checkpoint；
7. dispatch 后重启或无法判定动作是否已发生时进入 `recovery_required`，不得自动重放。

## 证明边界

- `1.35.0` 只新增 Icosphere、Cube 与 Plane 的 action-level MCP 授权；UV Sphere 保持已有授权。
- Torus、Cone 与 Cylinder 在 `1.35.0` 中仍为 `unavailable`。它们必须在后续独立目录版本中完成各自的
  materialization、Observation、结果身份和双版本回放证明后才能授权。
- Edit Mode、Modifier、Geometry Nodes、蒙皮、权重、骨骼、动画、灯光、相机和渲染没有因本决策获得
  action-level MCP 权限。
- 成功状态证明 Companion 对已接受叶节点调用了 canonical Next 并提交了受信报告；它不证明 menu 或
  shortcut 数组被逐控件、逐按键执行，也不开放通用 Blender 自动化。
- 代码级七 primitive 白名单只是 fail-closed 的第二层边界。精确版本 Catalog 中的 available 声明仍是
  每个 replay 的授权来源。

## 验证

- 目录测试必须冻结并校验 `1.34.0` 的逐字内容与 hash，验证 `1.35.0` 只为 UV Sphere、Icosphere、Cube、
  Plane 声明 available MCP，并继续拒绝 Torus、Cone、Cylinder；
- materialization 测试必须逐 Action 验证唯一 server/tool、运行时占位、完整 accepted Action arguments、
  `accepted_leaf_action` 来源和 Companion report result binding；
- Runtime 集成测试必须对 Icosphere、Cube、Plane 分别覆盖接受、Start、lease、CAS、dispatch、强 Observation、
  trusted report、原生 Undo checkpoint 和成功终态；
- 负向测试必须证明旧 catalog binding、调用方注入 action/arguments、错误 Action 参数、过期 report、错误
  lease、Observation 不匹配、断开的 checkpoint 前驱及缺失 checkpoint 都会 fail closed；
- Blender 4.5.3 与 5.1.1 测试必须继续证明 canonical Next 产生与 accepted Action 和强 Observation 一致的
  Icosphere、Cube 与 Plane 结果。

## 后续

Torus、Cone 与 Cylinder 继续按独立证据批次激活，避免一次目录变更把不同拓扑和参数合同混成单一授权。
逐控件 menu/shortcut executor、七种 primitive 之外的 Action，以及 `recovery_required` 后的人工检查与重新入队
仍是独立工作，不从本 ADR 推导完成状态。
