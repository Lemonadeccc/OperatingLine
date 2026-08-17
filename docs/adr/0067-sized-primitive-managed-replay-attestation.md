# ADR 0067：Cube 与 Plane 受管 Procedure 叶节点回放证明

- 状态：Accepted
- 日期：2026-08-17

## 背景

ADR 0065/0066 已验证同一受管 replay 链可以安全支持两种球体，但 Cube 与 Plane 的 accepted 参数是完整边长
`size`，不能复用顶点半径判断。两种动作已经具备版本化菜单、候选快捷键、确定性受管 Action 和补偿回退，
因此适合作为第一批非球形 primitive 证明。

只检查对象存在或固定拓扑仍不足够：错误边长的 Cube 与 Plane 可以拥有完全相同的顶点/边/面数量；只检查
Object dimensions 也可能受到未应用 scale 影响，无法证明受管 Mesh 内容本身与 accepted `size` 一致。

## 决策

`ProcedureLeafReplay 1.0.0` 的封闭白名单增加：

- `blender.mesh.create_cube` → `cube_ready`；
- `blender.mesh.create_plane` → `plane_ready`。

提案阶段仍要求单 leaf、目录重新物化、人工 GuideProposal 审批、`success_gate + rollback_step`、补偿回退和
同 lease receipt 顺序。两种新 Observation 的参数必须恰好等于 Action 的 `resourceId`、`objectName`、
`size`、`location`，不能与球体 Observation 互换。

ActionCatalog 冻结 `1.19.0` 并发布 `1.20.0`，只为 Cube/Plane 增加各自的强 Observation；
InteractionCatalog 冻结 `1.29.0` 并发布 `1.30.0`，recipe 内容逐字不变，只更新 ActionCatalog binding。

## 强 Observation

共享 evaluator 继续核对唯一 receipt、Collection/Object/Mesh ownership、三项精确 mutation、Object→Mesh、
managed Collection link、名称、location、实际 basis rotation、单位 scale/delta、无 parent/constraint/
modifier/shape key/material、有限坐标和 Mesh 内容签名。

Cube 另要求 `8/12/6` 顶点/边/面，并要求每个局部坐标分量的绝对值都等于 `size / 2`。Plane 要求
`4/4/1`，每个顶点的局部 `|x|`、`|y|` 等于 `size / 2` 且 `z = 0`。因此证明的是已 bake 到 Mesh 的
accepted 全边长，而不是依赖 Object scale 的视觉近似。

Blender 4.5.3/5.1.1 集成测试覆盖两种正常执行、错误/额外/布尔 size、坐标篡改、action tag 与 receipt
action 篡改，以及 Back 补偿。Orchestrator 集成测试分别拒绝错误拓扑，并只为正确 Cube `8/12/6` 与
Plane `4/4/1` 生成追加式 attestation。

## 证明范围

证据边界不变：只验证 Companion 上报的受管 Action 结果。menu 仍为
`catalog_grounded_not_executed`，shortcut 仍为 `candidate_not_executed`，MCP 仍为 `unavailable`。本切片
不证明逐控件 UI、真实键盘事件、action-level MCP、原生 Undo checkpoint 或 attestation 后的当前场景状态。

## 兼容性与后续

- 历史 ActionCatalog `1.19.0` 与 InteractionCatalog `1.29.0` 保存为逐字冻结快照。
- replay 数据库 schema 与 envelope format 不变，无需迁移。
- 后续仍需覆盖 Torus、Cone、Cylinder 与复合动作，并独立实现 UI/MCP executor、Undo checkpoint、失败
  恢复和 current-state 证明。

## 未选择方案

- **复用 `radiusMatches`**：Cube/Plane 没有单一顶点半径语义。
- **只验证 Object dimensions**：未应用 scale 也能产生相同 dimensions，不能证明 Mesh 内容。
- **把已有菜单或候选快捷键标成 executed**：受管 Session action 不证明具体 UI operation 的轨迹。
