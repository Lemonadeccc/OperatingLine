# ADR 0026：Blender 原生 Cube action 纵向切片

- 状态：已接受
- 日期：2026-08-12

## 背景

ActionCatalog `1.4.0` 已支持 Plane、UV Sphere、Cone 和 Cylinder 的单对象动作，但 Cube 仍只能作为
未支持能力留在手工节点。Blender 原生 `Add → Mesh` 菜单已经稳定公开 Cube 项；若目录没有对应动作，
Planner 不能声明 Cube 参数、Companion 不能生成受管 mesh，也无法让原生菜单项与 `Next` 共享 receipt
和 `Back` 边界。

## 决策

发布 Blender ActionCatalog `1.5.0`，新增 `blender.mesh.create_cube`：

- 参数沿用单 Plane 的严格形状：`resourceId`、`objectName`、`size` 和世界坐标 `location`；
- `size` 表示三个方向相同的完整边长，范围为 `0.0001` 到 `1000`；
- Companion 使用 `bmesh.ops.create_cube` 构造 mesh，不依赖当前选择、模式或 UI context；
- 对象、mesh 和首次创建的受管 Collection 进入同一 action receipt；`Back` 使用既有补偿边界精确删除；
- observation 继续使用 `resource_exists`，不把 mesh 形状检查伪装成新的语义评分。

同时发布 InteractionCatalog `1.2.0`，精确绑定 ActionCatalog `1.5.0` 的 13 个动作。Cube 使用
`Add → Mesh → Cube` 的 `native_path`，最终 operator 为 `mesh.primitive_cube_add`。绿色菜单项与
`Next` 执行相同的目录参数和 action handler；不匹配当前叶节点的其他 primitive 仍作为 `ALT` 拒绝执行。

## 版本与兼容性

- `action-catalog-1.4.0.json` 与 `interaction-catalog-1.1.0.json` 冻结为不可变历史快照；注册表继续支持
  精确查询和 replay。
- ActionCatalog `1.5.0` 保留已有五个 planning phase 和七项 `semanticCapabilities`；Cube 加入
  `geometry` phase 与 `geometry.primitive_assembly`，不改变 Planning Packet 或 quality baseline 版本。
- InteractionCatalog `1.2.0` 的宿主范围精确限定为 `>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0`，与运行时只启用
  Blender 4.5/5.1 系列的版本门一致；未验证的 Blender 5.0 不声明为原生菜单支持。
- 雪人 revision 5 和机器人 benchmark 不需要改写；它们仍可按原 action 参数执行。

## 验证与失败语义

- 参数 Schema 和 Blender executor 都在写入前拒绝过小边长、未知字段、超过 180 字符或非法的 logical ID，
  以及非受管名称；180/181 字符边界分别覆盖接受与拒绝路径。
- 名称或 logical ID 冲突不前进 Session，也不删除已有用户对象。
- Blender 4.5.3 和 5.1.1 都验证 Cube 的 2.5 单位确定性尺寸、世界位置、resource receipt、完整回退，
  以及真实菜单 operator 与自动 `Next` 的同一 receipt 签名。
- 原生 UI recipe 只在受支持版本、Object Mode 和 Guidance 可见时接管既有菜单绘制；其他环境保持
  原始 Blender 菜单或明确降级。

## 未选择的方案

- **调用 `bpy.ops.mesh.primitive_cube_add` 创建数据**：会引入模式、区域、选择和当前 context 依赖；
  原生 operator 只作为可验证的教学入口，真正执行仍走确定性数据层。
- **把 Cube 加入 primitive batch 而不提供单对象 action**：无法让一个叶节点、一项菜单和一份 receipt
  精确对应。
- **把 Icosphere、Torus、Edit Mode 和 Modifier 一次加入同一版本**：参数、补偿与宿主验证面不同，
  会扩大失败半径；它们保留为后续独立纵向切片。

## 后果与后续

当前 Blender 目录可确定性创建 Plane、Cube、UV Sphere、Cone 和 Cylinder，并为五项单 primitive
提供真实原生菜单入口。Icosphere、Torus、Edit Mode 拓扑、Modifier、Sculpt、UV、Geometry Nodes、
权重绘制和更完整的骨骼工作流仍未实现，不能由 Planner 声明为可执行 action。
