# ADR 0063：有界整网格 Poke Faces 与 F9 候选快捷键

- 状态：Accepted
- 日期：2026-08-15

## 背景

现有 Edit Mode action 能细分、三角化、区域挤出、整网格倒角和逐面内插，但不能表达 Blender 的
Poke Faces：为每个被选面建立中心顶点，再把原面拆成三角扇。直接开放当前面选择或 `mesh.poke`
的全部属性，会让结果依赖活动对象、组件选择、模式、区域 context、keymap 与版本默认值，也无法为
Observation 和补偿提供封闭合同。

教学轨迹还必须保留 Poke Offset 的准确写入位置。Blender 现代默认 keymap 没有 Poke Faces 的直接
按键；旧版兼容 keymap 中的 `Alt+P` 不是可移植默认值。因此候选轨迹使用两版均可回放的 F3 搜索，
而不是把 legacy alias 冒充成默认快捷键。原生 operator 就地修改当前 Mesh；managed action 使用
copy/tag/swap replacement Mesh，两者的资源身份与事务语义仍然不同。

## 决策

冻结 ActionCatalog `1.15.0`，发布包含 26 个 action 与 18 项 `semanticCapabilities` 的 `1.16.0`，
新增 `blender.mesh.edit_poke_faces`。调用方必须提供 `targetId`、`resultMeshId`、以
`OperatingLine.` 开头的 `resultMeshName` 和有限 `offset` (`-100..100`)。

目标必须是 receipt-owned Mesh Object，并处于 Object Mode、没有 Modifier 或 Shape Key。源 Mesh
必须非空，每条边恰好连接两个面，每个顶点恰好形成一个连通 manifold face fan，且每个面的面积有限并严格为正。源和结果都不得超过
8192 vertices、16384 edges、8192 polygons。

设源拓扑为 `V/E/F`，所有面的环数总和为 `L`。执行器复制并标记源 Mesh，对全部面调用
`bmesh.ops.poke`，固定 `center_mode="MEAN_WEIGHTED"` 与 `use_relative_offset=false`。结果必须精确为：

- vertices：`V + F`；
- edges：`E + L`；
- polygons：`L`；
- 所有结果面均为 triangle。

对 closed manifold，`L = 2E`，因此结果等价于 `V + F` vertices、`3E` edges 和 `2E` polygons。
BMesh 结果还必须具有有限顶点坐标、正边长和正面积；转回 Mesh 后再次核对精确拓扑、全三角面与
上限，再把 Object 的 data link 换到 replacement Mesh。源 Mesh 保留供补偿使用。

`mesh_faces_poked` Observation 独立验证 target/result identity、唯一 action receipt、
Object→replacement Mesh link、`V+F / E+L / L` 拓扑、全三角面、源/结果上限、非退化性和 receipt
中的 Mesh 内容签名。receipt 同时保护 Object data link、detached source Mesh 的同值
`mesh_content` guard 与 replacement Mesh 内容；`Back` 使用 fail-closed compare-and-restore，外部修改
会保留现场和 receipt。独立 Blender 原生 Undo/Redo 回归删除和恢复 replacement Mesh，并重新绑定
receipt pointer。

同时冻结 InteractionCatalog `1.25.0`，发布精确绑定 ActionCatalog `1.16.0` 的 `1.26.0`，共包含
26 个 recipe。新 recipe 保留 managed `semantic_path`，menu 与 MCP 明确 unavailable，并声明
candidate-only 九步 shortcut：

1. `TAB` 进入 Edit Mode；
2. `3` 切换到 Face Select；
3. `A` 选择全部面；
4. `F3` 打开 Operator Search，并携带 literal query `poke faces`；
5. `ENTER` 执行 `mesh.poke`，来源默认值为 `offset=0`、`use_relative_offset=false`、
   `center_mode=MEDIAN_WEIGHTED`；
6. `F9` 打开 `screen.redo_last`，来源 operator 必须是 `mesh.poke`；
7. 把 accepted `offset` 写入 `mesh.poke.offset`；
8. `ENTER` 关闭 Adjust Last Operation surface；
9. `TAB` 返回 Object Mode。

UI RNA 的 `MEDIAN_WEIGHTED` 与 BMesh API 的 `MEAN_WEIGHTED` 是两条不同接口的字面量，目录分别原样
保存，不能互换字符串。该轨迹要求 `Layout`、`VIEW_3D`、Object Mode、恰好一个 accepted Mesh
active/selected、Blender 默认 keymap、English UI、无 modal UI、无 Modifier/Shape Key、完整 closed
nondegenerate manifold 和受控 topology。`targetId`、`resultMeshId`、`resultMeshName` 不输入 Blender。
结果仍是空 `validatedHostVersions`、`candidate_only` 与 `structural_only`，不执行宿主，也不声称具备
managed identity、Observation、补偿或 Undo 等价性。

## 真实 Blender 证据

前台 `Window.event_simulate` harness 在 Blender 4.5.3 LTS 与 5.1.1 中回放完整 F3 搜索、执行与 F9
控件链。两版都验证：

- 来源 operator 为 `MESH_OT_poke`，来源属性为 `offset=0`、`use_relative_offset=false`、
  `center_mode=MEDIAN_WEIGHTED`；
- 最终 `offset=0.2`，其余固定属性不变；
- Cube 从 8 vertices、12 edges、6 polygons 变为 14 vertices、36 edges、24 个 triangle polygons；
- 24 个结果面全部被选择，所有坐标的最小/最大值为 `-1.2/1.2`；
- Object Mode、Cube 身份、源 Mesh pointer 和 `bpy.data.meshes` 数量保持不变。

Managed 双版本集成测试另行覆盖参数、模式、Modifier、Shape Key、空/开放/边界/退化 Mesh、
源/结果越界、ID 冲突、Observation、detached source/result 外部篡改、补偿和 Blender 原生 Undo/Redo。
Icosphere 回归把 12/30/20 精确变为 32/90/60，并证明全三角输入仍满足同一公式。这些证据不把原生
就地 UI 路径升级为 managed replacement transaction。

## 兼容性与边界

- ActionCatalog `1.15.0` 与 InteractionCatalog `1.25.0` 保持逐字历史快照。
- menu 不能表达 replacement Mesh identity 与 copy/tag/swap transaction，因此保持 unavailable；MCP
  没有经过审批的 action-level tool。
- UI shortcut 修改现有 Mesh datablock；managed action 创建、标记并链接新 Mesh datablock。
- 本切片不开放任意组件选择、relative offset、Poke Center 选择、legacy keymap 依赖或其他 operator
  参数。

## 未选择方案

- **把 legacy `Alt+P` 当作默认快捷键**：它只属于兼容 keymap，现代默认 Blender keymap 不提供该
  绑定，无法作为可移植训练轨迹。
- **让 provider 指定当前面选择**：会把上下文敏感状态带入 action 契约，无法确定性观察和补偿。
- **只检查所有结果面为 triangle**：Triangulate 也满足该条件；精确 `V+F / E+L / L` 公式用于区分
  Poke Faces 并锁定完整结果。
- **把原生 UI 结果当作 managed result**：就地 mutation 没有 `resultMeshId`、受管名称、receipt
  ownership 或 replacement link。
