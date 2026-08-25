# ADR 0130：Edit Bevel operation-level MCP 与 BMesh 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0061](0061-bounded-edit-mode-bevel-edges.md)

## 背景

Edit Bevel 已有有界 whole-action replacement Mesh executor，以及十步原生快捷键候选轨迹。整叶调用无法让
ProcedureTree、Guided Control 与训练数据看到参数投影、BMesh 写入、命名和 Object data-link 发布的实际顺序；
快捷键轨迹则是原生 in-place mutation，不创建 managed receipt 或 replacement Mesh，不能代替受管执行证明。

## 决策

InteractionCatalog `1.62.0` 字节冻结 `1.61.0`，把当前
`blender.mesh.edit_bevel_edges.semantic` 切换为六项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId` 与 `resultMeshId`，完成有界 preflight；
2. `semantic.select_owned_mesh` 显示并验证 receipt-owned 目标；
3. `mode.edit_mesh` 保留 Edit Mode 教学上下文；
4. `menu.edge` 保留 Edge 菜单教学上下文；
5. `operator.bevel_edges` 创建 pending Mesh，投影 `width`、`segments`、`profile`，再执行固定 BMesh bevel；
6. `semantic.managed_bevel_edges_contract` 应用 accepted Mesh 名称并把目标 Object 的 data link 切换到结果。

只有 05/06 改变场景。受管执行器仍在 Object Mode 内完成 receipt-owned replacement transaction；03/04 是诚实的
教学上下文，不声称触发原生模式或菜单事件。执行器保存连续 fingerprint、partial receipt、LIFO inverse、失败补偿与
native Undo/Redo rebind；06 完成后才允许发布强 `mesh_edges_beveled` Observation 与正式 `step_succeeded`。
现有 `TAB → 2 → A → Ctrl+B → F9 → Width → Segments → Profile → ENTER → TAB` 继续保持
`candidate_only`，与 managed rail 分离。

05 产生严格五项 `editBevelMeshOperations`：Mesh create、三项 accepted 参数投影，以及 BMesh content write。
content write 固定 `OFFSET`、`EDGES`、clamp/slide/seam/sharp/material/normals/face-strength/miter/spread/
vmesh 完整常量，并保存源/结果 topology 与源内容保留证明。06 产生 Mesh name write 与 Object data-link write。
协议验证 variant、顺序、参数范围、accepted/observed 值、固定常量、identity、UI 语义路径与严格 topology growth；
Runtime 从不可变 replay 独立重建确定性字段，只接受 schema 验证后的动态 topology，再将 operation 05 的 topology 与
最终强 Observation 交叉核对。Guided Control 以 `EDIT BEVEL MESH RNA`、`EDIT BEVEL CONTRACT RNA` 和
`05.01…05.05`/`06.01…06.02` 显示同一证据。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过六步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成六次 delivery/result；factory Cube 从 `8/12/6` 生成 `96/192/98`，源 Mesh
  保持不变，强 Observation 与原生 checkpoint lineage 成立。
- Runtime 拒绝 schema 合法但 accepted bevel 参数或结果 Mesh 名称被篡改的收据，再接受原始 Blender 结果。
- `1.62.0` 发布时 whole-action MCP 集合为 13 项、operation-level MCP 为 9 项；冻结目录仍保留历史
  Edit Bevel whole-action 权限。当前计数由后续 [ADR 0131](0131-edit-inset-operation-level-mcp-and-bmesh-evidence.md)
  更新为 12/10。
- 该证据证明固定 recipe 的 Blender data/BMesh mutation，不声称逐像素点击原生控件，也不开放任意选择集、
  任意 BMesh operator、任意 Edit Mode 操作或通用 Python 执行。
