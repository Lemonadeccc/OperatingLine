# ADR 0064：有界单轴 Mirror Modifier 与原生菜单别名证据

- 状态：Accepted
- 日期：2026-08-15

## 背景

现有 Modifier action 能表达 Bevel、Solidify 与 Subdivision Surface，但不能表达最常见的非破坏性
对称建模。直接开放 Blender 的任意 Mirror 属性会引入多轴最多八倍拓扑增长、外部 Mirror Object
依赖、Bisect/Flip/Clipping 组合、UV 偏移以及无法封闭观察和补偿的 Modifier stack 状态。

教学轨迹还需要区分“真实可找到的菜单位置”与“可等价执行 managed action 的完整参数轨迹”。
Blender 4.5.3/5.1.1 的 Properties Modifier context 都把 `Shift+A` 绑定到 Add Modifier 菜单；该入口
可以选择 Generate → Mirror，却不能输入 OperatingLine logical IDs、受管名称、安全门、Observation
或回退合同。因此原生入口只能作为语义与前台回放证据，不能成为 available procedure materialization。

## 决策

冻结 ActionCatalog `1.16.0`，发布包含 27 个 action 与 19 项 `semanticCapabilities` 的 `1.17.0`，
新增 `blender.modifier.add_mirror` 与 `geometry.mirror_modifier`。调用方必须提供：

- receipt-owned Mesh Object 的 `targetId`；
- 新的 `modifierId`；
- 以 `OperatingLine.` 开头的 `modifierName`；
- 唯一的本地 `axis: X | Y | Z`。

执行前必须满足：目标处于 Object Mode、没有 Shape Key、全部前置 Modifier 均可由 receipt 精确解释、
stack 中不存在 MIRROR，且源 Mesh 与加入 Mirror 前的 evaluated input 非空、坐标有限并分别不超过
8192 vertices、16384 edges、8192 polygons。单轴 Mirror 的保守投影为输入拓扑的两倍；投影和真实
evaluated output 都必须留在同一上限内，真实输出还不得超过投影。

执行器创建但不应用 Modifier，并显式写入完整固定状态：

- `use_axis` 为请求轴的 one-hot 值；
- `use_bisect_axis`、`use_bisect_flip_axis`、`use_clip` 全部关闭；
- `use_mirror_merge=true`，`merge_threshold=0.001`，`bisect_threshold=0.001`；
- `mirror_object=None`，`use_mirror_vertex_groups=true`；
- `use_mirror_u/v/udim=false`，`offset_u/v=0`，`mirror_offset_u/v=0`；
- viewport、render 与 edit-mode 可见，cage 关闭；存在时 `use_apply_on_spline=false`。

receipt 保存完整 `ModifierState`，并显式快照 POINTER 属性 `mirror_object=None`。同值 Object `data`
guard 保护 Object→Mesh 绑定，同值 `mesh_content` guard 保护源 Mesh 内容。执行失败或 `Back` 使用
compare-and-restore；若用户改名、移动 stack、修改任意固定 RNA、换绑 Mesh 或改变源内容，系统保留
现场与 receipt 并拒绝覆盖。Blender 原生 Undo/Redo 后按名称、类型、stack index、属性和新 pointer
重新绑定状态。

`modifier_ready` 对 MIRROR 使用严格分支：参数必须恰好是 `targetId`、`modifierId`、
`modifierType=MIRROR` 与 `axis`；Observation 核对实际 one-hot 轴、全部固定 RNA、空 Mirror Object、
源 Mesh 内容与绑定、有限 evaluated topology 和全局上限。details 返回实际轴、期望轴、固定状态匹配、
源完整性与 evaluated topology，不能只回显请求参数。

同时冻结 InteractionCatalog `1.26.0`，发布精确绑定 ActionCatalog `1.17.0` 的 `1.27.0`，共 27 个
recipe。Mirror recipe 保存七步语义路径：

1. Layout；
2. Owned Mesh；
3. Modifiers (`PROPERTIES_MODIFIER`)；
4. Add Modifier (`OBJECT_MT_modifier_add`)；
5. Generate (`OBJECT_MT_modifier_add_generate`)；
6. Mirror (`object.modifier_add`, `type=MIRROR`)；
7. Managed Mirror Contract。

menu、shortcut 与 MCP materialization 均为 unavailable。Properties Modifier context 的 `Shift+A` 只是
打开 Add Modifier 的上下文别名；F3 是上下文相关的 Menu Search，F9 也只暴露创建 operator 的有限
属性，两者都不能表达 managed contract。当前没有获批的 action-level MCP tool。

## 真实 Blender 证据

前台 `Window.event_simulate` harness 在 Blender 4.5.3 LTS 与 5.1.1 中使用真实 Properties area、
Modifier context、`Shift+A`、菜单过滤和 `Enter` 创建 Mirror。两版都验证：

- 来源为 `OBJECT_OT_modifier_add(type=MIRROR, use_selected_objects=false)`；
- 默认固定 RNA 与 managed contract 的固定值一致；
- Cube 从 8/12/6 求值为 16/24/12；
- Object、源 Mesh pointer、Mesh 内容和 `bpy.data.meshes` 数量不变。

Managed 双版本集成测试另行覆盖 X/Y/Z、tracked predecessor、已有 MIRROR、未跟踪 Modifier、模式、
Shape Key、空/非有限/越界 topology、重复 ID/name、真实输出、Observation、RNA/数据换绑/源内容篡改、
成功门自动回退。独立原生 Undo/Redo 回归验证删除、恢复、pointer 重绑定及随后 Back。

## 兼容性与边界

- ActionCatalog `1.16.0` 与 InteractionCatalog `1.26.0` 保持逐字历史快照。
- 第一版不开放多轴、Bisect、Flip、Clipping、Mirror Object、UV、merge distance 或 Apply。
- 原生菜单创建默认 Blender Modifier，不拥有 OperatingLine logical identity 或 receipt。
- UI 前台证据只证明菜单轨迹存在，不升级 `validatedHostVersions`，也不授权执行或训练使用。

## 未选择方案

- **开放任意 Modifier type/properties**：会绕过每个 action 独立的参数、拓扑、Observation 与回退边界。
- **允许多轴数组**：XY/XYZ 会把保守增长提升到四倍或八倍，并显著扩大组合与验证面。
- **把 `Shift+A` 标为 available shortcut**：它只打开上下文菜单，无法绑定 action 的四个参数和固定合同。
- **把 F3/F9 当作稳定等价路径**：Menu Search 依赖上下文，Adjust Last Operation 不暴露完整 Mirror RNA。
