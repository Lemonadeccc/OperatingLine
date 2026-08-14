# ADR 0052：Torus 有序菜单物化

- 状态：Accepted
- 日期：2026-08-14

## 背景

ADR 0046–0051 已建立目录绑定的 Procedure materialization，并为 UV Sphere、Icosphere、Cube 与 Plane
提供封闭、可安装期验证的轨迹声明。Torus 已有 Blender 4.5/5.1 的原生
`Layout → Add → Mesh → Torus` guidance，Action 参数为 `majorSegments`、`minorSegments`、`majorRadius`、
`minorRadius`、`location`、`objectName` 与内部 `resourceId`，但 InteractionCatalog `1.15.0` 没有为它声明
Procedure materialization。

Blender 的版本化 operator API 都公开 `major_segments`、`minor_segments`、`mode`、`major_radius` 与
`minor_radius`：
[Blender 4.5 `primitive_torus_add`](https://docs.blender.org/api/4.5/bpy.ops.mesh.html#bpy.ops.mesh.primitive_torus_add)
与
[Blender 5.1 `primitive_torus_add`](https://docs.blender.org/api/5.1/bpy.ops.mesh.html#bpy.ops.mesh.primitive_torus_add)。
ActionCatalog 把 major radius 定义为局部 Z 轴到管截面中心的距离，把 minor radius 定义为管截面半径；
现有 managed executor 以同一公式构造顶点。为冻结这组含义，目录必须显式设置 literal
`mode: "MAJOR_MINOR"`，不能依赖宿主默认值或改用外径/内径模式。官方 API 与既有 executor 只证明参数
语义，不构成 OperatingLine 已回放完整 UI operation 序列的证据。

## 决策

InteractionCatalog `1.16.0` 继续精确绑定 ActionCatalog `1.12.0`，并为
`blender.mesh.create_torus` 增加独立的 `ordered_parameter_operations` menu 声明。输出严格为六步：

1. `Layout`；
2. `Layout → Add`；
3. `Layout → Add → Mesh`；
4. `Layout → Add → Mesh → Torus`，operator 参数按顺序为：
   `major_segments ← majorSegments`、`minor_segments ← minorSegments`、literal
   `mode: "MAJOR_MINOR"`、`major_radius ← majorRadius`、`minor_radius ← minorRadius`；
5. `Sidebar → Item → Transform → Location`，参数 `value` 为 accepted action 的三维 `location`；
6. `Outliner → Object Name`，参数 `value` 为 accepted action 的 `objectName`。

四项 Action 参数都使用 identity 投影。内部资源身份 `resourceId` 由声明显式省略，不进入 UI operation。
六步菜单使 coverage 的 menu 状态为 `materialized`，因此单独的 Torus 结果使用 MaterializationResult
`1.1.0`。Torus 没有声明 shortcut，不能从 UV Sphere 的候选快捷键推导；shortcut 保持 unavailable。MCP
同样保持 unavailable，因为仓库没有能与 accepted Torus action 一一对应、经过审批和版本验证的真实
action-level MCP tool。

InteractionCatalog `1.15.0` 冻结为不可变历史快照，继续逐字精确回放 Plane menu-only Result `1.1.0`；
更早版本的行为也不改变。

## 约束与验证

- 参数值只能来自已经通过 ActionCatalog Schema 验证的顶层 action arguments，或目录中经过审查的 literal；
  语义 operation 文本和参数不能覆盖它们。
- 安装期覆盖检查继续要求每个顶层 Action 参数在 menu 模态中恰好映射或带理由省略。
- Torus 的四项 shape 参数仅使用 identity 投影，`mode` 必须固定为 `MAJOR_MINOR`。
- materializer 必须保持输入 leaf 为 `candidate`、保持 `validatedHostVersions` 为空，并从 catalog recipe 重建
  track/operation identity。
- Result `1.1.0` 只证明目录 grounding；通用 compile 继续报告 `interactionTracks: structural_only`。
- 测试断言六步顺序、五个 operator 参数的精确顺序和值、`resourceId` 省略、Result `1.1.0`、
  shortcut/MCP unavailable，以及历史 `1.15.0` 精确回放；本切片不按六步 UI operation 在真实 Blender
  中逐控件回放。
- 原生 `Add → Mesh → Torus` 菜单与 `primitive_torus_add` operator 只表达几何创建入口和可见参数。它们不
  复现 Action executor 的 managed collection 归属、resource tag、receipt、幂等或补偿语义；因此不得把
  物化轨迹写成真实 action 执行样本或 verified 宿主状态。

## 后果

- 同一 ordered-parameter DSL 现在覆盖 UV Sphere、Icosphere、Cube、Plane 与 Torus，同时保持各 action 的
  参数形状和 provenance 独立。
- 调用方可以区分 catalog-grounded Torus menu、未声明 shortcut 与不存在的 action-level MCP 工具。
- Torus 输出仍是 `candidate`/`structural_only`。后续晋升需要 Blender 4.5/5.1 的逐 operation 回放、
  Observation、恢复与执行语义证据，不能从原生 operator API 推断。

## 未选择方案

- **省略 `mode` 并依赖默认值**：当前版本默认 `MAJOR_MINOR`，但轨迹应显式冻结半径解释方式。
- **使用 `EXT_INT`、`abso_major_rad` 或 `abso_minor_rad`**：这些字段表达另一套半径语义，与 ActionCatalog
  的 major/minor 定义不一致。
- **复用其他 primitive 的 recipe ID 或快捷键**：共享菜单前缀不等于相同 operator、参数或 provenance。
- **根据 `native_path` 自动物化所有 primitive**：native guidance 不定义参数覆盖、literal、显式省略或
  结果版本。
- **把 Orchestrator materialize tool 记作 MCP 执行轨迹**：该工具只生成轨迹，不调用 Blender action。
- **把原生 operator 当作 managed action executor**：它不提供 OperatingLine 的 collection、tag、receipt、
  idempotency 与 compensation 契约。
