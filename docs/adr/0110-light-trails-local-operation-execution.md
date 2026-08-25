# ADR 0110：Light Trails 本地 54 步操作执行

- 状态：Accepted
- 日期：2026-08-24

## 背景

ADR 0109 已把固定 no-bake Light Trails 图表示成 54 项有序叶内操作：一次资源预检、modifier 与
20 个具名节点、12 个具体参数、19 条连接以及最终 no-bake 验证。该目录能够如实显示教学顺序，但当时
只有完整 action-level MCP 能原子创建整张图；Blender 的 Guided Control 不能逐项执行、回退或恢复。

教学轨迹本身不能证明逐操作执行。新的执行边界还必须保证：每项操作只改变其声明的数据；失败后恢复
到同一指纹；叶子完成前不产生正式 receipt；Blender 原生 Undo/Redo 同时恢复图、receipt 与游标。

## 决策

Blender 本地扩展为唯一固定 action `blender.geometry_nodes.create_light_trails` 增加 54 步执行器：

- 01 只验证受管目标、ID、名称和 modifier 前置条件，不修改 Blender；
- 02 创建空 Geometry Nodes group 与 modifier，并建立一个聚合 partial ActionReceipt；
- 03–34 依目录顺序创建 interface、20 个具名节点并写入 12 个已接受参数；
- 35–53 按稳定 socket identifier（group interface 使用作者定义名称 `Geometry`）连接 19 条边；
- 54 只验证完整图、20 节点、19 连接、两个 interface socket 和零 Bake/Simulation 节点。

每次正向操作都验证前一阶段、执行单项变更、验证新阶段，并更新连续 before/after SHA-256 指纹和同一
partial receipt。参数、节点或连接在写入后失败时，执行器先运行该项的确定性逆操作，再证明资源指纹与
失败前完全相同；无法证明时升级为 `GuidedGeometryAtomicityError` 并要求原生 Undo。反向只接受最新
ordinal，形成严格 LIFO；Operation Back 回退一项，Abort 仍通过同一聚合 receipt 补偿整个 partial run。

Session 将 `01 < ordinal < 54` 视为 mutating，01 与 54 为只读证明。每条 operation observation 绑定
run、recipe、catalog、step、receipt、ordinal 和连续指纹。只有 54 通过 strong `light_trails_ready`
Observation 后，partial receipt 才提升为正式叶 receipt。

Guided Control 复用 Transform Geometry 已验证的前进、Back、Abort、checkpoint 和恢复命令边界；服务
profile 由当前 accepted action/recipe 决定，不能由按钮提交任意 action 或 ordinal。

## MCP 与原生控件边界

本决策不改变 InteractionCatalog `1.54.0`，也不扩大远程权限。Light Trails 的 menu/shortcut 仍为
unavailable，MCP 仍是 `catalog.action_level_mcp`，通过受管 action executor 原子执行完整叶子；它尚未获得
Transform Geometry 那样的远程 operation-level MCP 协议、持久 coordinator、delivery/recovery/ACK 链。

03–53 是对 receipt-bound Blender RNA 节点树的真实单项变更，但不是模拟鼠标逐像素点击。4.5/5.1 只
承诺 OperatingLine 自有面板、精确节点容器和稳定 socket 代理；不声称能高亮每个原生 socket 像素。
支持公开 `WindowManager.try_activate_rna_button` 的后续 Blender 版本仍可在控件真实可见时升级为
`EXACT NATIVE`。

## 验证

纯 Python 测试固定 54 个唯一 operation ID、20 个节点、12 个参数、19 条连接、稳定 socket 解析、完整
definition fingerprint、非 LIFO 拒绝、补偿失败隔离以及 UI 对 Light Trails profile 的分派。

Blender 4.5.3 LTS 与 5.1.1 的真实测试均完成：

- 54 项正向执行与 54 项逐项反向执行；
- 第 15 项参数写入后的注入失败、精确补偿和同 ordinal 重试；
- 31、53、54 的 Operation Back 与重新执行；
- 54 项 Session receipt chain、strong Observation、正式 promotion 和完整回退；
- 最终 20 节点、19 连接、零 bake，以及预期的 evaluated mesh 顶点数；
- 原生 Undo/Redo 在第 15 项、最终 54 项 promotion 和整个叶子 Back 三个边界恢复图、receipt 与游标。

## 结果

学习者现在可以在 Blender 内沿可视树真正执行 Light Trails 的 `01→54`，而不是一次性生成后只看结果。
后续工作仍包括远程 operation-level MCP、真实逐 socket/menu/shortcut 执行、任意 Geometry Nodes 图，以及
更多 Edit Mode、Modifier、骨骼和动画叶节点；这些能力不能从本有界执行器外推。

## 后续演进

ADR 0111 已在 InteractionCatalog `1.55.0` 为同一固定 recipe 增加远程 54 步 operation-level MCP、持久
delivery/result/recovery 链和完整原生 Undo checkpoint lineage。本文关于本地执行器、逐 socket 像素与任意图的
边界保持有效；“远程 MCP 仍为 action-level”只描述 `1.54.0` 及更早冻结目录，不再描述当前目录。
