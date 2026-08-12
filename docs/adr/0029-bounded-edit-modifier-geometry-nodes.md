# ADR 0029：有界 Edit Mode、Modifier 与 Geometry Nodes 执行切片

- 状态：已接受
- 日期：2026-08-12

## 背景

ActionCatalog `1.7.0` 只能创建基础体、材质、刚性骨架/动画与渲染资源。Planner 可以描述后续建模
意图，但不能把 Edit Mode 拓扑、Modifier 或 Geometry Nodes 声明为可执行步骤。直接开放任意
`bpy.ops`、任意 modifier 属性或任意节点图会引入 UI context、选择状态、无界拓扑增长和无法可靠
补偿的资源关系，不符合当前严格参数、受管资源和 fail-closed 回退边界。

## 决策

发布 Blender ActionCatalog `1.8.0`，新增三个独立 action：

- `blender.mesh.edit_subdivide`：只接受一个由早期 receipt 拥有的 Mesh Object，对其完整网格执行
  `1..8` 次 Subdivide；动作复制源 Mesh，在副本上使用 BMesh 数据 API 构网，再把对象的 data 链接
  切换到新 Mesh。源 Mesh 不原地修改，直到 `Back` 成功后才恢复链接并删除副本。
- `blender.modifier.add_bevel`：只向受管 Mesh Object 增加一个未应用的 Bevel modifier；宽度、分段和
  angle limit 都有严格范围，动作不应用 modifier，也不接触选择、模式或现有 modifier。
- `blender.geometry_nodes.create_transform`：创建一个受管 GeometryNodeTree、一个 NODES modifier，
  以及固定的 `Group Input → Transform Geometry → Group Output` 图；只开放有界 translation、rotation
  和 scale，不接受任意节点类型、socket、链接或表达式。

三类动作都复用 step-keyed registry、执行前资源完整性检查和补偿 receipt。由于 Blender Modifier
不是独立 ID datablock，receipt 保存对象、modifier pointer、名称、类型和允许属性的精确快照；Node
Group 作为新的 `NODE_GROUP` 资源类型保存。Subdivide 记录新 Mesh 内容签名，Geometry Nodes 记录
interface、节点、输入默认值和链接签名。`Back` 只有在这些状态仍等于动作写入结果时才删除或恢复；
检测到外部编辑会零写入失败并保留当前步骤与 receipt，修复冲突后可原地重试。

同时发布 InteractionCatalog `1.5.0`，精确绑定 ActionCatalog `1.8.0` 的 18 个动作。三个新 action
使用 `semantic_path`：卡片可说明进入 Edit Mode、Modifier Properties 或 Geometry Nodes 的教学路径，
但标记 `UI target unavailable`，不声称自动执行的数据层动作点击过这些原生控件。

## 观察契约

- `mesh_topology_matches` 检查受管目标的顶点、边、面计数；目录可以只声明需要的计数字段。
- `modifier_ready` 通过活动 receipt 的 modifier identity 检查所属对象、modifier 类型和允许属性。
- `geometry_nodes_ready` 检查所属对象、NODES modifier、受管 Node Group 和精确节点类型集合。

这些 observation 是当前协议 `0.1.0` 的执行后遥测，不在本决策中升级为自动成功门；成功门和恢复
策略另行版本化。

## 版本与兼容性

- `action-catalog-1.7.0.json` 与 `interaction-catalog-1.4.0.json` 冻结为不可变历史快照，注册表继续
  支持精确查询和 replay。
- ActionCatalog 保留五个 planning phase，并增加 `geometry.edit_subdivide`、
  `geometry.bevel_modifier` 和 `geometry_nodes.transform` 三项语义能力，总计十项。
- 当前雪人 revision 5 和机器人 benchmark 不改写；新动作可由后续完整 Plan 作为独立叶节点使用。
- 宿主范围仍限定为 `>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0`。

## 验证与失败语义

- Schema 与 Blender executor 在写入前拒绝未知字段、非法 logical ID、非受管名称、越界 cuts、width、
  segments、angle、translation、rotation 和 scale。
- Blender 4.5.3 与 5.1.1 都执行 `Cube → Subdivide → Bevel → Geometry Nodes`，检查 `8/12/6`
  拓扑变为 `26/48/24`、三个 observation、modifier/node graph 状态和逐步完整回退。
- 两个版本都验证手工修改 subdivided Mesh、Bevel 属性或 Geometry Nodes 图会阻止 `Back`，receipt 与
  步骤位置保持不变；恢复动作写入值后可以原地重试并完成回退。
- 新 Node Group 若被计划外 modifier 使用，或新 Mesh 获得外部用户，资源预检会在任何删除前失败。

## 未选择的方案

- **直接操作当前 Edit Mode 选择**：结果依赖用户选择、活动对象、模式和区域 context，无法从 Plan
  参数确定性重放。
- **原地修改源 Mesh**：需要保存完整可恢复网格快照，且更容易覆盖用户并发修改；复制后换链让
  补偿保持资源级边界。
- **应用 Bevel modifier**：会把 modifier 与拓扑修改折叠成一次破坏性操作，失去清晰的独立观察和
  回退单位。
- **开放任意 modifier 或任意 Geometry Nodes JSON 图**：参数面和版本兼容面过大，也无法在当前
  action 级测试中证明安全上限与恢复语义。
- **把 semantic path 标记为 native path**：数据 API 执行没有点击真实 UI；伪装会破坏引导证据。

## 后果与后续

Planner 现在可以把受管 Mesh 的一次整网格细分、一个 Bevel modifier 和一个 Transform Geometry
Nodes 图声明为严格可执行叶节点。任意组件选择、Extrude/Inset 等更多拓扑操作、其他 modifier、通用
节点图、Sculpt、UV 与权重绘制仍需各自的有界参数、观察、回退和双版本宿主证据后才能进入目录。
