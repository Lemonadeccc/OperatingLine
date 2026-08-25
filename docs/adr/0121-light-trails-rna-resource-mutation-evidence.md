# ADR 0121：Light Trails 基础资源创建与绑定证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0110](0110-light-trails-local-operation-execution.md)、[ADR 0120](0120-light-trails-rna-structure-creation-evidence.md)

## 背景

Light Trails operation 02 已通过受管执行器创建 Geometry Node Group、NODES Modifier，并把两者绑定到一起。
原有 receipt、ownership、fingerprint 与原生 Undo lineage 能证明该 operation 的整体副作用和恢复关系，但没有把
内部三个 Blender RNA mutation 的顺序、实际返回资源属性与稳定 UI 语义路径保存为可独立核对的叶内数组。
Guided Control 因此只能显示 `Create Geometry Nodes modifier`，无法呈现 `02.01 → 02.02 → 02.03`。

## 决策

operation 02 在实际完成每项调用并回读结果后，产生严格有序的三条 `rnaResourceMutations`：

1. `blender_rna_node_group_create`：创建具名 `GeometryNodeTree`；
2. `blender_rna_modifier_create`：在目标对象上创建具名 `NODES` Modifier；
3. `blender_rna_modifier_node_group_bind`：把该 Modifier 的 `node_group` 绑定到前述 Node Group。

每条记录绑定固定 MCP、源 operation、语义动作、目标 logical ID，以及对应的 modifier/node-group ID 与实际名称。
创建记录必须回读正确 resource/type，绑定记录必须证明 `modifier.node_group is node_group`；UI path 分别指向
`Geometry Nodes → <Node Group>`、`Properties → Modifiers → <Modifier>` 与
`Properties → Modifiers → <Modifier> → Node Group → <Node Group>`。

协议固定三种 mutation 的完整顺序和跨记录 identity，拒绝缺项、额外项、反序、名称或类型漂移、不同 target、
不同 modifier/node-group 以及 UI path 漂移。Runtime 只从 accepted replay 的不可变 action arguments 派生期望数组，
随其它 evidence 执行 canonical equality；字段对历史结果保持可选，但新派发的 operation 02 必须提供三项，
其它 operation 必须为空。调用方不能提交资源参数或任意 Python。

Guided Control 在 operation 02 聚焦时显示 `RESOURCE RNA`，并依次呈现 `.01 NODE GROUP RNA`、
`.02 MODIFIER RNA` 与 `.03 BIND RNA`。该轨迹证明 Blender 数据模型中的资源创建与引用绑定，不声称执行了
Properties 菜单点击、Geometry Nodes workspace 切换或像素级前台手势。

## 结果与边界

- Light Trails 现在具有 3 条基础资源 mutation、22 条结构创建、39 条稳定初始化、15 条 accepted 参数写入和
  19 条连接创建的严格叶内数组；第 54 项仍以强 no-bake Observation 独立完成。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均逐项验证返回资源、绑定 identity、54 次正向/逆向、
  补偿与 Abort；双版本 Companion E2E 均通过 Runtime 派生核对、原生 checkpoint、13,824 evaluated vertices
  与零 Bake，并拒绝结构合法但内容伪造的资源收据。
- 本决策只开放固定 Light Trails recipe 的 operation 02，不开放任意 Node Group、任意 Modifier、动态类型、
  真实 Add Modifier 菜单、快捷键、鼠标操作或通用资源 executor。
