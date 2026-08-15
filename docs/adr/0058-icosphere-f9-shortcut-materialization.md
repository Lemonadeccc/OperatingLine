# ADR 0058：Icosphere F9 候选快捷键物化

- 状态：Accepted
- 日期：2026-08-15

## 背景

ADR 0057 已定义 `F9` opener、逐控件 `operator_property_update` 和 `ENTER` closer 的严格状态机，
但 InteractionCatalog `1.20.0` 没有使用该能力。Icosphere 因而只有精确的菜单轨迹，无法把
“创建默认对象，再在 Adjust Last Operation 中依次设置 Subdivisions 与 Radius”保存为可检索、可训练治理的
有序候选操作。

仅调用 `bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=..., radius=...)` 能验证几何结果，却不能证明
`Shift+A`、原生菜单、`F9` 弹窗、控件文本输入和确认事件确实可用。反过来，只看见弹窗也不能证明参数已按
顺序写入并重新生成网格。

## 决策

冻结 InteractionCatalog `1.20.0`，发布仍精确绑定 ActionCatalog `1.12.0` 的 `1.21.0`。Icosphere 的
candidate-only shortcut 按以下顺序声明：

1. `Shift+A → Mesh → Ico Sphere` 创建默认 Icosphere；
2. `F9` 打开 `screen.redo_last`，来源 operation 为创建步骤，预期 operator 为
   `mesh.primitive_ico_sphere_add`；
3. 在同一 surface 上把 accepted action 的 `subdivisions` 写入
   `mesh.primitive_ico_sphere_add.subdivisions`；
4. 再把 accepted action 的 `radius` 写入 `mesh.primitive_ico_sphere_add.radius`；
5. `ENTER` 显式关闭同一 surface；
6. `G X`、`G Y`、`G Z` 依次绑定 `location` 三个分量；
7. `F2` 绑定 `objectName`，内部 `resourceId` 继续显式省略。

该轨迹要求 `Layout`、`VIEW_3D`、`OBJECT`、Blender keymap、世界原点 3D Cursor 和 GLOBAL Transform
Orientation。只要物化该 shortcut，输出使用 ProcedureTree `1.1.0` 与 MaterializationResult `1.3.0`；
菜单轨迹保持原样，MCP 仍为 unavailable。

新增前台回放从真实 `VIEW_3D` 中心注入 `Window.event_simulate` 事件，每个主循环只提交一个事件。测试在
Blender 4.5.3 LTS 与 5.1.1 中都完成 `Shift+A → Mesh → Ico Sphere → F9`，按顺序输入
`Subdivisions = 3`、`Radius = 2.5` 并发送 `ENTER` 关闭事件。最终 Observation 断言 operator 属性、对象身份、
162 个顶点以及全部顶点半径约为 `2.5`。Node launcher 对每个已安装版本分别启动隔离进程，并在 Blender
退出码为零时仍强制校验结构化结果。

F9 控件没有公开的坐标发现 API。回放坐标因此只存在于版本固定的测试夹具中，以 `VIEW_3D` 中心和
Blender UI scale 计算；它不是 InteractionCatalog 的控件身份。弹窗打开期间不调用 Blender screenshot
operator，因为该 operator 会关闭临时弹窗。

## 兼容性与边界

- `1.20.0` 保持逐字历史快照，其中 Icosphere shortcut 仍为 unavailable。
- 新轨迹仍是 `candidate`、空 `validatedHostVersions` 与 `structural_only`；目录物化不执行 Blender，也不
  自动保存 ProcedureTree、创建 Proposal 或绕过审批。
- 双版本回放证明创建与 F9 参数链可操作并产生声明的 primitive 几何；它没有完整回放后续 `G X/Y/Z`、
  `F2`，也不证明 managed collection、resource tag、receipt、幂等或补偿语义等价。
- 失败时 harness 会写结构化失败结果并终止隔离进程；这不是产品级 Observation 成功门、恢复策略或
  Blender 原生 Undo 集成。后者继续作为执行层工作。
- 当前没有与 accepted Icosphere action 一一对应并经过审批的 action-level MCP tool，因此不得从 Blender
  operator 名称推导 MCP function。

## 未选择方案

- **直接调用 mesh operator 代替 UI 回放**：不能证明菜单、`F9`、控件顺序和确认事件。
- **把两个值放进 F9 operation 的参数对象**：会丢失控件身份、顺序和 surface 生命周期。
- **把测试坐标写入目录**：坐标受窗口、DPI、UI scale 与版本影响，不是稳定语义协议。
- **把候选轨迹标记为 verified/executable**：当前证据不覆盖恢复、Undo、审批和 managed action 等价。
