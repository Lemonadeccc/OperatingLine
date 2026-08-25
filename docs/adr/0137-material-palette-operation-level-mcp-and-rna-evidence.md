# ADR 0137：Material Palette operation-level MCP 与嵌套 Material RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0029](0029-bounded-edit-modifier-geometry-nodes.md)、
  [ADR 0136](0136-single-material-operation-level-mcp-and-rna-evidence.md)

## 背景

Material Palette 已有有界 managed action，可以一次创建 1–8 个 Principled Material，并把每个 target
最多分配一次；但 InteractionCatalog `1.68.0` 没有授予 MCP 执行权。只复用 Single Material 会丢失跨材质
数组顺序、每项参数归属、全局 target 唯一性和多个成功门，因此不能忠实表达“一个叶子包含整套 palette”的
教学与训练记录。把每个材质拆成独立场景 mutation 又会产生中间半成品，并破坏整叶原子补偿边界。

## 决策

InteractionCatalog `1.69.0` 字节冻结 `1.68.0`，只为当前
`blender.material.create_palette_and_assign.semantic` 增加四项 operation-level MCP：

1. `workspace.shading` 完成有界 preflight；
2. `panel.material_properties` 保留可见上下文；
3. `semantic.palette_entries` 在参数实际被教学和复核的位置携带唯一 `materials` 数组，但不改变场景；
4. `semantic.assign_targets` 一次性创建、配置并分配整个 accepted palette。

只有 04 改变场景。执行器先验证所有 Material identity/name、surface、目标 ownership/type 与跨数组唯一性，
再在一个事务中创建全部 Material、启用 Use Nodes、写入 Material/Principled surface，并按嵌套数组顺序替换
所有目标材质槽。任一异常都会比较并恢复全部原始 slots，删除本次创建的资源，并保留整叶可重试边界。

04 产生严格 `rnaMaterialPaletteMutations`。每个材质固定为
`create → use_nodes → Material RGBA/roughness/metallic → Principled RGBA/Roughness/Metallic → targets`，
即 `14 + targetCount` 条；所有材质再以连续全局 `order` 串联，同时保留从 1 开始的 `materialOrder`、
`materialMutationOrder` 和 `targetOrder`。协议允许最多 8×(14+64)=624 条记录并验证组边界、variant、顺序、
identity/name 唯一性与 target 全局唯一性。

Runtime 从 immutable replay 独立重建所有确定性字段，包括嵌套 accepted values、材质顺序和目标顺序；只从
schema-valid Blender 证据保留真实 before value、source Mesh ID 等宿主回读，再执行 canonical equality。
最终强门必须与 action 中每个有序 `material_assigned` Observation 一一对应，允许每个 Observation 证明该材质
accepted targets 的非空有序子集，但不允许交换 Observation、材质或目标顺序。当前状态证明对多 Observation
使用整个有序数组的 canonical hash。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 本地 integration 均通过两种材质、三个目标、31 条 RNA mutation、逐步
  forward/inverse/replay、强门、整叶 Back、材质/源 Mesh 篡改拒绝与 native Undo/Redo。
- 双版本 Companion E2E 均完成四次 delivery/result、四张 operation receipt、两个有序强 Observation 和完整
  checkpoint lineage；Runtime 在真实结果之前拒绝 schema-valid 的整组 material ID 与 roughness 篡改。
- 当前 whole-action MCP 集合仍为 9 项；operation-level MCP 增至 16 项，Procedure replay 允许集增至
  25 个 action。冻结的 `1.68.0` 对 Material Palette 仍没有 MCP 权限。
- Dock 会把 03 的具体数组和 04 的连续 `04.01→04.NN` RNA 序列显示在叶内，但该证据只证明固定 recipe 的
  Blender RNA mutation，不声称逐像素点击 Material Properties/Shader Editor，也不开放任意 Shader 图、任意
  Material 字段、任意 target 类型或通用 Python 执行。
