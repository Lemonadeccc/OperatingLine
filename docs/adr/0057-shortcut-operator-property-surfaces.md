# ADR 0057：快捷键驱动的 Operator 参数面板操作

- 状态：Accepted
- 日期：2026-08-15

## 背景

现有 ordered shortcut 只能把参数挂在按键 operation 上，适合 `G X`、`S`、`F2` 等一次键盘序列，
却无法无歧义表达 Blender 中“先创建对象，再按 `F9` 打开 Adjust Last Operation，按顺序修改多个控件，
最后确认”的交互。若把多个参数继续塞进 `F9` operation 的无序参数对象，训练、检索和回放都无法知道
每个值属于哪个控件、位于哪一步，也无法判断参数面板何时打开或关闭。

Blender 的 `screen.redo_last` 只能证明可请求最后一次 operator 的参数面板；焦点、像素位置和 `Tab`
顺序不是稳定协议。因此本决策先建立可验证的数据模型与精确检索，不把尚未完成真实双版本 UI 回放的
Icosphere shortcut 标记为 available。

## 决策

InteractionCatalog shortcut operation 保留原有无 `kind` 形状以逐字解析历史目录，并新增两个显式类型：

1. `key_input` 表示有序键盘输入。普通输入继续携带 `keyMode`、`keys[]`、可选 `selectionPath[]` 和有序
   参数赋值；surface opener 必须是紧跟来源 operation 的无参数 `F9` sequence，并声明
   `opensSurface.kind: adjust_last_operation`、`hostId: screen.redo_last`、来源 operation ID 和预期 Blender
   operator ID。预期 operator 必须等于同一 native guidance 的 execution operator。
2. `operator_property_update` 表示在已打开 surface 上修改一个明确控件。它引用 opener operation ID，
   `target.hostId` 必须位于 `<expectedOperatorId>.<property>` 命名空间，`path[]` 保留可读交互路径，且
   `parameters[]` 恰好包含一个名为 `value` 的赋值。多个 property operation 必须连续，控件 target 不得
   重复；最后由无参数 `ENTER` sequence 显式引用并关闭同一 opener。

目录和 ProcedureTree 验证器都用状态机拒绝断链、嵌套 surface、跨 operator target、空属性后缀、重复
控件、非连续更新、无更新关闭或未关闭 surface。Blender Extension 的 Python loader 执行相同验证，
避免 TypeScript 接受而宿主解析器拒绝，或反向产生宽松解释。

只要一次 materialization 实际使用 `operator_property_update`，该结果中的所有 shortcut key operation
都会规范化为 `kind: key_input`，输出 ProcedureTree `1.1.0` 和 MaterializationResult `1.3.0`。这样同一
tree 不混用隐式旧形状与显式新形状。没有 property operation 的旧目录仍输出原来的 ProcedureTree
`1.0.0` 和 Result `1.0.0`、`1.1.0` 或 `1.2.0`，内容与版本选择不变。

Persistence schema 14 为不可变 Procedure operation 派生索引增加 `operationKind`、`targetHostId`、
`interactionPath`、`surfaceOperationId` 和 `expectedOperatorId`。opener、全部 property update 和 closer
共享 opener 自身的 `surfaceOperationId` 与预期 operator，因此调用方能用精确 AND selector 取回完整
surface 链，也能按单个 property target/path 检索。迁移从原始不可变树重建索引；若迁移在写入版本标记
前中断，下次启动会再次重建。Runtime 返回结果前仍从原树核对索引上下文，不从索引直接构造 operation。

## 兼容性与边界

- 现有 InteractionCatalog `1.20.0` 没有修改；UV Sphere、Cube 与 Plane 的旧 shortcut 仍使用无 `kind`
  operation，并继续输出 Result `1.2.0` / ProcedureTree `1.0.0`。
- Icosphere、Torus、Cone 与 Cylinder shortcut 继续 unavailable；本决策没有把协议表达能力伪装成已验证
  Blender 回放。
- 输出仍为 `candidate`、空 `validatedHostVersions` 和 `structural_only`，不会保存树、创建 Proposal 或
  执行宿主动作。
- `target.hostId` 是版本化的逻辑控件身份，不是像素坐标；本协议不承诺 Blender 的焦点顺序、鼠标位置或
  通用 `Tab` 导航。
- 将来启用具体 recipe 前，仍需 Blender 4.5/5.1 前台键盘/控件回放、参数结果 Observation、失败恢复、
  原生 Undo 证据，以及与 managed action 语义差异的明确记录。

## 未选择方案

- **把多个字段放进 F9 operation 的参数对象**：对象键顺序不能表达控件身份、surface 生命周期和逐步回放。
- **记录像素点击或假定 Tab 顺序**：窗口尺寸、主题、区域布局和 Blender 版本都会改变这些细节。
- **由 property 名猜 action argument**：控件属性与 ActionCatalog 参数可能需要 literal、分量投影或封闭
  transform，必须继续使用显式 parameter source。
- **现在启用 Icosphere shortcut**：打开 F9 面板不等于已证明两个字段都能按值输入、确认并通过结果观察。
