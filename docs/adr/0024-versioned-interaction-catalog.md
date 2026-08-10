# ADR 0024：版本化宿主交互目录

- 状态：已接受
- 日期：2026-08-10

## 背景

GuidePlan 的叶节点已经用 `action(adapterId, name, arguments)` 表达确定性宿主操作，也可携带
`operator.menuPath` 作为语义参考。此前 Blender 原生菜单引导仍在 Python 中硬编码
`Add → Mesh → Plane/UV Sphere`。这会产生三个问题：

- 活动树叶节点和菜单路径之间没有独立、可版本化、可测试的数据契约；
- AI 生成的 anchor 可能错误，不能作为可点击宿主控件的执行权威；
- 批量动作、材质、骨骼、动画和渲染没有真实单控件映射时，系统只能隐藏路径或冒险复用无关路径。

ActionCatalog 回答“宿主允许执行什么”，但不应混入某一宿主版本的 UI 布局。需要一个独立目录回答
“这个已接受 action 在当前宿主版本中如何教学展示，以及能否绑定真实控件”。

## 决策

通用协议新增严格的 `InteractionCatalog`：

```text
InteractionCatalog
  ├─ adapterId + catalogVersion
  ├─ exact actionCatalogVersion
  ├─ adapter/host version ranges
  └─ one recipe per ActionCatalog action
       ├─ ordered interaction steps
       │    └─ label + intent + target(kind, hostId)
       └─ guidance
            ├─ native_path
            │    └─ surface + preconditions + exact final operator binding
            └─ semantic_path
                 └─ explicit reason + optional manual reference
```

`native_path` 的最后一步必须是 `operator` target，并通过
`binding: accepted_plan_action` 绑定同一个已接受叶节点动作。点击该控件不直接执行目录中的裸 operator
参数，而是进入现有 Session `Next` 路径，产生同一 receipt 和 `Back` 结果。

`semantic_path` 只提供有序参考。宿主必须明确显示 `UI target unavailable`，不得把它绘制成可点击
原生目标或猜测像素坐标。目录校验要求 recipe ID、action、步骤 ID、步骤序号和标签无歧义，并可与
精确 ActionCatalog 做一一覆盖校验。

Blender InteractionCatalog `1.0.0` 绑定 ActionCatalog `1.3.0` 的全部 10 个动作：

- `blender.mesh.create_plane` 与 `blender.mesh.create_uv_sphere` 是经过 Blender 4.5/5.1 测试的
  `native_path`；
- 批量几何、材质、骨骼、动画和渲染动作是八条显式 `semantic_path`；
- 活动叶节点按 `actionName` 选择 recipe。Plan anchor 仍可解释意图，但不能劫持可点击目标；
- 相同 action 的不同语义部件会诚实复用同一路径。例如雪人的三个身体球都需要 UV Sphere；不同
  action 则切换为自己的路径。

## 版本与兼容性

- InteractionCatalog 独立于 ActionCatalog 版本；本目录使用 `1.0.0` 并精确声明
  `actionCatalogVersion: 1.3.0`。
- JSON Schema 是宿主无关的；`hostId` 与 target kind 的具体含义由适配器及其宿主版本拥有。
- Blender Extension 打包时把规范目录从 `adapters/blender/catalog/v1` 同步到 Extension resources；
  TypeScript 与 Python 启动路径都执行严格校验。
- 当前 GuidePlan、Proposal、Planner Packet 与 Companion transport 信封不变。InteractionCatalog
  先作为宿主呈现契约，后续再决定是否加入 MCP 查询和 Eval bundle。

## 失败语义

- 缺少或重复 action recipe、未知 action、目录身份不匹配：目录加载失败，不启用含糊引导。
- native execution step 不存在、不是最后一步、target/operator 不一致：目录加载失败。
- 活动 action 只有 semantic recipe：视口显示灰色有序参考路径和不可用提示，真实 Blender 菜单保持
  原样，`Next` 继续可用。
- 活动 action 不在目录：沿用 Plan anchor 的语义文字 fallback，不创建可点击控件。

## 未选择的方案

- **继续在 Python 中按 action 写条件分支**：无法形成跨宿主、可导出和可版本化的数组契约。
- **相信 AI 生成的 `operator.menuPath`**：Plan anchor 是非执行语义，不能证明控件在某版本真实存在。
- **把所有语义路径都染成绿色并允许点击**：会把多资源事务伪装成一个 Blender 菜单动作。
- **把 UI 路径直接塞进 ActionCatalog**：会耦合执行能力与易变的宿主呈现版本。

## 后果与后续

当前树叶节点已经能够确定性选择不同路径，目录也可被第二宿主复用同一 Schema 实现。但这不等于
全部 Blender 功能已有原生引导。下一阶段应把教学模式中的批量 primitive 拆为“一部件一叶节点”，再
增加 Cube/Icosphere/Torus、Edit Mode、Modifier 和 Geometry Nodes 的 action、recipe、观察、回退与
真实宿主截图测试。Geometry Nodes 还需要新增 `node`、`socket`、`link`/node-group 级适配器约束。
