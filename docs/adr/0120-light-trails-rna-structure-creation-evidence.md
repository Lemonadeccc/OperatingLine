# ADR 0120：Light Trails 节点与接口结构创建证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0118](0118-light-trails-node-initialization-rna-evidence.md)、[ADR 0119](0119-light-trails-rna-link-creation-evidence.md)

## 背景

Light Trails 的二十项节点 operation 已逐步调用 `node_group.nodes.new`，Group Input 与 Group Output 还会先调用
`node_group.interface.new_socket`。过去的 Observation 只保存累计节点名与 interface socket 列表；它能证明当前
图状态，却不能保留每项创建调用的返回对象、节点类型，也不能表达 Group I/O 内部“先建立接口、再建立节点”的
顺序。Guided Control 对没有参数初始化的节点也只能显示 operation 标题，缺少叶内 `01` 级结构步骤。

## 决策

节点 operation 03、04、06、08、11–14、19、20、22–26、29、30、32–34 现在统一通过受限结构创建路径执行。
每个普通节点产生一条 `blender_rna_node_create`；03 Group Input 与 34 Group Output 各自产生两条：

1. `blender_rna_node_group_interface_socket_create`，回读 `Geometry`、INPUT/OUTPUT 与
   `NodeSocketGeometry`；
2. `blender_rna_node_create`，回读精确 OperatingLine node name 与 Blender node type。

因此完整 Light Trails 执行形成二十个节点、二十二条 `rnaStructureCreations`。每条记录还绑定源 operation、语义
动作、固定 MCP、node-group logical ID/name、structure kind、观察成功标记和稳定 UI 语义路径。Group I/O 明确
保存 `03.01 Interface → 03.02 Node` 与 `34.01 Interface → 34.02 Node`；其它节点为单条 `.01`。

协议为二十个 source operation 固定完整目标集合与顺序，拒绝缺项、额外项、反序、错节点名/type、错 interface
方向/type 或 UI path 漂移。Runtime 从 accepted replay 与固定 recipe 独立派生当前数组，并随其它 evidence 执行
canonical equality；字段对历史结果保持可选，但所有新派发 operation 必须提供精确数组，非结构 operation 必须
为空。调用方不能提交节点类型、名称、interface 或任意 Python。

Guided Control 对 focused 节点 operation 显示 `STRUCTURE RNA`，并在 Group I/O 中分别显示 `INTERFACE RNA` 与
`NODE RNA`。该轨迹证明 Blender NodeTree 数据结构创建，不声称执行了 Add/Search 菜单、鼠标放置节点或像素级
前台操作。

## 结果与边界

- Light Trails 现在具有 3 条基础资源 mutation、22 条结构创建、39 条稳定初始化、15 条 accepted 参数写入和
  19 条连接创建的叶内数组；
  第 54 项仍以强 no-bake Observation 独立完成。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均逐项验证结构返回值、54 次正向/逆向、补偿与 Abort；
  双版本 Companion E2E 均通过 Runtime 派生核对、原生 checkpoint、13,824 evaluated vertices 与零 Bake。
- operation 02 的 modifier/node-group 基础资源创建与绑定已补充为三条严格 `rnaResourceMutations`，见
  [ADR 0121](0121-light-trails-rna-resource-mutation-evidence.md)。
- 本决策不开放任意节点类型、动态搜索、节点坐标、frame/group、interface 数据类型、真实 Add 菜单或快捷键执行。
