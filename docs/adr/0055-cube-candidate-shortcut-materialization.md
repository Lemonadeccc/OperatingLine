# ADR 0055：Cube 候选快捷键物化

- 状态：Accepted
- 日期：2026-08-15

## 背景

ADR 0046–0054 已建立目录绑定的 Procedure materialization。InteractionCatalog `1.14.0`
起，`blender.mesh.create_cube` 已有精确的六步 ordered menu：四步原生
`Layout → Add → Mesh → Cube` guidance，随后是 Location 与 Object Name。该声明把 accepted
action 的完整边长 `size` 直接绑定到 operator，并显式省略内部 `resourceId`，但 shortcut 一直
保持 unavailable。

Blender 默认 `mesh.primitive_cube_add` 的 `size` 为 `2`、`location` 为 `[0,0,0]`。因此 accepted
Cube action 可以通过一个封闭、可安装期验证的候选快捷键投影表达：创建默认 Cube，分别沿 GLOBAL
X/Y/Z 移动到 accepted `location`，以 `size / 2` 等比缩放，再重命名。该轨迹只用于教学与
grounding；它不是 managed executor 的执行实现。

## 决策

InteractionCatalog `1.19.0` 继续精确绑定 ActionCatalog `1.12.0`，冻结 InteractionCatalog
`1.18.0` 为不可变历史快照，并保留 Cube 既有六步 menu。Cube shortcut 声明为
`candidate_only`，使用与 UV Sphere shortcut 相同的六项前置条件：

1. workspace 为 `Layout`；
2. editor 为 `VIEW_3D`；
3. mode 为 `OBJECT`；
4. keymap 为 `Blender`；
5. 3D Cursor 为 `[0,0,0]`；
6. Transform Orientation 为 `GLOBAL`。

shortcut 严格包含六个有序 operation：

1. `Shift+A → Mesh → Cube`，使用 Blender 默认 `size: 2` 与 `location: [0,0,0]`；
2. `G X`，以 `vector3_x` 绑定 accepted action 的 `location`；
3. `G Y`，以 `vector3_y` 绑定 accepted action 的 `location`；
4. `G Z`，以 `vector3_z` 绑定 accepted action 的 `location`；
5. `S`，以封闭 `divide_by_two` 绑定 accepted action 的 `size / 2`；
6. `F2`，以 identity 绑定 accepted action 的 `objectName`。

`divide_by_two` 只接受 ActionCatalog 已验证的有限数值参数，确定性地产生有限缩放因子；当前
`1.19.0` 只在 Cube shortcut 的 `size` 上使用它。它不是通用算术表达式，也不允许模型提供除数。
每个移动、缩放和重命名 sequence 都带显式 `ENTER` 确认。
内部 `resourceId` 带理由省略，不进入 UI operation。当前没有能与 accepted Cube action 一一对应、
经过审批和版本验证的真实 action-level MCP tool，因此 MCP 保持 unavailable。

Cube 同时具备 materialized menu 与 shortcut，MaterializationResult 因此使用 `1.2.0`。输出 leaf
仍为 `candidate`，`validatedHostVersions` 仍为空，通用 compile 仍报告
`interactionTracks: structural_only`。

## 约束与验证

- 目录安装期必须验证六项前置条件及六个 operation 的 identity、顺序、key mode、selection path、
  参数来源和确认键。
- `divide_by_two` 只允许引用数值 Action 参数；当前目录只把它用于 Cube shortcut 的 accepted
  `size`。未知 transform 或重复、缺失的 Action 参数映射必须失败关闭。
- `location`、`size` 与 `objectName` 必须在 shortcut 中完整映射，`resourceId` 是唯一省略项；menu
  仍保持其独立的完整映射。
- 历史 InteractionCatalog `1.18.0` 必须逐字回放，且其中 Cube shortcut 继续 unavailable。
- Icosphere subdivisions 没有对应的封闭快捷键输入，Icosphere shortcut 继续 unavailable；不得因 Cube
  声明而泛化。
- Blender 4.5.3/5.1.1 的 RNA 与原生 operator/transform 探针验证默认 Cube、GLOBAL 三轴移动、
  `size / 2` 等比缩放和重命名的最终对象/mesh 状态，并验证清理、selection 与 active object 无泄漏。
  该探针不是实际键盘事件，也不是完整 UI replay。
- shortcut 结果保留默认两单位 mesh 与 `scale = size / 2`。managed executor 会产出 baked mesh 与
  `scale = 1`；两者不等价。
- 原生 operator/transform 轨迹不提供 OperatingLine managed collection、resource tag、receipt、
  idempotency 或 compensation 契约，不得晋升为 verified 宿主执行样本。

## 后果

- UV Sphere 与 Cube 现在各自拥有封闭的 candidate shortcut；二者都使用 Result `1.2.0`，但参数
  transform 与宿主语义保持独立。
- 调用方可以区分 catalog-grounded Cube menu、candidate-only Cube shortcut 与不存在的 action-level
  MCP 工具。
- `1.18.0` 保持不可变，`1.19.0` 成为绑定 ActionCatalog `1.12.0` 的 latest InteractionCatalog。
- 后续仍需真实 Blender 4.5/5.1 key-event/UI replay、Observation、恢复与执行语义证据，才能讨论
  verified shortcut；这些尚未实现。

## 未选择方案

- **直接把 `size` 当作 scale**：Blender 默认 Cube 边长为 `2`，目标完整边长 `size` 对应的缩放因子
  必须是 `size / 2`。
- **复用 managed executor 的 baked mesh**：会把教学快捷键轨迹伪装成数据层 action 执行，且无法解释
  原生 transform 后保留的对象 scale。
- **把 operator/transform 探针当作键盘 replay**：它不发送 `Shift+A`、`G`、`S` 或 `F2` 键盘事件，
  也不覆盖菜单选择、确认、焦点和错误恢复。
- **把 Orchestrator materialize tool 记作 MCP 执行轨迹**：该工具只生成 Procedure 轨迹，不调用
  Blender action。
- **同时开放 Icosphere shortcut**：其 `subdivisions` 尚无封闭快捷键投影，本决策不扩张到该 action。
