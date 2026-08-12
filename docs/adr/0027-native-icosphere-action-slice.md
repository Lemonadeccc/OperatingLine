# ADR 0027：Blender 原生 Icosphere action 纵向切片

- 状态：已接受
- 日期：2026-08-12

## 背景

ActionCatalog `1.5.0` 已支持 Plane、Cube、UV Sphere、Cone 和 Cylinder 的单对象动作，但 Icosphere
仍只能留在手工节点。Icosphere 与 UV Sphere 的拓扑及控制参数不同；若只复用 UV Sphere action，
Planner 无法表达 subdivision level，Companion 也无法证明真实 `Add → Mesh → Ico Sphere` 菜单项与
确定性数据层执行、receipt 和 `Back` 属于同一动作边界。

## 决策

发布 Blender ActionCatalog `1.6.0`，新增 `blender.mesh.create_icosphere`：

- 参数为 `resourceId`、`objectName`、`subdivisions`、`radius` 和世界坐标 `location`；
- `subdivisions` 必须是 `1..5` 的整数。Blender 原生 operator 允许到 10，但 level 10 会生成
  5,242,880 个三角面；适配器主动收紧上限以控制内存和执行时间；
- `radius` 范围为 `0.0001..1000`，logical ID 和受管名称最长 180 字符；
- Companion 使用 `bmesh.ops.create_icosphere` 构造 mesh，不依赖当前选择、模式或 UI context；
- 对象、mesh 和首次创建的受管 Collection 进入同一 action receipt，`Back` 沿用补偿边界精确删除；
- observation 继续使用 `resource_exists`，不把三角面数量或视觉形状伪装成通用语义评分。

同时发布 InteractionCatalog `1.3.0`，精确绑定 ActionCatalog `1.6.0` 的 14 个动作。Icosphere 使用
`Add → Mesh → Ico Sphere` 的 `native_path`，最终 operator 为
`mesh.primitive_ico_sphere_add`。绿色最终菜单项与 `Next` 执行相同的已接受 action 参数，而不是直接
调用依赖 UI context 的裸 operator。

## 版本与兼容性

- `action-catalog-1.5.0.json` 与 `interaction-catalog-1.2.0.json` 冻结为不可变历史快照；注册表继续支持
  精确查询和 replay。
- ActionCatalog `1.6.0` 保留五个 planning phase 和七项 `semanticCapabilities`；Icosphere 加入
  `geometry` phase 与 `geometry.primitive_assembly`。
- InteractionCatalog 的宿主范围继续限定为 `>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0`，与原生菜单运行时门
  及真实验证矩阵一致。
- 雪人 revision 5 和机器人 benchmark 不改写，仍可按原目录动作执行。

## 验证与失败语义

- 参数 Schema 和 Blender executor 都在写入前拒绝未知字段、过长/非法 logical ID、非受管名称、
  非整数或超出 `1..5` 的 subdivision level，以及越界 radius/location。
- Blender 4.5.3 和 5.1.1 都验证 level 2 Icosphere 生成 42 个顶点、80 个三角面，所有顶点位于声明
  radius 上，并验证世界位置、resource receipt、完整回退及菜单入口与自动 `Next` 的同一 receipt 签名。
- GUI 测试捕获真实 `Add → Mesh` 菜单中的 `Ico Sphere` 状态；原生引导只在版本、Object Mode 和
  Guidance 条件满足时启用。

## 未选择的方案

- **直接调用 `bpy.ops.mesh.primitive_ico_sphere_add` 创建对象**：会引入选择、区域、模式和当前 context
  依赖；原生 operator 只作为教学入口，实际执行仍走确定性数据层。
- **开放 Blender 的完整 `1..10` subdivision 范围**：高等级会产生不适合交互式引导的指数级面数，
  与当前有界执行原则冲突。
- **把 Icosphere 隐式当作 UV Sphere**：无法表达拓扑意图，也会把错误的菜单路径绑定到已接受 action。
- **同时加入 Torus、Edit Mode 或 Modifier**：它们有不同参数、补偿和观察边界，保留为独立切片。

## 后果与后续

当前 Blender 目录可确定性创建 Plane、Cube、UV Sphere、Icosphere、Cone 和 Cylinder，并为六项单
primitive 提供真实原生菜单入口。Torus、Edit Mode 拓扑、Modifier、Sculpt、UV、Geometry Nodes、
权重绘制和更完整的骨骼工作流仍未实现，不能由 Planner 声明为可执行 action。
