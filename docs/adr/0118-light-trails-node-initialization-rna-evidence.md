# ADR 0118：Light Trails 节点初始化 RNA 写入证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0110](0110-light-trails-local-operation-execution.md)、[ADR 0117](0117-light-trails-rna-control-write-evidence.md)

## 背景

ADR 0117 已把十二项 accepted 参数展开为十五次可验证的 RNA 控件写入，但创建节点时设置的 mode、operation、
noise dimensions、默认标量与向量分量仍只隐含在最终节点状态中。学习者可以看到“创建节点”，却看不到该大步骤
内部真实执行的 `01 → 02 → 03`；训练数据也无法区分 Blender 默认值与执行器显式写入的值。

这些初始化不能由 MCP 调用方自由指定。它们属于已冻结的 Light Trails recipe，必须从 accepted replay、当前
operation 和目录常量派生，并在 Blender 写入后立即回读。Blender 4.5 与 5.1 对
`GeometryNodeResampleCurve` 的 Count mode 暴露不同 RNA 表面：4.5 使用节点 `mode`，5.1 使用 `Mode` 输入 socket。
在没有宿主版本分支 schema 时，不能把两者伪装成一个稳定的跨版本目标。

## 决策

Light Trails 的节点创建 operation 04、06、08、14、19、20、24、26、30 现在通过专用初始化写入函数执行稳定的
node property、input socket scalar 或 vector component 写入。完整执行形成九组、三十九条有序记录：

- 04 Half Tile Line：mode、Start X/Y/Z、End X/Y/Z，共 7 条；
- 06 Trail Resolution：Count，共 1 条；
- 08 Trail Rows：mode、Count、Start Location X/Y/Z、Offset X/Y/Z，共 8 条；
- 14 Terrain Noise：noise dimensions、Scale、Detail、Roughness、W，共 5 条；
- 19 Center Noise 与 20 Scale Height：各记录 operation 与第二个 Value，共 2 条；
- 24 Mirror Half Tile：Scale X/Y/Z，共 3 条；
- 26 Trail Profile：mode、Resolution、Radius，共 3 条；
- 30 Loop Tiles：mode、Count、Start Location X/Y/Z、Offset X/Y/Z，共 8 条。

每次写入都保存 `rnaInitializationWrites`，包括数组顺序、源 operation、语义动作、固定 MCP 工具、node-group
logical ID/name、精确 node name/type、目标种类、property/socket、标量或向量分量、值来源、assigned/observed
值和稳定 UI 语义路径。operation 30 的 Offset.X 从 accepted `tileLength` 派生，其余值为固定 recipe 常量；
数值 observed 使用 Blender float32 表示。

协议只接受与当前 operation 完整且同序的目标集合。Runtime 从不可变 accepted replay 独立重建整个数组，并随
其余 evidence 执行 canonical equality；调用方不能提交任意 node、socket、property、常量或顺序。字段对历史
持久结果保持可选，但所有新派发 Light Trails operation 都必须包含精确数组，非初始化 operation 必须为空数组。

Guided Control 使用同一稳定目标表，把 focused 节点创建步骤展开为 `04.01…04.07`、`24.01…24.03`、
`30.01…30.08` 等行，逐行显示 node、property/socket、分量和 assigned 值。这些行如实标记为
`INITIAL RNA`；当前不声称拥有通用节点属性的原生像素定位或鼠标点击执行。

`GeometryNodeResampleCurve` 的 Count mode 仍由 Blender 版本适配器执行和最终图 Observation 验证，但不进入
这组三十九条跨版本精确目标证据。只有引入明确的 host-version variant schema 后，才能分别证明 4.5 的
`node.mode` 与 5.1 的 `Mode.default_value`。

## 结果与边界

- 九个节点创建 operation 的稳定初始化细节现在成为可视、可持久、可训练和可检索的顺序数组，而不只存在于
  最终节点图。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均通过 54 次正向、54 次逆向、补偿、Abort 与完成；
  双版本 Companion E2E 均通过 54 次 delivery/result、强 Observation、原生 checkpoint 和零 Bake。
- 这是固定 Light Trails recipe 的 receipt-bound RNA 初始化执行器，不是任意 Geometry Nodes 图、节点搜索、
  拖线、逐像素菜单/快捷键回放或通用 action-level Python 入口。
- 未显式记录的宿主默认值、版本专属 RNA、其它节点类型、Modifier、Edit Mode、骨骼和动画仍需按同样方式逐项扩展。
- 二十个节点本体与 Group I/O interface-before-node 顺序由
  [ADR 0120](0120-light-trails-rna-structure-creation-evidence.md) 另行记录；本 ADR 仍只定义节点创建后的配置写入。
