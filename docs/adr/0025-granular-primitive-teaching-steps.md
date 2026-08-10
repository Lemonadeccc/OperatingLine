# ADR 0025：教学模式按部件拆分 Primitive 叶节点

- 状态：已接受
- 日期：2026-08-10

## 背景

雪人 revision 4 把脸部、纽扣和手臂分别装进三个
`blender.mesh.create_primitive_batch` 叶节点。批量动作具有确定性的原子预检与补偿能力，适合机器人
基准或明确要求成组提交的计划，但它无法诚实回答“当前正在添加哪一个部件”，也无法把一个叶节点
映射到 Blender 的一个 `Add → Mesh → primitive` 最终菜单项。一次 `Back` 还会撤销整个批次，用户
不能单独修改鼻子、某个纽扣或某条手臂。

## 决策

发布 Blender ActionCatalog `1.4.0`：

- 新增 `blender.mesh.create_cone` 与 `blender.mesh.create_cylinder`；
- 保留 `blender.mesh.create_uv_sphere`、`blender.mesh.create_plane` 和
  `blender.mesh.create_primitive_batch`；
- 直接动作与批量动作复用同一套参数校验、无上下文 mesh 创建、资源身份、receipt 和补偿实现；
- 教学计划优先使用“一项有意义的部件对应一个可执行叶节点”，只有明确需要原子成组创建时才使用
  batch。

同时发布 Blender InteractionCatalog `1.1.0`，精确绑定 ActionCatalog `1.4.0` 的 12 个动作。
Plane、UV Sphere、Cone 和 Cylinder 使用经过 Blender 4.5.3/5.1.1 验证的四条 `native_path`；其余
八个动作继续使用明确的 `semantic_path`。

雪人教学计划升级到 revision 5，共 25 个线性可执行叶节点。两只眼睛、鼻子、五个嘴点、三个纽扣
和两条手臂分别拥有独立 action、观察、receipt、全局序号、树节点引用以及 `Back` 边界。历史
revision 4 fixture 和 ActionCatalog `1.3.0` 保持原样，供既有 Human Eval 哈希与精确回放使用。

## 版本与兼容性

- `action-catalog-1.3.0.json` 与 `interaction-catalog-1.0.0.json` 是不可变历史快照；注册表继续支持
  精确版本查询。
- 当前 Blender Extension 打包 `snowman-teaching.plan.json` revision 5，但扩展内资源名称仍保持
  `snowman.plan.json`，不改变宿主加载接口。
- `protocol/fixtures/v1/snowman.plan.json` revision 4 不再是当前打包计划；它只作为已发布 Eval 套件
  的冻结输入保留。
- 机器人 catalog `1.2.0` benchmark 继续使用 batch，证明此次变化没有删除快速/原子组合路径。

## 失败语义

- Cone/Cylinder 的起点和终点相同、半径越界或 Cone 两端半径同时为零时，写入前失败。
- 名称或 logical ID 冲突只阻止当前叶节点，不前进索引，也不删除已完成的其他部件。
- 点击不匹配当前叶节点的 Blender 菜单项仍被拒绝；只有 InteractionCatalog 中精确绑定的最终
  operator 能进入与 `Next` 相同的 action/receipt 路径。
- 外部修改导致补偿不安全时保留资源、receipt 与当前索引，允许用户解决冲突后重试。

## 未选择的方案

- **删除 batch**：会破坏机器人基准和有意的原子成组创建语义。
- **只拆 GuidePlan、不新增直接 Cone/Cylinder action**：叶节点仍只能伪装成 batch，无法绑定真实最终
  菜单项。
- **让一个 batch recipe 根据 items 动态伪装成多个 native path**：一个 receipt 仍对应多个对象，
  与用户看到的单步执行和单步回退不一致。

## 后果与后续

当前雪人的建模细节已经能随树叶节点切换真实 Sphere/Cone/Cylinder 菜单目标，并逐件前进、回退和
引用。它仍不代表 Blender 全功能覆盖。Cube、Icosphere、Torus、Edit Mode、Modifier、Sculpt、UV、
Geometry Nodes、权重绘制以及更完整的骨骼工作流，需要各自的 action 参数、观察、补偿、recipe 和
真实宿主版本测试后才能声明支持。
