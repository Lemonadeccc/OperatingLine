# ADR 0048：候选快捷键 Procedure 物化

- 状态：已接受
- 日期：2026-08-14

## 背景

ADR 0047 已能从受信 InteractionCatalog 物化 UV Sphere 的菜单和逐控件参数，但快捷键仍固定为
unavailable。通用 ProcedureTree fixture 虽保存了 `Shift+A`、`G → X/Y/Z`、`S` 和 `F2`，目录却没有可安装期
校验的声明；原有 `keys[]` 也不能区分同时按下的 chord 与依次输入的 sequence。直接信任模型生成的快捷键或
参数会破坏目录边界，也不适合形成可复现的训练样本。

## 决策

InteractionCatalog `1.12.0` 新增封闭的 available-shortcut 分支。该分支固定声明
`source: catalog.ordered_shortcut_operations`、`semanticBinding: all_leaf_operations`、
`parameterBinding: ordered_parameter_operations` 与 `projection: candidate_only`，并携带完整前置条件、有序
`operations[]` 和显式 `omittedActionArguments[]`。

每个 operation 包含唯一 `id`/`label`、`keyMode: chord | sequence`、非空 `keys[]`、可选非空
`selectionPath[]`，以及非空的有序参数赋值数组；不得额外维护 `order` 或 after 链。数组顺序分别表示轨迹、
按键、菜单选择与参数输入顺序。通用 ProcedureTree 为历史树保留可选 `keyMode`，但 MaterializationResult
`1.2.0` 中的 available shortcut 必须显式携带它。

前置条件中的 `workspace`、`editor`、`mode`、`keymap` 各恰好出现一次；所有 `(kind, label)` 组合唯一，因此
`scene_state` 可声明多个不同状态，却不能用重复或冲突条目制造含糊的回放环境。

参数 DSL 继续禁止 JSON Pointer、算术和任意表达式，并增加 `vector3_x`、`vector3_y`、`vector3_z` 三种封闭
投影。component 模式必须针对固定三元素数值数组，且在同一替代轨迹内恰好覆盖 x/y/z 各一次；不得与
`identity` 或 `uniform_vector3` 混用。menu 与 shortcut 各自都必须完整覆盖每个 Action 顶层参数，或带理由
省略，不能跨轨迹互相补足。

UV Sphere 的候选快捷键轨迹为：

1. `Shift+A` chord，选择 `Mesh → UV Sphere`，以 literal 记录单位球与原点；
2. `G → X` sequence，输入 `location[0]` 并确认；
3. `G → Y` sequence，输入 `location[1]` 并确认；
4. `G → Z` sequence，输入 `location[2]` 并确认；
5. `S` sequence，输入 `radius` 并确认；
6. `F2` sequence，输入 `objectName` 并确认。

前置条件明确绑定 Layout、3D Viewport、Object Mode、Blender 默认 keymap、原点 3D Cursor 与 GLOBAL Transform
Orientation。Blender 4.5/5.1 官方手册记录了相同的
[Mesh Add](https://docs.blender.org/manual/en/4.5/modeling/meshes/primitives.html)、
[Move](https://docs.blender.org/manual/en/4.5/scene_layout/object/editing/transform/move.html)、
[Axis Locking](https://docs.blender.org/manual/en/4.5/scene_layout/object/editing/transform/control/axis_locking.html)、
[Numeric Input](https://docs.blender.org/manual/en/4.5/scene_layout/object/editing/transform/control/numeric_input.html)、
[Scale](https://docs.blender.org/manual/en/4.5/scene_layout/object/editing/transform/scale.html) 与
[Rename](https://docs.blender.org/manual/en/4.5/files/blend/rename.html) 入口；这些文档只支持候选教学声明，不替代
本项目的真实宿主回放与 Observation。

## 版本与兼容

InteractionCatalog `1.11.0` 逐字冻结；`1.9.0` 无物化、`1.10.0` 四步 legacy menu、`1.11.0` 七步 ordered
menu 的行为保持不变。结果格式按本次实际使用的最高能力选择：legacy/unavailable 为 `1.0.0`，ordered menu
为 `1.1.0`，任一 available shortcut 为 `1.2.0`。最新目录中的 actionless-only 树仍返回 `1.0.0`。
公开 Result 契约同时要求 `1.1.0` coverage 至少包含一个 materialized menu，`1.2.0` coverage 至少包含一个
materialized shortcut，避免高版本信封与实际声明能力脱节。

menu 与 shortcut 是同一叶子的替代轨迹，不得串联或双重执行。MCP 仍明确 unavailable。

## 候选边界

`G X/Y/Z` 是相对移动，只有对象从原点创建且 Transform Orientation 为 GLOBAL 时才投影为目标 world
location；`S radius` 仍会改变 Object scale，而当前 Action executor 把 radius 烘焙进 Mesh。两条轨迹都不
构成宿主状态等价证明。

因此输出继续保持 `candidate`、空 `validatedHostVersions`、`interactionTracks: structural_only`，且不得自动
保存、创建 Proposal 或执行 Blender。真实 Blender 4.5/5.1 回放、active-object Observation、失败恢复、
verified attestation 和 MCP 函数映射仍属于后续工作。
