# ADR 0028：Blender 原生 Torus action 纵向切片

- 状态：已接受
- 日期：2026-08-12

## 背景

ActionCatalog `1.6.0` 已支持 Plane、Cube、UV Sphere、Icosphere、Cone 和 Cylinder 的单对象动作，
但 Torus 仍只能留在手工节点。Blender 的公开 `bmesh.ops` 在 4.5 与 5.1 均没有 `create_torus`；若直接
调用 `bpy.ops.mesh.primitive_torus_add`，执行会依赖当前区域、模式、选择和游标等 UI context，无法满足
现有适配器的数据层确定性与补偿边界。

## 决策

发布 Blender ActionCatalog `1.7.0`，新增 `blender.mesh.create_torus`：

- 参数为 `resourceId`、`objectName`、`majorSegments`、`minorSegments`、`majorRadius`、
  `minorRadius` 和世界坐标 `location`；
- `majorSegments` 必须是 `3..128` 的整数，`minorSegments` 必须是 `3..64` 的整数，因此单次动作最多
  创建 8192 个顶点与 8192 个四边面；超限请求直接拒绝，不静默降低拓扑精度；
- 两个 radius 范围均为 `0.0001..1000`，logical ID 与受管名称最长 180 字符；参数保留 Blender
  `MAJOR_MINOR` 的独立半径语义，不额外禁止 horn/spindle 或自相交形态；
- Companion 移植 Blender 上游 `add_torus()` 的顶点公式和向外四边面绕序，在本地 XY 平面绕 Z 轴
  确定性构网，再显式设置对象世界位置；
- 对象、mesh 和首次创建的受管 Collection 进入同一 action receipt，`Back` 沿用补偿边界精确删除；
- observation 继续使用 `resource_exists`，不把面数、流形性质或视觉形状伪装成通用语义评分。

同时发布 InteractionCatalog `1.4.0`，精确绑定 ActionCatalog `1.7.0` 的 15 个动作。Torus 使用
`Add → Mesh → Torus` 的 `native_path`，最终 operator 为 `mesh.primitive_torus_add`。绿色最终菜单项与
`Next` 执行相同的已接受 action 参数和数据层实现，不直接执行裸 Blender operator。

## 版本与兼容性

- `action-catalog-1.6.0.json` 与 `interaction-catalog-1.3.0.json` 冻结为不可变历史快照；注册表继续支持
  精确查询和 replay。
- ActionCatalog `1.7.0` 保留五个 planning phase 和七项 `semanticCapabilities`；Torus 加入
  `geometry` phase 与 `geometry.primitive_assembly`。
- InteractionCatalog 的宿主范围继续限定为 `>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0`，与原生菜单运行时门
  及真实验证矩阵一致。
- 雪人 revision 5、机器人 benchmark 和 bounded primitive batch 不改写；Torus 是独立叶动作，未被
  隐式加入既有 batch 语义。

## 验证与失败语义

- 参数 Schema 和 Blender executor 都在写入前拒绝未知字段、过长/非法 logical ID、非受管名称、
  非整数或越界 segments，以及越界 radius/location。
- Blender 4.5.3 和 5.1.1 都验证 `16 × 8` Torus 生成 128 个顶点与 128 个四边面，所有顶点满足声明
  主/次半径方程，并验证 `5 × 5 × 1` 尺寸、世界位置、resource receipt 和完整回退。
- 两个版本都验证真实 `Add → Mesh → Torus` 菜单入口与自动 `Next` 生成相同 receipt 签名；GUI 截图门
  同时检查菜单微步骤状态与视口卡片颜色。

## 未选择的方案

- **直接调用 `bpy.ops.mesh.primitive_torus_add` 创建对象**：会引入选择、区域、模式、视图与游标 context
  依赖；原生 operator 只作为教学入口。
- **假设存在 `bmesh.ops.create_torus`**：Blender 4.5/5.1 的公开 BMesh operator 注册表没有该操作。
- **开放 Blender 的完整 `256 × 256` segments 范围**：单个未受信请求可创建 65,536 个顶点和四边面，
  与当前有界交互执行原则冲突。
- **静默 clamp segments**：会让 receipt 实际拓扑偏离已接受计划参数，因此选择明确拒绝。
- **同时加入 Edit Mode、Modifier 或 Geometry Nodes**：它们具有不同资源、补偿、观察和 UI 边界，
  保留为独立切片。

## 后果与后续

当前 Blender 目录可确定性创建 Plane、Cube、UV Sphere、Icosphere、Cone、Cylinder 和 Torus，并为
七项单 primitive 提供真实原生菜单入口。Edit Mode 拓扑、Modifier、Sculpt、UV、Geometry Nodes、
权重绘制和更完整的骨骼工作流仍未实现，不能由 Planner 声明为可执行 action。
