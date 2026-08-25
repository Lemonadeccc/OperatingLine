# ADR 0136：Single Material operation-level MCP 与 Material RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0029](0029-bounded-edit-modifier-geometry-nodes.md)

## 背景

Single Material 已有有界 managed action，但 InteractionCatalog `1.67.0` 没有为它授予 whole-action 或
operation-level MCP。四步语义路径只能显示 Shading、Material Properties、New 与 Surface，无法让
ProcedureTree、Guided Control、Runtime 与训练数据共同核对 Material 创建、具体 surface 参数以及按序多目标
材质槽替换。原生菜单和快捷键也不能承载 accepted logical identity、`OBJECT[]` 消费者授权、源 Mesh 内容证明、
Observation 与补偿边界。

## 决策

InteractionCatalog `1.68.0` 字节冻结 `1.67.0`，只为当前
`blender.material.create_and_assign.semantic` 增加四项 operation-level MCP：

1. `workspace.shading` 绑定 `materialId` 并完成有界 preflight；
2. `panel.material_properties` 保留可见上下文；
3. `control.new_material` 创建 receipt UUID 派生名称的 pending Material，并启用 Use Nodes；
4. `semantic.principled_surface` 按序消费 `materialName`、`baseColor`、`roughness`、`metallic` 与 `targets`，
   同步 Material/Principled surface，再按 accepted target 顺序替换每个 Object 的材质槽。

只有 03/04 改变场景。执行器保存连续 fingerprint、一个 partial receipt、LIFO inverse、失败补偿和 native
Undo/Redo rebind；04 完成后才允许发布强 `material_assigned` Observation 与正式 `step_succeeded`。

03 产生两条严格 `rnaMaterialMutations`：Material create 与固定 `use_nodes=true` write。04 产生
`13 + targetCount` 条严格记录：先写 accepted name；再按固定顺序写 Material diffuse color 的 RGBA、roughness、
metallic，以及 Principled BSDF Base Color 的 RGBA、Roughness、Metallic；最后按 accepted `targets` 顺序写入
每条 material-slot replacement。每条记录绑定 MCP、source operation、logical material/target identity、值来源、
before/accepted/observed 值与稳定 UI 语义路径。协议验证 variant、顺序、数量和跨记录 identity；Runtime 从
accepted replay 独立重建 identity、accepted values 和 target order，只从 schema-valid Blender evidence 接受
真实 pre-value/source Mesh ID，再执行 canonical equality。

最终强 Observation 同时核对 accepted material ID/name/surface、唯一 Principled BSDF 与 Material Output、
ordered assignments、ownership、receipt、source-content preservation 和完整四步 operation receipt。Planning
quality 要求每个 target 都以 exact `OBJECT[]` consumer authority 出现，且 action、authority 与 Observation 的
target 顺序一致。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过四步 forward/inverse、逐项 replay、完成与整叶 Back。
- 双版本 Companion E2E 均完成四次 delivery/result、四张 operation receipt、双目标有序 assignment、强
  Observation 与完整 native checkpoint lineage；Runtime 拒绝 Material identity、surface 值或证据被篡改的结果。
- 当前 whole-action MCP 集合仍为 9 项；operation-level MCP 增至 15 项，Procedure replay 允许集增至
  24 个 action。冻结的 `1.67.0` 对 Single Material 仍没有 MCP 权限。
- 该证据证明固定 recipe 的 Blender RNA 数据模型 mutation，不声称逐像素点击 Material Properties/Shader
  Editor 控件，也不开放任意 Shader 节点图、任意 Material 字段、任意 target 类型或通用 Python 执行。
