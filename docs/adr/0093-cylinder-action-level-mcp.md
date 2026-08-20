# ADR 0093：Cylinder 的 action-level MCP 执行

- 状态：已接受
- 日期：2026-08-20

## 背景

InteractionCatalog `1.37.0` 已显式授权 UV Sphere、Icosphere、Cube、Plane、Torus 与 Cone。Cylinder 虽在
代码级七 primitive 白名单内，并已有 managed Action、补偿、原生 Undo 和强 `cylinder_ready` Observation，
但其 `1.37.0` MCP declaration 仍为 unavailable；白名单不能代替版本化目录授权。

Cylinder 的 accepted 参数不是一个 Blender operator 参数包，而是 `resourceId`、`objectName`、世界空间
`start`、`end` 与 `radius`。managed executor 从端点计算中点、方向 Quaternion 和长度，再确定性构造 32 段
局部环。强 Observation 复算世界端点、局部坐标与面形，并要求固定 `64/96/34` 顶点/边/面拓扑。

## 决策

冻结 InteractionCatalog `1.37.0`，发布仍精确绑定 ActionCatalog `1.22.0` 的 `1.38.0`。新版本只把
`blender.mesh.create_cylinder` 的 MCP declaration 改为与既有授权 primitive 相同的
`catalog.action_level_mcp`；其它二十个 action 保持 unavailable。

Cylinder leaf 物化为唯一 `operatingline.blender.action.execute` operation。公开请求仍只携带格式版本、新 UUID
request、replay ID 和精确 `{reportId, sequence}` CAS；Runtime 从 immutable accepted leaf 派生完整 action
与参数，调用方不能提交或覆盖 action、端点、半径、Plan/step ID、operator 或 Python。

成功结果必须满足既有安全链：Proposal → accepted decision → Start receipt 顺序、同一协商 lease、未移动
CAS、晚于 dispatch 的最新 report、与 replay finalize 共用的强 `cylinder_ready` validator，以及直接引用
Start checkpoint 的 `next.previousCheckpointId`。缺失端点/geometry 证明、错误拓扑或断开的 Undo 链均 fail
closed；不确定投递进入 `recovery_required`，不自动重放。

## 证明边界

- `1.37.0` Cylinder binding 仍为 unavailable；active 目录升级不修改已存 replay 的权限。
- Cylinder 的 ordered menu 是 teaching projection。它把端点派生为 canonical zero-roll XYZ Euler，而 managed
  executor 使用 Quaternion；二者不等价，action-level MCP 成功不证明菜单控件被执行。
- Cylinder shortcut 仍 unavailable，七 primitive 之外的 action 没有因本决策获得 action-level MCP 权限。
- `action.status=succeeded` 通过完整强几何和原生 Undo 门，但不是追加式 replay attestation，也不证明报告后的
  当前宿主状态。

## 验证

- 冻结 `1.37.0` 的逐字内容与 SHA-256，并证明 `1.38.0` 只改变版本和 Cylinder MCP declaration；
- materialization 验证唯一 tool、运行时占位、accepted `start/end/radius` 等完整参数和结果绑定；
- Runtime 集成覆盖 accepted/Start/lease/CAS/exact delivery、强 `cylinder_ready`、Start→Next checkpoint 与
  succeeded；
- 冻结 `1.37.0` Cylinder replay 在完成同样前置条件后仍被 execute 拒绝；
- Blender 4.5.3 与 5.1.1 继续验证端点、环坐标、拓扑、Observation 与回退。

## 后续

逐控件 menu/shortcut executor、七 primitive 之外的 Action，以及 `recovery_required` 后的人工检查与重新入队仍
是后续工作。
