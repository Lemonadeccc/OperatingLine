# ADR 0129：Subdivision Surface operation-level MCP 与 Modifier RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0060](0060-bounded-subdivision-surface-modifier.md)

## 背景

Subdivision Surface 已有有界 whole-action executor 和四步原生快捷键候选证明，但整叶调用不能让树、
Guided Control 和训练数据看到受管 Modifier 创建、命名与固定属性写入的实际顺序。快捷键证明也明确不创建
managed receipt，因此不能替代 action-level 执行、强 Observation 或恢复证据。

## 决策

InteractionCatalog `1.61.0` 冻结 `1.60.0`，把当前
`blender.modifier.add_subdivision_surface.semantic` 切换为四项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId`、`modifierId` 并完成有界 preflight；
2. `semantic.select_owned_mesh` 显示并验证 receipt-owned 目标；
3. `operator.subdivision_set` 创建 receipt UUID 派生名称的 pending `SUBSURF` Modifier；
4. `semantic.subdivision_surface_contract` 写入 accepted name、`viewportLevel` 与固定完整属性集。

只有 03/04 改变场景。执行器使用 partial receipt、连续 fingerprint、LIFO inverse、失败补偿与 native
Undo/Redo rebind；04 完成后才允许发布强 `modifier_ready` Observation 与普通 `step_succeeded` 报告。
现有四步 `Ctrl+1 → F9 → Level → Enter` 快捷键轨迹继续保持 `candidate_only`，并与 managed rail 分离。

03 产生一条 `rnaSubdivisionSurfaceModifierMutations` 创建记录；04 产生严格的 15 条数组：先写名称，再按固定
顺序写 `subdivision_type`、accepted `levels`、render level、quality、control-edge、crease、limit-surface、
boundary/UV smoothing、custom normals 与可见性属性。协议验证 variant、顺序、值来源、常量、
`viewportLevel ∈ [1,3]`、跨记录 identity 与 UI 语义路径；Runtime 从 durable receipt 与 accepted replay 独立
重建完整数组并执行 canonical equality。Guided Control 以 `SUBDIVISION SURFACE RESOURCE RNA`、
`SUBDIVISION SURFACE PROPERTY RNA` 和 `03.01`/`04.01…04.15` 显示同一证据。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过四步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成四次 delivery/result、强 Observation 与原生 checkpoint lineage；Runtime 拒绝
  schema 合法但 modifier identity 或 viewport level 被篡改的收据，再接受原始 Blender 结果。
- 当前 action-level whole-action 集合减少为 14 项；冻结目录仍保留原有 Subdivision Surface whole-action 权限。
- 该证据证明固定 recipe 的 Blender 数据模型 mutation，不声称逐像素点击了 Modifier 面板，也不开放任意
  Modifier 类型、任意 RNA 字段或通用 Python 执行。
