# ADR 0060：有界 Subdivision Surface Modifier 与 F9 候选快捷键

- 状态：Accepted
- 日期：2026-08-15

## 背景

ActionCatalog `1.12.0` 已提供整网格 Subdivide、Bevel 和 Solidify，但还不能表达“不改写源 Mesh，使用
Subdivision Surface Modifier 非破坏性平滑对象”的目标。直接开放 Blender 的全部 Subdivision Surface
属性会扩大 provider 参数面、版本差异、Observation 和回退比较范围；只记录 `Ctrl+1` 又会丢失 managed
modifier 身份、名称、receipt ownership 和拓扑安全边界。

教学轨迹还需要准确记录原生 UI 的参数顺序。Blender 搜索中的 `Set Subdivision Level` 已在目标版本中
实测不可用，因此不能把未经验证的 `F3` 搜索写入目录。可用路径是先用 `Ctrl+1` 创建 level 1 modifier，
再用 `F9` 打开 Adjust Last Operation 并设置 Level。

## 决策

冻结 ActionCatalog `1.12.0`，发布包含 23 个 action 的 `1.13.0`，新增
`blender.modifier.add_subdivision_surface`。调用方只能提供：

- `targetId`；
- `modifierId`；
- 以 `OperatingLine.` 开头的 `modifierName`；
- `viewportLevel`，范围为 `1..3`。

目标必须是已有 receipt 拥有的 Mesh Object。所有前置 Modifier 必须被现有 receipt 完整跟踪，stack 中
不得已有 `SUBSURF`。动作对源 Mesh、前置 stack 的求值输入，以及按最高实际 level 投影的输出应用同一
上限：8192 vertices、16384 edges、8192 polygons。由于 render level 固定为 `2`，投影使用
`max(viewportLevel, 2)`。每一级按当前求值拓扑保守计算
`V' = V + E + F`、`E' = 2E + loops`、`F' = loops`，再继续检查下一层。

执行器创建一个不应用的 receipt-owned `SUBSURF` Modifier，并固定完整受控状态：

- `subdivision_type=CATMULL_CLARK`；
- `levels=viewportLevel`、`render_levels=2`、`quality=3`；
- `show_only_control_edges=true`、`use_creases=true`、`use_limit_surface=true`；
- `boundary_smooth=ALL`、`uv_smooth=PRESERVE_BOUNDARIES`、`use_custom_normals=false`；
- `show_viewport=true`、`show_render=true`、`show_in_editmode=true`、`show_on_cage=false`。

`modifier_ready` Observation 必须逐项验证上述状态以及 target/modifier identity。receipt 记录 Object
mutation 和 Modifier creation；`Back` 继续使用 fail-closed compare-and-restore 补偿，外部修改会保留现场
与 receipt。Blender 原生 Undo/Redo checkpoint 会移除并恢复 Modifier，同时按所属对象、stack index、
名称、类型和完整状态重新绑定 receipt pointer。

同时冻结 InteractionCatalog `1.22.0`，发布精确绑定 ActionCatalog `1.13.0` 的 `1.23.0`。新 action
保留完整 managed `semantic_path`，并声明以下 candidate-only shortcut：

1. `Ctrl+1` 调用 `object.subdivision_set`，固定来源参数 `level=1`、`relative=false`、
   `ensure_modifier=true`；
2. `F9` 打开 `screen.redo_last`，来源为上一步并要求 operator 为 `object.subdivision_set`；
3. 把 accepted action 的 `viewportLevel` 写入 `object.subdivision_set.level`；
4. `ENTER` 向同一 surface 发送关闭事件。

该轨迹要求 `Layout`、`VIEW_3D`、Object Mode、恰好一个已接受目标 Mesh active/selected、Blender
keymap、无 modal UI、无既有 `SUBSURF`、前置 Modifier stack 与 accepted tracked state 一致，并且求值及
投影 topology 在 managed 上限内。`targetId`、`modifierId` 和 `modifierName` 不输入 Blender；menu 与 MCP
均保持 unavailable。快捷键物化仍为 `candidate_only`、空 `validatedHostVersions` 和
`structural_only`，不声称复现 managed identity、receipt、Observation 或补偿契约。

## 真实 Blender 证据

前台 `Window.event_simulate` harness 在 Blender 4.5.3 LTS 与 5.1.1 中分别回放 viewport level
`1`、`2`、`3`，共六组运行。两版都验证：

- 来源 operator 属性为 `level=1`、`relative=false`、`ensure_modifier=true`；
- F9 后最终 `levels` 分别为 `1`、`2`、`3`，`render_levels` 始终为 `2`；
- 求值拓扑依次为 `26/48/24`、`98/192/96`、`386/768/384` vertices/edges/polygons；
- 只有一个 `SUBSURF`，其完整属性与 managed 固定值一致；
- Object Mode、对象身份、源 Mesh pointer 和 `bpy.data.meshes` 数量保持不变。

Harness 记录 `popupCloseEventSent=true`，只表示已经发送关闭事件，不声称获得独立的 popup-closed 确认。
同一目标版本中的 `F3` 搜索路径无法找到 `Set Subdivision Level`，因此未收录。

Managed action 的双版本集成测试另行覆盖参数校验、level 2 的 `98/192/96` 求值拓扑、完整 Observation、
重复 ID、既有 `SUBSURF`、未跟踪 Modifier、投影越界、外部修改阻止回退和成功恢复。GUI Undo/Redo E2E
验证该 Modifier 的移除、恢复与 pointer 重绑定。这些执行层证据不把 candidate UI 轨迹升级为 managed
等价路径。

## 兼容性与边界

- ActionCatalog `1.12.0` 与 InteractionCatalog `1.22.0` 保持逐字历史快照。
- 目录 materialization 只生成可审查的有序教学投影，不执行 Blender、不保存 ProcedureTree、不创建
  Proposal，也不绕过审批。
- UI shortcut 采用 Blender 默认 Modifier 名称；它不能表达 accepted `modifierId` 或 `modifierName`。
- menu 没有稳定、封闭且能表达完整 managed transaction 的轨迹；MCP 没有经过审批的 action-level tool。
- 本切片不开放 Simple subdivision、Adaptive Subdivision、任意 render level、quality、边界规则、UV
  smoothing、crease、limit surface、可见性或 apply modifier 参数。

## 未选择方案

- **收录 `F3 → Set Subdivision Level`**：目标 Blender 版本实测无法找到该搜索项。
- **只使用 `Ctrl+viewportLevel`**：会丢失 `F9` property surface、参数来源和顺序，也无法统一记录 `1..3`。
- **把 UI 默认 Modifier 当成 managed Modifier**：缺少逻辑 ID、accepted name、receipt ownership、
  Observation 和补偿契约。
- **把 candidate 标记为 verified/executable**：双版本 UI 证据证明轨迹可操作，不证明 managed transaction
  等价。
