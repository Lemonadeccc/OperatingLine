# ADR 0059：Edit Mode Subdivide F9 候选快捷键物化

- 状态：Accepted
- 日期：2026-08-15

## 背景

`blender.mesh.edit_subdivide` 已有 `semantic_path` 和受控执行器：managed action 会复制并标记新的 Mesh
datablock，再以 receipt 记录对象链接替换。Blender 原生 Edit Mode `mesh.subdivide` 则直接修改当前 Mesh。
两者的资源身份、所有权和回退语义不同，因此不能把原生菜单或快捷键写成 managed action 的等价执行轨迹。

同时，教学、检索和后续训练治理需要保留“进入 Edit Mode、选择全部元素、执行 Subdivide，再按顺序填写
Number of Cuts 与 Smoothness”的具体操作。只记录 `mesh.subdivide(cuts, smooth)` 会丢失搜索、`F9` surface、
控件顺序和模式切换。

## 决策

冻结 InteractionCatalog `1.21.0`，发布仍精确绑定 ActionCatalog `1.12.0` 的 `1.22.0`。
`blender.mesh.edit_subdivide` 保留 managed copy/swap `semantic_path`，并新增以下 candidate-only shortcut：

1. `TAB` 进入 Edit Mode；
2. `A` 选择全部可见 Mesh 元素；
3. `F3` 打开搜索，并输入 literal query `subdivide`；
4. `ENTER` 执行 `mesh.subdivide`；
5. `F9` 打开 `screen.redo_last`，来源 operation 为执行步骤，预期 operator 为 `mesh.subdivide`；
6. 把 accepted action 的 `cuts` 写入 `mesh.subdivide.number_cuts`；
7. 把 accepted action 的 `smooth` 写入 `mesh.subdivide.smoothness`；
8. `ENTER` 向同一 surface 发送关闭事件；
9. `TAB` 返回 Object Mode。

该轨迹要求 `Layout`、`VIEW_3D`、Object Mode、恰好一个已接受的目标 Mesh 处于 active/selected 状态、
Blender keymap、无 modal UI、所有目标网格元素可见、Mesh data users 为 `1`，且 UI Language 为 English。
`targetId` 由选择前置条件提供，不输入 Blender；`resultMeshId` 与 `resultMeshName` 因原生操作不会创建或
命名 managed replacement Mesh 而显式省略。菜单保持 unavailable，MCP 也因没有经过审批的 action-level
tool 而 unavailable。

协议与 Blender loader 允许 semantic recipe 的 `F9` opener 绑定唯一一个
`intent: execute`、`target.kind: operator` 的 guidance step。该放宽只确定 expected operator 的来源，不把
`semantic_path` 升级为原生或等价执行路径。

真实前台 harness 在 Blender 4.5.3 LTS 与 5.1.1 中逐事件回放上述九步，并设置 `cuts = 2`、
`smooth = 0.25`。两个版本最终均回到 Object Mode，得到 56 vertices、108 edges、54 polygons；操作前后
Mesh data pointer 与 `bpy.data.meshes` 数量均不变，证明原生路径修改当前 Mesh，而不是创建 managed
replacement datablock。Node launcher 在 Blender 退出码为零时仍校验结构化结果。

## 兼容性与边界

- `1.21.0` 保持逐字历史快照，其中 Subdivide 没有 `procedureMaterialization`。
- 新轨迹仍是 `candidate`、空 `validatedHostVersions` 与 `structural_only`。目录物化只生成有序教学投影，
  不执行 Blender、不保存 ProcedureTree、不创建 Proposal，也不绕过审批。
- 双版本回放证明九步 UI 轨迹可操作，并证明原生 in-place mutation 与 managed copy/swap 不同；它不证明
  managed collection、resource tag、receipt、幂等或补偿语义等价。
- harness 的断言与进程终止不是产品级 Observation 成功门、恢复策略或 Blender 原生 Undo 集成。
- `ENTER` 只表示已发送关闭事件；目录和测试不声称获得了 Blender 的独立 popup-closed 确认。

## 未选择方案

- **把原生菜单标记为 available**：原生菜单直接修改当前 Mesh，无法表达 replacement Mesh 身份与 receipt
  回退契约。
- **把 managed action 改成原地修改**：会破坏既有资源身份、Observation 和补偿边界。
- **把 `cuts` 与 `smooth` 合并到无序参数对象**：会丢失控件身份、输入顺序和 surface 生命周期。
- **把候选轨迹标记为 verified/executable**：当前证据不覆盖产品 Observation、恢复、Undo、审批和 managed
  action 等价。
