# ADR 0066：Icosphere 受管 Procedure 叶节点回放证明

- 状态：Accepted
- 日期：2026-08-17

## 背景

ADR 0065 已把单一 UV Sphere 叶节点的目录物化、人工审批、受管 Action、同 lease Companion report 和
追加式 attestation 连成一条可审计链，但 replay 合同仍写死一个 action 与一种强 Observation。Icosphere
已经具备版本化菜单、候选快捷键、确定性受管 Action 和补偿回退，是验证该桥接能否安全扩展到第二种几何
动作的最小边界。

`resource_exists` 仍不足以证明 Icosphere 的细分级别、拓扑、半径、变换和 Mesh 内容。若只复用 UV Sphere
的固定拓扑，细分参数与执行结果之间也无法建立证明关系。

## 决策

`ProcedureLeafReplay 1.0.0` 保持版本不变，并把受管 action 白名单扩展为：

- `blender.mesh.create_uv_sphere` → `uv_sphere_ready`；
- `blender.mesh.create_icosphere` → `icosphere_ready`。

提案阶段仍要求整棵物化树恰好一个可执行 leaf、一个 catalog-grounded menu、一个 candidate shortcut、
明确 unavailable 的 MCP track、`success_gate + rollback_step` 和 `compensating_action`。协调器按 action
选择唯一允许的 Observation 和精确参数集合，不能在两种 Observation 之间替换，也不能以任意字符串扩展
action 白名单。

ActionCatalog 冻结 `1.18.0` 并发布 `1.19.0`，只为 Icosphere 增加 `icosphere_ready`；InteractionCatalog
冻结 `1.28.0` 并发布 `1.29.0`，recipe 内容保持逐字一致，只更新精确 ActionCatalog binding。

## 强 Observation

Blender evaluator 复用球形 primitive 的 ownership、receipt、data/link/content mutation、名称、位置、
实际 basis rotation、单位 scale/delta、隔离状态、无 modifier/shape key/material、有限坐标、半径和 Mesh
内容签名证明。Icosphere 另要求参数恰好包含 `resourceId`、`objectName`、`subdivisions`、`radius`、
`location`，其中 `subdivisions` 必须是 `1..5` 的整数。

对于细分级别 `n`，attestation 要求：

- 顶点数 `10 × 4^(n-1) + 2`；
- 边数 `30 × 4^(n-1)`；
- 面数 `20 × 4^(n-1)`。

协议 Zod 合同、协调器 finalize 和 Blender evaluator 都独立执行该约束。双版本 Blender 集成测试覆盖正常
执行和补偿，并拒绝缺失、额外、布尔或越界细分参数、Mesh 内容篡改、action tag 篡改和 receipt action
不匹配。Orchestrator 集成测试还证明错误拓扑不能 finalize，正确三级细分 `162/480/320` 才能生成
attestation。

## 证明范围

证据类别和边界不变：只把 Companion 上报的受管 Action 结果标为 `verified`；menu 仍为
`catalog_grounded_not_executed`，shortcut 仍为 `candidate_not_executed`，MCP 仍为 `unavailable`。本扩展
不证明逐控件 UI、真实键盘事件、action-level MCP、Blender 原生 Undo checkpoint，也不证明 attestation
之后的当前场景仍保持成功状态。

## 兼容性与后续

- 历史 ActionCatalog `1.18.0` 与 InteractionCatalog `1.28.0` 保存为逐字冻结快照；旧 replay 行为不变。
- replay 数据库 schema 和 `ProcedureLeafReplay` format 均不变，无需迁移。
- 下一步仍需真实 menu/shortcut executor、action-level MCP executor、Undo checkpoint/恢复/current-state
  证明，以及 UV Sphere/Icosphere 之外的 Action 覆盖。

## 未选择方案

- **接受所有 Blender action 名称**：缺少逐 action 的强 Observation、结果形状和恢复证明，不能安全泛化。
- **只检查 Icosphere 对象存在**：无法把 accepted `subdivisions`、拓扑和内容绑定到结果。
- **把候选快捷键或 catalog menu 记为 executed**：受管 Session action 不证明具体 UI operation 被执行。
