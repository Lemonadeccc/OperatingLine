# ADR 0107：Edit Mode Subdivide 原生快捷键证明

- 状态：Accepted
- 日期：2026-08-23

## 背景

InteractionCatalog `1.43.0` 已把 Edit Mode Subdivide 表达为九步 candidate-only 快捷键轨迹，并把 `cuts`
和 `smooth` 放在有序的 F9 控件操作中。现有受管动作 `blender.mesh.edit_subdivide` 会复制源 Mesh、创建受管
replacement Mesh 并交换 object data；Blender 原生 `MESH_OT_subdivide` 则在 Edit Mode 中原地修改当前 Mesh。
二者不能共享 execution identity、receipt 或成功声明。

项目已有 Subdivision Surface 的四步 `Window.event_simulate` proof，但它固定在 Object Mode、单次 Undo 和
modifier-specific Observation。直接放宽该 schema 会允许 executor、action、operation、Observation 与 history
之间出现无效组合，也会让九步进度被旧四步状态机截断。

## 决策

冻结 `interaction-catalog-1.43.0.json`，发布 InteractionCatalog `1.44.0`。新增独立 executor：

`blender.mesh_edit_subdivide_f3_f9.event_simulate.v1`

它只授权 `factory_cube_single_user_mesh_8_12_6` profile，并固定九步顺序：

1. `TAB` 进入 Edit Mode；
2. `A` 选择全部可见 Mesh elements；
3. `F3` 并逐字符输入 `subdivide`；
4. `ENTER` 执行 `mesh.subdivide`；
5. `F9` 打开该 operator 的 Adjust Last Operation；
6. 定位 Number of Cuts，双击、`Ctrl+A`、输入 accepted `cuts` 并确认；
7. 定位 Smoothness，双击、`Ctrl+A`、输入 accepted `smooth` 并确认；
8. `ENTER` 关闭同一 F9 surface；
9. `TAB` 返回 Object Mode。

公开请求仍只包含 replay identity 与 Companion state CAS。Runtime 从不可变、已接受且已 Start 的 binding 派生
全部事件和参数；调用方不能提交 key、坐标、operator、Python 或 action arguments。协议按 `executorId` 判别两套
完整 binding、delivery、receipt、checkpoint、Observation 与 attestation，旧四步 proof 保持原样兼容；Coordinator
对新分支使用长度驱动的 `progressed` 事件，并要求完整九段 receipt/hash chain 后才允许成功。

新 proof 永久声明：

- managed action 未执行；
- managed ActionReceipt 未创建；
- managed replacement Mesh 未创建；
- native mutation 为 `in_place_edit_mesh_subdivide`。

首版 preflight 只接受 Layout/VIEW_3D/Object Mode、默认 Blender keymap、英文 UI、无 modal state、唯一 active 和
selected 的 factory `Cube`、单用户 `8/12/6` Mesh、全部 elements 可见、无 modifier 和 shape key。强 Observation
要求 object pointer、Mesh pointer 与 datablock 数量保持不变，最终回到 Object Mode，last operator 为
`MESH_OT_subdivide`，参数等于 binding，并同时绑定 topology、geometry 与 scene hashes。令 `n = cuts + 1`，factory
Cube 结果必须满足 `V = 6n² + 2`、`E = 12n²`、`F = 6n²`；geometry hash 防止只凭拓扑误接受错误 smoothness。

Blender 4.5.3 与 5.1.1 的前台探针均测得完整操作回到严格 baseline 需要四次 Undo，恢复精确 final 需要四次
Redo。因此新分支使用独立 `_operating_line_shortcut_proof_history_v2` marker，固定 `nativeUndoDepth = 4` 与
`nativeRedoDepth = 4`。锁、terminal reconciliation、history rebind 和失败恢复仍要求精确 delivery、receipt prefix、
marker hash、object/Mesh identity 与当前 scene fingerprint；任何恢复路径都不得重放九步输入。

## Blender 来源与验证范围

目标 operator 和搜索入口按 Blender 官方 tag 核对：

- [`space_view3d.py` 4.5.3](https://github.com/blender/blender/blob/v4.5.3/scripts/startup/bl_ui/space_view3d.py)
  与 [`space_view3d.py` 5.1.1](https://github.com/blender/blender/blob/v5.1.1/scripts/startup/bl_ui/space_view3d.py)
  均声明 `mesh.subdivide`；
- [`blender_default.py` 4.5.3](https://github.com/blender/blender/blob/v4.5.3/scripts/presets/keyconfig/keymap_data/blender_default.py)
  与 [`blender_default.py` 5.1.1](https://github.com/blender/blender/blob/v5.1.1/scripts/presets/keyconfig/keymap_data/blender_default.py)
  均把 `F3` 映射到 `wm.search_menu`。

双版本前台矩阵覆盖 `cuts/smooth = 1/0、2/0.5、8/1`，并验证同一 object/Mesh identity、无 replacement、参数化
geometry hash、四层 Undo baseline 与四层 Redo final。该证据不授权其它 Mesh、语言、keymap、Blender 版本、
Edit operator、菜单点击或 OS HID。

## 结果

- Edit Mode Subdivide 从结构化 candidate 轨迹升级为第二个有界、显式审批的原生 shortcut proof；projection 仍保留
  `candidate_only`，不声称与 managed action 等价。
- 受管 action-level MCP 仍可独立执行 replacement-mesh 事务；原生 proof 不产生其 receipt 或 identity。
- 两个 executor 共享的大型生命周期分支在 MCP `tools/list` 中以内部 JSON Schema reference 去重；Zod validation
  保持原样，完整 stdio 工具列表仍低于 SDK 默认单帧上限。
- 全 Blender 菜单/快捷键覆盖、任意 Mesh profile、其它 Edit/Geometry Nodes/骨骼动画逐控件 executor 与自动失败
  改参/语义重规划仍未开放。
