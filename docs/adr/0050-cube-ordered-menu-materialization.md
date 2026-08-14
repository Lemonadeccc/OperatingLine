# ADR 0050：Cube 有序菜单物化

- 状态：Accepted
- 日期：2026-08-14

## 背景

ADR 0046–0049 已建立目录绑定的 Procedure materialization，并为 UV Sphere 与 Icosphere 提供封闭、可安装期
验证的 menu 声明。Cube 已有 Blender 4.5/5.1 的原生 `Layout → Add → Mesh → Cube` guidance，Action
参数为 `size`、`location`、`objectName` 与内部 `resourceId`，但 InteractionCatalog `1.13.0` 没有为它声明
Procedure materialization。调用方因此不能从目录确定性生成与 accepted Cube action 对齐的 ordered menu。

Blender 的版本化 operator API 均把 `size` 与 `scale` 暴露为不同参数：
[Blender 4.5 `primitive_cube_add`](https://docs.blender.org/api/4.5/bpy.ops.mesh.html#bpy.ops.mesh.primitive_cube_add)
与
[Blender 5.1 `primitive_cube_add`](https://docs.blender.org/api/5.1/bpy.ops.mesh.html#bpy.ops.mesh.primitive_cube_add)。
本项目 ActionCatalog 进一步把 `size` 定义为 Blender 单位下的完整边长。因此 `size` 必须直接映射到 operator
参数，不能解释为 object transform scale，也不能使用 UV Sphere 的 uniform-vector Scale 投影。这些官方 API
链接只确认 operator 参数表，不构成 OperatingLine 已在真实 Blender 中回放完整物化轨迹的证据。

## 决策

InteractionCatalog `1.14.0` 继续精确绑定 ActionCatalog `1.12.0`，并为
`blender.mesh.create_cube` 增加独立的 `ordered_parameter_operations` menu 声明。输出严格为六步：

1. `Layout`；
2. `Layout → Add`；
3. `Layout → Add → Mesh`；
4. `Layout → Add → Mesh → Cube`，operator 参数 `size` 通过 identity 投影取 accepted action 的完整边长
   `size`；
5. `Sidebar → Item → Transform → Location`，参数 `value` 为 accepted action 的三维 `location`；
6. `Outliner → Object Name`，参数 `value` 为 accepted action 的 `objectName`。

内部资源身份 `resourceId` 由声明显式省略，不进入 UI operation。六步菜单使 coverage 的 menu 状态为
`materialized`，因此单独的 Cube 结果使用 MaterializationResult `1.1.0`。Cube 没有声明 shortcut，不能从
UV Sphere 的候选快捷键投影推导或复用；shortcut 保持 unavailable。MCP 同样保持 unavailable，因为仓库没有
能与 accepted Cube action 一一对应、经过审批和版本验证的真实 action-level MCP tool。

InteractionCatalog `1.13.0` 冻结为不可变历史快照，继续逐字精确回放 Icosphere menu-only Result `1.1.0`；
更早的 `1.9.0`/`1.10.0`/`1.11.0`/`1.12.0` 行为也不改变。

## 约束与验证

- 参数值只能来自已经通过 ActionCatalog Schema 验证的顶层 action arguments；语义 operation 文本和参数
  不能覆盖它们。
- 安装期覆盖检查继续要求每个顶层 Action 参数在 menu 模态中恰好映射或带理由省略。
- `size` 仅使用 identity 投影，并保持“完整边长”的 ActionCatalog 语义；它不是 transform scale。
- materializer 必须保持输入 leaf 为 `candidate`，保持 `validatedHostVersions` 为空，并从 catalog recipe 重建
  track/operation identity。
- Result `1.1.0` 只证明目录 grounding；通用 compile 继续报告 `interactionTracks: structural_only`。
- 测试可断言六步顺序、精确参数值、`resourceId` 省略、Result `1.1.0`、shortcut/MCP unavailable，以及
  历史 `1.13.0` 精确回放，但本切片不运行真实 Blender replay。
- 原生 `Add → Mesh → Cube` 菜单与 `primitive_cube_add` operator 只表达几何创建入口和可见参数。它们不
  复现 Action executor 的 managed collection 归属、resource tag、receipt、幂等或补偿语义；因此不得把
  物化轨迹写成真实 action 执行样本或 verified 宿主状态。

## 后果

- 同一 ordered-parameter DSL 现在覆盖 UV Sphere、Icosphere 与 Cube，同时保持各 action 的参数形状独立。
- 调用方可以区分 catalog-grounded Cube menu、未声明 shortcut 与不存在的 action-level MCP 工具。
- Cube 输出仍是 `candidate`/`structural_only`。后续晋升需要真实 Blender 4.5/5.1 回放、Observation、恢复与
  执行语义证据，不能从原生 operator API 推断。

## 未选择方案

- **把 `size` 映射到 Scale 控件**：Action 的 `size` 是完整边长；transform scale 是另一个量，语义不等价。
- **复用 UV Sphere 的七步菜单或快捷键**：Cube 没有 `radius`，也没有封闭 shortcut 声明，复用会制造错误
  参数和未经验证的交互步骤。
- **根据 `native_path` 自动物化所有 primitive**：native guidance 不定义参数覆盖、显式省略或结果版本。
- **把 Orchestrator materialize tool 记作 MCP 执行轨迹**：该工具只生成轨迹，不调用 Blender action。
- **把原生 operator 当作 managed action executor**：它不提供 OperatingLine 的 collection、tag、receipt、
  idempotency 与 compensation 契约。
