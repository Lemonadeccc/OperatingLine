# ADR 0125：Armature 资源、骨骼与刚性绑定 RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0113](0113-armature-operation-level-mcp.md)

## 背景

Armature 的九步执行器已经使用受管 receipt、连续 fingerprint、失败补偿与原生 Undo lineage 完成
operation 02/03/04/06/08，但成功观察只报告资源、骨骼和绑定的汇总状态。它没有把 pending Object/Data
创建、collection link、两个名称写入、每根 EditBone 的参数和父子关系、PoseBone rotation mode，以及每条
rigid binding 的真实 RNA 顺序保存为可训练、可显示、可由 Runtime 独立核对的叶内数组。

## 决策

固定 Armature recipe 现在产生三类严格证据：

1. `rnaArmatureResourceMutations`：operation 02 按 `.01 Armature Data create → .02 Object create/data bind →
.03 Collection link` 保存由 receipt UUID 前八位确定的 pending identity；operation 03/04 各保存一条
   pending-before、accepted 与 observed name write。
2. `rnaArmatureBoneMutations`：operation 06 先按 accepted bones 数组顺序保存每根 EditBone 的 name、head、tail
   与 `use_deform=false`，再保存非根骨骼的 parent write，最后按同一骨骼顺序保存 PoseBone
   `rotation_mode=XYZ`。Blender float32 坐标作为 observed 值逐项读回。
3. `rnaArmatureBindingMutations`：operation 08 按 accepted bindings 数组顺序保存 target、Armature、bone、
   `parent_type=BONE`、实际 parent bone 与 world matrix 保持证明。

每条记录绑定固定 MCP、source operation、semantic action、值来源、logical identity、实际读回值和稳定 UI
语义路径。协议验证严格 variant、阶段顺序、跨记录 identity、accepted/observed 一致性与数组顺序；Runtime 从
durable receipt ID 和 accepted replay 独立派生当前 operation 的完整数组并执行 canonical equality。字段对历史
结果保持可选，但新派发 Armature operation 必须提供当前精确数组，非目标 operation 必须为空。

Guided Control 对应显示 `ARMATURE RESOURCE RNA`、`BONE RNA` 与 `BINDING RNA`，并以
`02.01…`、`06.01…`、`08.01…` 展开接受值和目标。该轨迹证明 Blender 数据模型 mutation，不声称鼠标点击了
Layout/Add Armature、Object/Data Properties、Edit/Pose Mode 或 Parent 控件。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均通过九步正向、九步逆向、逐项重放、完成与整叶 Back，
  并核对精确资源、五条骨骼 mutation 和刚性 binding 数组。
- 双版本 Companion E2E 均完成九次 delivery/result、强 `armature_ready` 与原生 checkpoint lineage；Runtime
  分别拒绝结构合法但 Armature identity 被篡改的资源、骨骼和 binding 收据，再接受原始真实收据。
- 本决策只覆盖固定两骨骼测试 recipe 可推广的有界数组契约；真实逐控件菜单/快捷键事件、任意 rig、约束、IK、
  自动权重、复杂骨架与通用动画 executor 仍需分别扩展。
