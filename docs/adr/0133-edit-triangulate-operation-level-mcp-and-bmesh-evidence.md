# ADR 0133：Edit Triangulate operation-level MCP 与 BMesh 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0038](0038-bounded-edit-triangulate.md)

## 背景

Triangulate Faces 已有有界 whole-action replacement Mesh executor。整叶调用无法让 ProcedureTree、
Guided Control 与训练数据看到 pending Mesh 创建、固定 triangulation 方法、BMesh 内容写入、命名和
Object data-link 发布的实际顺序。Blender 原生 Face 菜单是 in-place mutation，也不能表达 managed
replacement identity、receipt、Observation 和补偿边界。

## 决策

InteractionCatalog `1.65.0` 字节冻结 `1.64.0`，只把当前
`blender.mesh.edit_triangulate.semantic` 切换为六项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId` 与 `resultMeshId`，完成有界 preflight；
2. `semantic.select_owned_mesh` 显示并验证 receipt-owned 目标；
3. `mode.edit_mesh` 保留 Edit Mode 教学上下文；
4. `menu.face` 保留 Face 菜单教学上下文；
5. `operator.triangulate_faces` 创建 pending Mesh，并以固定 `FIXED`/`EAR_CLIP` 方法执行 BMesh triangulate；
6. `semantic.managed_triangulate_contract` 应用 accepted Mesh 名称并把目标 Object 的 data link 切换到结果。

只有 05/06 改变场景。受管执行器仍在 Object Mode 内完成 receipt-owned replacement transaction；
03/04 是教学上下文，不声称触发原生模式或菜单事件。执行器保存连续 fingerprint、partial receipt、
LIFO inverse、失败补偿与 native Undo/Redo rebind；06 完成后才允许发布强 `mesh_triangulated`
Observation 与正式 `step_succeeded`。

05 产生严格两项 `editTriangulateMeshOperations`：Mesh create 与 BMesh content write。content write
固定 `quadMethod=FIXED`、`ngonMethod=EAR_CLIP`，保存源 topology、源 loop 数 `L`、期望 topology
`[V, E+L-3F, L-2F]`、结果 topology、源内容保留、结果内容观察和全三角面证明。06 产生 Mesh name
write 与 Object data-link write。协议验证 variant、顺序、固定常量、identity、UI 语义路径和严格
topology 公式；Runtime 从不可变 replay 重建确定性字段，并将 operation 05 的动态 topology 与最终强
Observation 交叉核对。该切片不声称几何非退化性；成功门只声明实际验证过的内容、拓扑和全三角面性质。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过六步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成六次 delivery/result；factory Cube 从 `8/12/6` 精确生成
  `8/18/12`，源 Mesh 保持不变，强 Observation 与原生 checkpoint lineage 成立。
- Runtime 拒绝被篡改的目标绑定和结果 Mesh 名称；最终成功门将 operation 05 的 topology 收据与实际
  Blender Observation 交叉核对。
- 当前 whole-action MCP 集合为 10 项、operation-level MCP 为 12 项；冻结目录仍保留历史 Edit
  Triangulate whole-action 权限。
- 该证据证明固定 recipe 的 Blender data/BMesh mutation，不声称逐像素点击原生控件，也不开放任意选择集、
  任意 triangulation 方法、任意 Edit Mode 操作或通用 Python 执行。
