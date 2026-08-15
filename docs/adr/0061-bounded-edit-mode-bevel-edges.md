# ADR 0061：有界整网格 Edit Mode Bevel 与 F9 候选快捷键

- 状态：Accepted
- 日期：2026-08-15

## 背景

现有 `blender.modifier.add_bevel` 只能表达非破坏性的 Bevel Modifier，不能表达把封闭 Mesh 的全部边
直接倒角并得到新拓扑。直接开放当前 Edit Mode 选择或 Blender Bevel operator 的全部参数，会让结果依赖
活动对象、组件选择、模式、区域 context 和版本默认值，也会扩大 Observation 与补偿比较范围。

教学轨迹还需要保留参数写入的准确顺序。原生 `Ctrl+B` 是就地修改当前 Mesh，而 managed action 使用
copy/swap replacement Mesh；两者的资源身份与事务语义不能合并。

## 决策

冻结 ActionCatalog `1.13.0`，发布包含 24 个 action 与 16 项 `semanticCapabilities` 的 `1.14.0`，
新增 `blender.mesh.edit_bevel_edges`。调用方必须提供 `targetId`、`resultMeshId`、以
`OperatingLine.` 开头的 `resultMeshName`、`width` (`0.0001..100`)、`segments` (`1..16`) 和
`profile` (`0..1`)。

目标必须是 receipt-owned Mesh Object，并处于 Object Mode、没有 Modifier 或 Shape Key。源 Mesh 必须
非空，且每条边恰好连接两个面；源和结果都不得超过 8192 vertices、16384 edges、8192 polygons。
执行器复制并标记源 Mesh，对全部边运行 BMesh Bevel，验证预测与实际拓扑一致且 vertices、edges、faces
三项都严格增长，再把 Object 的 data link 换到 replacement Mesh。源 Mesh 保留供补偿使用。

除三个 action 参数外，BMesh 调用固定为：

- `offset_type=OFFSET`、`affect=EDGES`；
- `clamp_overlap=false`、`loop_slide=true`、`mark_seam=false`、`mark_sharp=false`；
- `material=-1`、`harden_normals=false`、`face_strength_mode=NONE`；
- `miter_outer=SHARP`、`miter_inner=SHARP`、`spread=0.1`、`vmesh_method=ADJ`。

`mesh_edges_beveled` Observation 验证 target/result identity、唯一 action receipt、Object→replacement
Mesh link、源与结果拓扑严格增长、结果上限和 receipt 中的 Mesh 内容签名。receipt 同时记录新 Mesh、
data link mutation 与内容签名；`Back` 使用 fail-closed compare-and-restore，外部修改会保留现场和 receipt。
Blender 原生 Undo/Redo 会删除和恢复 replacement Mesh，并重新绑定 receipt pointer。

同时冻结 InteractionCatalog `1.23.0`，发布精确绑定 ActionCatalog `1.14.0` 的 `1.24.0`。新 recipe
保留 managed `semantic_path`，menu 与 MCP 明确 unavailable，并声明 candidate-only 十步 shortcut：

1. `TAB` 进入 Edit Mode；
2. `2` 切换到 Edge Select；
3. `A` 选择全部边；
4. `Ctrl+B` 调用 `mesh.bevel`，使用完整 literal 默认值并以内嵌 `ENTER` 确认零宽度结果；
5. `F9` 打开 `screen.redo_last`，来源 operator 必须是 `mesh.bevel`；
6. 把 accepted `width` 写入 `mesh.bevel.offset`；
7. 把 accepted `segments` 写入 `mesh.bevel.segments`；
8. 把 accepted `profile` 写入 `mesh.bevel.profile`；
9. `ENTER` 关闭 Adjust Last Operation surface；
10. `TAB` 返回 Object Mode。

该轨迹要求 `Layout`、`VIEW_3D`、Object Mode、恰好一个 accepted Mesh active/selected、Blender keymap、
无 modal UI、无 Modifier/Shape Key、完整 closed manifold 和受控 topology。`targetId`、`resultMeshId`、
`resultMeshName` 不输入 Blender。结果仍是空 `validatedHostVersions`、`candidate_only` 与
`structural_only`，不执行宿主，也不声称具备 managed identity、Observation、补偿或 Undo 等价性。

## 真实 Blender 证据

前台 `Window.event_simulate` harness 在 Blender 4.5.3 LTS 与 5.1.1 中回放完整键盘与 F9 控件链。
两版都验证：

- 来源 operator 为 `MESH_OT_bevel`，默认 `offset=0`、`segments=1`、`profile=0.5`，其余 literal
  operator 属性与目录一致；
- 最终 `offset=0.2`、`segments=3`、`profile=0.6`；
- 12/12 条源边和 192/192 条结果边均被选择，结果 topology 为 96 vertices、192 edges、98 polygons；
- Object Mode、Cube 身份、源 Mesh pointer 和 `bpy.data.meshes` 数量保持不变。

Harness 的 `popupCloseEventSent=true` 只表示已发送关闭事件，不声称获得独立 popup-closed 确认。
Managed 双版本集成测试另行覆盖参数、模式、Modifier、Shape Key、空/开放/边界 Mesh、源/结果越界、
ID 冲突、Observation、外部篡改、补偿和 Blender 原生 Undo/Redo。这些证据不把原生就地 UI 路径升级为
managed replacement transaction。

## 兼容性与边界

- ActionCatalog `1.13.0` 与 InteractionCatalog `1.23.0` 保持逐字历史快照。
- menu 不能表达 replacement Mesh identity 与 copy/swap transaction，因此保持 unavailable；MCP 没有
  经过审批的 action-level tool。
- UI shortcut 修改现有 Mesh datablock；managed action 创建、标记并链接新 Mesh datablock。
- 本切片不开放任意组件选择、顶点 Bevel、weight、percent/absolute width、overlap clamp、miter、material、
  normals、face strength 或其他 operator 参数。

## 未选择方案

- **把 Bevel Modifier 复用为 Edit Mode Bevel**：两者的拓扑、资源身份和回退语义不同。
- **让 provider 指定当前选择**：会把上下文敏感状态带入 action 契约，无法确定性观察和补偿。
- **把原生 UI 结果当作 managed result**：就地 mutation 没有 `resultMeshId`、受管名称、receipt ownership
  或 replacement link。
- **把 candidate 标记为 verified/executable**：双版本 UI 证据证明轨迹可回放，不证明 managed transaction
  等价。
