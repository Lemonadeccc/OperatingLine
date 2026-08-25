# ADR 0134：Extrude Region operation-level MCP 与选区/BMesh 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0041](0041-bounded-edit-extrude-region.md)

## 背景

Extrude Region 已有有界 whole-action replacement Mesh executor，但整叶调用不会向 ProcedureTree、
Guided Control 或训练数据暴露面区域选择、平移参数消费、pending Mesh 创建、BMesh 内容写入、命名和
Object data-link 发布的实际顺序。Blender 原生 Face 菜单操作是 in-place mutation，也不能表达 managed
replacement identity、receipt、Observation 与补偿边界。

## 决策

InteractionCatalog `1.66.0` 字节冻结 `1.65.0`，只把当前
`blender.mesh.edit_extrude_region.semantic` 切换为六项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId` 与 `resultMeshId`，完成有界 preflight；
2. `semantic.select_owned_mesh` 显示并验证 receipt-owned 目标；
3. `mode.edit_mesh` 保留 Edit Mode 教学上下文；
4. `semantic.select_face_region` 消费 `polygonIndices`，验证唯一、连通且存在边界的面区域；
5. `operator.extrude_region_move` 创建 pending Mesh，以 `bmesh.ops.extrude_face_region` 生成区域，并按
   accepted `translation` 平移所有新顶点；
6. `semantic.managed_extrude_region_contract` 应用 accepted Mesh 名称，并把目标 Object 的 data link
   切换到结果。

只有 05/06 改变场景。受管执行器仍在 Object Mode 内完成 receipt-owned replacement transaction；
03/04 是可见教学与确定性选区验证，不声称触发原生模式或菜单事件。执行器保存连续 fingerprint、
partial receipt、LIFO inverse、失败补偿与 native Undo/Redo rebind；06 完成后才允许发布强
`mesh_region_extruded` Observation 与正式 `step_succeeded`。

04 产生一项严格 selection projection，保存 accepted/observed polygon indices、源 topology，以及选区的
face、edge、vertex 与 boundary-edge 计数。05 产生三项严格证据：Mesh create、translation projection 与
BMesh content write。对源 topology `[V,E,F]`，结果必须精确满足：

`[V + selectedVertexCount, E + selectedEdgeCount + boundaryEdgeCount, F + boundaryEdgeCount]`

06 产生 Mesh name write 与 Object data-link write。协议验证每个 variant、顺序、identity、参数、UI 语义
路径和 topology 公式；Runtime 从不可变 replay 重建确定性字段，并将 operation 04/05 的动态选区与
topology 收据同最终强 Observation 交叉核对。whole-action 路径也额外记录源 Mesh 内容 before/after 相等，
使源数据保留成为正式收据的一部分。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过六步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成六次 delivery/result；factory Cube 的单面选区计数为 `1/4/4/4`，并从
  `8/12/6` 精确生成 `12/20/10`，源 Mesh 保持不变，强 Observation 与原生 checkpoint lineage 成立。
- Runtime 拒绝被篡改的目标绑定和结果 Mesh 名称；最终成功门将 operation 04/05 的选区与 topology
  收据同实际 Blender Observation 交叉核对。
- 当前 whole-action MCP 集合为 9 项、operation-level MCP 为 13 项；冻结目录仍保留历史 Extrude Region
  whole-action 权限。
- 该证据证明固定 recipe 的 Blender data/BMesh mutation，不声称逐像素点击原生控件，也不开放任意
  选择集、任意 Edit Mode 操作或通用 Python 执行；本切片不额外声明几何非退化性。
