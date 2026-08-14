# ADR 0053：Cone 线段坐标系有序菜单物化

- 状态：Accepted
- 日期：2026-08-14

## 背景

ADR 0046–0052 已建立目录绑定的 Procedure materialization，并为 UV Sphere、Icosphere、
Cube、Plane 与 Torus 提供封闭、可安装期验证的轨迹声明。Cone 已有 Blender 4.5/5.1
的原生 `Layout → Add → Mesh → Cone` guidance，Action 参数为 `start`、`end`、
`radiusStart`、`radiusEnd`、`objectName` 与内部 `resourceId`，但 InteractionCatalog `1.16.0`
没有为它声明 Procedure materialization。

Blender 原生 `mesh.primitive_cone_add` 接受深度、两端半径、世界变换与构网选项，而
Action 以两个世界端点表达几何。目录因此需要封闭的双 Action 参数派生，以确定性地将
`start`/`end` 映射为 operator 的 depth、rotation 和后续 Location。既有 Blender 4.5.3/5.1.1
测试使用同一组显式 operator 参数探测了原生 Cone 结果，但这不是对六步 UI operation
的逐控件 replay。

## 决策

InteractionCatalog `1.17.0` 继续精确绑定 ActionCatalog `1.12.0`，冻结
InteractionCatalog `1.16.0` 为不可变历史快照，并为 `blender.mesh.create_cone` 增加独立的
`ordered_parameter_operations` menu 声明。输出严格为六步：

1. `Layout`；
2. `Layout → Add`；
3. `Layout → Add → Mesh`；
4. `Layout → Add → Mesh → Cone`，operator 参数严格按以下顺序生成：
   `vertices: 32`、`radius1 ← radiusStart`、`radius2 ← radiusEnd`、
   `depth ← distance`、`end_fill_type: "NGON"`、`calc_uvs: false`、
   `enter_editmode: false`、`align: "WORLD"`、`location: [0, 0, 0]`、
   `rotation ← rotation_euler_xyz_align_z`、`scale: [1, 1, 1]`；
5. `Sidebar → Item → Transform → Location`，参数 `value` 为线段中点；
6. `Outliner → Object Name`，参数 `value` 为 accepted action 的 `objectName`。

旋转后的本地 `-Z` 端是 `radius1`，对应 `start`/`radiusStart`；本地 `+Z` 端是
`radius2`，对应 `end`/`radiusEnd`。这一方向约定与 `rotation` 将本地 `+Z` 对齐
`end - start` 一致，不得交换两端半径。

内部 `resourceId` 由声明显式省略，不进入 UI operation。Cone 没有封闭 shortcut 声明，
也没有能与 accepted Cone action 一一对应、经过审批和版本验证的真实 action-level MCP
tool；shortcut 与 MCP 均保持 unavailable。六步菜单使 coverage 的 menu 状态为
`materialized`，单独的 Cone 结果因此使用 MaterializationResult `1.1.0`。

### 封闭线段坐标系派生

`derived_action_arguments`/`segment_frame` 只接受两个不同的、通过 ActionCatalog Schema
验证的有限三维数组。对 `start = [sx, sy, sz]` 与 `end = [ex, ey, ez]`：

```text
dx = ex - sx
dy = ey - sy
dz = ez - sz
horizontal = hypot(dx, dy)
distance = hypot(horizontal, dz)
midpoint = [(sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2]
rotation = [0, atan2(horizontal, dz), horizontal === 0 ? 0 : atan2(dy, dx)]
```

`distance` 必须为有限非零数。所有派生标量和向量分量都把 IEEE-754 `-0` 规范化为
`0`。同一对 `start`/`end` 必须将 `distance`、`midpoint` 与
`rotation_euler_xyz_align_z` 三个输出各恰好映射一次；端点参数不得另行直接映射、省略或
参与其他 segment-frame 对。

`rotation` 是将原生 Cone 的本地 `+Z` 轴对齐 `end - start` 的 canonical XYZ Euler，并固定
X 旋转为零以选择一个确定性 zero-roll 表示。它不声称与 managed executor 内部的
quaternion/roll 选择精确等价；两者只共享将局部 `+Z` 轴对齐线段的目标。

## 约束与验证

- 目录安装期必须验证端点参数存在、形状为固定三项数值数组，且三个 segment-frame
  输出各恰好一次。
- 每个顶层 Action 参数仍必须在 menu 模态中恰好映射或带理由省略；`resourceId` 是唯一省略项。
- materializer 必须保持输入 leaf 为 `candidate`、`validatedHostVersions` 为空，并从 catalog recipe
  重建 track/operation identity。
- Result `1.1.0` 只证明目录 grounding；通用 compile 继续报告
  `interactionTracks: structural_only`。
- 测试断言六步顺序、十一个 operator 参数的精确顺序与值、三个派生输出恰好一次、
  `-0` 规范化、无效端点失败关闭、`resourceId` 省略、Result `1.1.0`、shortcut/MCP
  unavailable，以及历史 `1.16.0` 精确回放。
- Blender 4.5.3/5.1.1 原生 operator 双版本探针只证明明示参数能调用 operator 并生成预期
  Cone；它不是对六步 menu/control operation 的真实 UI replay。
- 原生菜单/operator 不提供 OperatingLine 的 managed collection、resource tag、receipt、
  idempotency 或 compensation 契约，因此不得把轨迹晋升为 verified 宿主执行样本。

## 后果

- 同一 ordered-parameter DSL 现在覆盖 UV Sphere、Icosphere、Cube、Plane、Torus 与 Cone，
  同时保持每个 action 的参数形状和 provenance 独立。
- 调用方可以区分 catalog-grounded Cone menu、未声明 shortcut 与不存在的 action-level MCP
  工具。
- Cone 输出仍是 `candidate`/`structural_only`。后续晋升需要 Blender 4.5/5.1 的逐
  operation UI replay、Observation、恢复与执行语义证据。
- 下一个 primitive 菜单物化切片是 Cylinder。

## 未选择方案

- **只把 `start` 当作 location**：会丢失终点与 action 以线段为中心的几何语义。
- **让模型或语义 operation 文本计算深度与旋转**：不可安装期验证，也不能保证重放稳定。
- **复用 managed executor 的 quaternion 或声称 roll 完全相同**：Procedure operation 需要一个封闭的
  XYZ Euler，两种表示的 roll 选择不必精确一致。
- **用派生中点直接作为 operator `location`**：该 recipe 需要稳定的 operator 参数顺序与显式
  `location: [0,0,0]`，再用独立 Location control 教学世界中点。
- **把 Orchestrator materialize tool 记作 MCP 执行轨迹**：该工具只生成轨迹，不调用 Blender action。
- **把原生 operator 探针当作六步 UI replay 或 managed action executor**：它不覆盖逐控件 UI，
  也不提供 collection、tag、receipt、idempotency 与 compensation。
