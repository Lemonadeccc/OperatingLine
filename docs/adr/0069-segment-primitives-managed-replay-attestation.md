# ADR 0069：Cone/Cylinder 线段框架受管回放证明

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0065–0068 已证明五种 primitive 的受管 Procedure 叶节点回放。Cone 与 Cylinder 已有确定性
`bmesh.ops.create_cone` 执行、世界空间 start/end 语义、版本化 ordered menu、补偿回退和 Blender 4.5/5.1
原生 operator 探针，但只有 `resource_exists` 不能证明半径、方向、端点或退化拓扑正确。

两种动作不使用普通 primitive 的 `location + identity rotation` 参数形状：执行器把对象放在端点中点，并用
`direction.to_track_quat("Z", "Y")` 把局部 Z 轴对准 start→end。Cone 还允许恰好一个端点半径为零，Blender
会把该端的 32 顶点环折叠为一个 apex，因此拓扑不能固定写成锥台数量。

## 决策

`ProcedureLeafReplay 1.0.0` 的封闭白名单增加：

- `blender.mesh.create_cone` → `cone_ready`；
- `blender.mesh.create_cylinder` → `cylinder_ready`。

提案继续要求单 leaf、目录重新物化、人工 GuideProposal 审批、`success_gate + rollback_step`、补偿回退和
同 lease receipt 顺序。Observation 参数必须逐字段等于 Action；Cone 使用 `radiusStart/radiusEnd/start/end`，
Cylinder 使用 `radius/start/end`。

ActionCatalog 冻结 `1.21.0` 并发布 `1.22.0`，只为两种 action 增加强 Observation；InteractionCatalog
冻结 `1.31.0` 并发布 `1.32.0`，recipe 内容逐字不变，只更新 ActionCatalog binding。

## 强 Observation

共享 evaluator 继续核对唯一 receipt、Collection/Object/Mesh ownership、三项精确 mutation、Object→Mesh、
managed Collection link、名称、单位 scale、隔离 transform、无 modifier/shape key/material、有限坐标和 Mesh
内容签名。

线段 primitive 另要求：

- 对 start/end 求中点并核对对象 location；
- 复算 `to_track_quat("Z", "Y")` 并核对实际 basis rotation；
- 将局部 `(0,0,±depth/2)` 变换回对象 basis，分别精确落在 accepted start/end；
- 对局部 `-Z/+Z` 两端逐点复算固定 32 段圆环坐标，并核对 cap/side 面形；
- 锥台和 Cylinder 固定为 `64 vertices / 96 edges / 34 faces`；单端半径为零的 Cone 固定为
  `33 vertices / 64 edges / 33 faces`，并验证 start-apex 与 end-apex 两种方向。

Blender 4.5.3 与 5.1.1 的测试覆盖斜向端点、锥台、两种尖锥、圆柱、缺失/额外/布尔/重合端点参数，以及
location、rotation、顶点和 receipt action 篡改。

## 证明范围

Cone 与 Cylinder 的 InteractionCatalog shortcut 和 MCP 都没有经过 action-level 执行验证，因此 binding 与
attestation 明确保留 `unavailable`。证据只验证 Companion 上报的受管 Action 结果；menu 仍为
`catalog_grounded_not_executed`，不证明逐控件 UI、真实键盘事件、原生 Undo checkpoint 或 attestation 后的
当前场景状态。

## 兼容性与后续

- 历史 ActionCatalog `1.21.0` 与 InteractionCatalog `1.31.0` 保存为逐字冻结快照。
- replay 数据库 schema 与 envelope format 不变，无需迁移。
- 后续扩展到复合 primitive、Edit Mode、Modifier、Geometry Nodes、蒙皮和动画时，应为每类 action 定义同等
  强度且与执行器事实一致的 Observation，不能把 `resource_exists` 当成结果证明。

## 未选择方案

- **只检查对象、半径或拓扑**：无法发现方向、端点或局部环坐标错误。
- **始终要求 `64/96/34`**：会错误拒绝合法的单端尖锥。
- **把 menu recipe 当作 UI 执行证据**：目录只提供结构化教学轨迹，并未执行真实控件。
