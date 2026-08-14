# ADR 0049：Icosphere 有序菜单物化

- 状态：Accepted
- 日期：2026-08-14

## 背景

ADR 0046–0048 已建立目录绑定的 Procedure materialization，并以 UV Sphere 证明原生菜单、逐参数控件和
候选快捷键可以从已安装 InteractionCatalog 的封闭声明确定性生成。但只有一个 action opt in，尚不能证明
相同 DSL 能按不同参数集合复用。Icosphere 已有经过 Blender 4.5/5.1 验证的原生
`Layout → Add → Mesh → Ico Sphere` 路径，Action 参数则是 `subdivisions`、`radius`、`location`、
`objectName` 与内部 `resourceId`；它不应套用 UV Sphere 的 Scale 或快捷键投影。

Blender 4.5 Mesh Primitives 手册明确列出 Icosphere 的 Subdivisions，以及 primitive 通用的 Radius、
Location 参数：[Icosphere](https://docs.blender.org/manual/en/4.5/modeling/meshes/primitives.html#icosphere)。
对应 operator 的精确版本 API 见
[Blender 4.5 `primitive_ico_sphere_add`](https://docs.blender.org/api/4.5/bpy.ops.mesh.html#bpy.ops.mesh.primitive_ico_sphere_add)
与
[Blender 5.1 `primitive_ico_sphere_add`](https://docs.blender.org/api/5.1/bpy.ops.mesh.html#bpy.ops.mesh.primitive_ico_sphere_add)。
这支持目录声明的参数含义，但不等于 OperatingLine 已在真实宿主中回放整条物化轨迹。

## 决策

InteractionCatalog `1.13.0` 继续精确绑定 ActionCatalog `1.12.0`，并为
`blender.mesh.create_icosphere` 增加独立的 `ordered_parameter_operations` menu 声明。输出严格为六步：

1. `Layout`；
2. `Layout → Add`；
3. `Layout → Add → Mesh`；
4. `Layout → Add → Mesh → Ico Sphere`，参数为 accepted action 的 `subdivisions` 与 `radius`；
5. `Sidebar → Item → Transform → Location`，参数 `value` 为 accepted action 的三维 `location`；
6. `Outliner → Object Name`，参数 `value` 为 accepted action 的 `objectName`。

内部资源身份 `resourceId` 由声明显式省略，不进入任何 UI operation。六步菜单使 coverage 的 menu 状态为
`materialized`，因此单独的 Icosphere 结果使用 MaterializationResult `1.1.0`。Icosphere 没有声明 shortcut，
不得从 UV Sphere 的轨迹推导或复用；shortcut 保持 unavailable。MCP 同样保持 unavailable，因为仓库还没有
能与该 accepted action 一一对应、经过审批和版本验证的真实 action-level MCP tool。目录中存在
`operatingline.procedure.authoring.materialize` 只表示“生成轨迹”，不表示它能执行 Icosphere action。

InteractionCatalog `1.12.0` 冻结为不可变历史快照，继续精确回放 UV Sphere 的 `1.2.0` shortcut 结果。

## 约束与验证

- 参数值只能来自已经通过 ActionCatalog Schema 验证的顶层 action arguments；语义 operation 文本和参数
  不能覆盖它们。
- 安装期覆盖检查继续要求所有顶层 Action 参数在 menu 模态中恰好映射或带理由省略。
- materializer 必须保持输入 candidate 不变，并从 catalog recipe 重建 track/operation identity。
- 单元和 MCP/HTTP 集成测试精确断言六步顺序、参数值、`resourceId` 省略、Result `1.1.0`、shortcut/MCP
  unavailable，以及历史 `1.12.0` 回放。
- 结果 leaf 仍是 `candidate`，`validatedHostVersions` 仍为空；完整 Result 信封只证明目录 grounding，
  不证明真实 Blender 执行成功或状态等价。
- 原生 operator/menu 只表达几何创建入口和可见 UI 参数，不等价于 Action executor 负责的 managed
  collection 归属、resource tag、幂等 receipt 或补偿边界；这些执行语义没有进入 menu 轨迹，结果继续是
  `candidate`/`structural_only`。

## 后果

- 同一通用 DSL 现在覆盖两种不同 primitive 参数形状，且不会把 UV Sphere 特有的 Scale/shortcut 错配给
  Icosphere。
- 训练或 RAG 导出可以区分 catalog-grounded menu、未声明 shortcut 与不存在的 action-level MCP 工具，
  但仍不得把 candidate 轨迹标为真实执行样本。
- 后续 action 必须各自提供封闭声明、版本快照、精确参数覆盖和真实宿主证据；不能仅因共享菜单前缀而自动
  获得 available 轨迹。

## 未选择方案

- **复用 UV Sphere 的七步菜单**：Icosphere Action schema 不暴露独立 `scale` 参数，复用会丢失
  `subdivisions` 并制造错误步骤。
- **根据 `native_path` 自动物化所有 primitive**：native guidance 只证明菜单入口，不定义逐控件参数、遗漏
  理由或模态完整性。
- **把 Orchestrator materialize tool 记作 MCP 执行轨迹**：该工具不调用 Blender action，语义层级不同。
- **同时猜测 Icosphere 快捷键**：缺少封闭声明和真实回放证据，必须保持 unavailable。
