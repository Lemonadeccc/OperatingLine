# ADR 0126：Skin Weights 权重与 Armature Modifier RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0114](0114-skin-weights-operation-level-mcp.md)

## 背景

Skin Weights 九步执行器已经通过受管 partial receipt、连续 fingerprint、LIFO inverse、失败补偿和原生 Undo
lineage 完成 operation 05/07/08，但成功观察只报告 Vertex Group、权重和 Modifier 的汇总状态。它没有把每根
引用骨骼的 deform 写入、Vertex Group 创建、每个顶点的每条 influence，以及 Armature Modifier 的创建、对象
绑定、属性配置和最终名称写入保存成可训练、可显示、可由 Runtime 独立核对的叶内数组。

## 决策

固定 Skin Weights recipe 现在产生两类严格证据：

1. `rnaSkinWeightMutations`：operation 05 先按 accepted weights 中骨骼首次出现顺序保存每根骨骼的
   `use_deform=true`，再按同序保存 Vertex Group 创建，最后按 accepted vertex/influence 双层数组顺序保存
   `VertexGroup.add(..., "REPLACE")`。每条 assignment 包含 vertex/group/bone、accepted weight、Blender
   membership 的实际 float32 回读和稳定 UI 语义路径。
2. `rnaSkinModifierMutations`：operation 07 按 `.01 Armature Modifier create → .02 Armature object bind →
.03 use_vertex_groups=true → .04 use_bone_envelopes=false → .05 use_deform_preserve_volume=<accepted>` 保存
   receipt UUID 前八位确定的 pending identity；operation 08 保存 pending-before、accepted 与 observed name
   write。

每条记录绑定固定 MCP、source operation、semantic action、值来源和 logical identity。协议验证 variant、阶段与
数组顺序、跨记录 identity、accepted/observed 一致性和 UI 路径；Runtime 从 durable receipt ID 与 accepted
replay 独立重建当前 operation 的完整数组并执行 canonical equality。字段对历史结果保持可选，但新派发 Skin
Weights operation 必须提供当前精确数组，非目标 operation 必须为空。

Guided Control 对应显示 `SKIN WEIGHT RNA` 与 `SKIN MODIFIER RNA`，以 `05.01…`、`07.01…`、`08.01…`
展开骨骼、顶点、权重、Modifier 和属性。该轨迹证明 Blender 数据模型 mutation，不声称鼠标点击了 Object Data、
Weight Paint 或 Modifier 面板控件。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的真实 integration 均通过九步正向、九步逆向、逐项重放、完成与整叶 Back；当前
  双骨骼八顶点测试轨迹在 operation 05 核对 2 条 deform write、2 条 Vertex Group create 和 8 条 weight
  replace，在 operation 07/08 核对 5 条 create/configure 与 1 条 name write。
- 双版本 Companion E2E 均完成九次 delivery/result、强 `skin_weights_ready` 与原生 checkpoint lineage；
  Runtime 拒绝结构合法但 Armature identity 或 Modifier identity 被篡改的两类收据，再接受原始真实收据。
- 本决策只覆盖固定显式权重 recipe 的有界数组契约；逐控件菜单/快捷键事件、自动权重、刷权重、任意蒙皮、
  复杂变形器和通用 rig executor 仍需分别扩展。
