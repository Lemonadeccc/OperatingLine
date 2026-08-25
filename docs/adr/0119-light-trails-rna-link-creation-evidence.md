# ADR 0119：Light Trails 节点连线 RNA 创建证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0109](0109-light-trails-link-control-rail.md)、[ADR 0118](0118-light-trails-node-initialization-rna-evidence.md)

## 背景

Light Trails 的 35–53 已是十九项独立连接 operation，执行器也逐项调用 Blender `NodeLinks.new`，但成功
Observation 过去只保存累计 `linkCount` 和最终图 fingerprint。该信息可以证明图整体正确，却不能把当前步骤
实际连接的 from-node/output socket 与 to-node/input socket 保存成独立训练数组，也不能直接拒绝“数量相同但
当前连接端点收据被替换”的结果。

Guided Control 已显示目录中的代理连接线，但它没有明确区分真实 RNA link mutation 与鼠标拖线。Blender 4.5/5.1
也没有稳定的跨布局 socket 像素矩形，因此这条能力必须证明数据模型连接，而不能声称重放了 UI 指针轨迹。

## 决策

十九项连接 operation 现在都通过固定 `_create_link_with_evidence` 路径创建一条 `NodeLink`，立即从 Blender 返回的
link 回读并核对四元端点：from node、from socket identifier、to node、to socket identifier。任何不一致都会删除
刚创建的 link 并失败；后续 stage validator 仍核对当前完整拓扑，既有 inverse/补偿继续按 LIFO 删除精确连接。

每项成功 Observation 的 `rnaLinkCreations` 包含一条有序记录；其它 operation 必须为空数组。记录固定保存：

- `blender_rna_node_link_create` execution method、源 operation、语义动作和受限 Light Trails MCP；
- node-group logical ID/name；
- from/to node 的精确 name/type、socket identifier 和 OUTPUT/INPUT 方向；
- `observedLink: true` 与 `Geometry Nodes → group → from node → socket → to node → socket` UI 语义路径。

协议为 35–53 的每个 source operation 固定唯一端点，拒绝缺项、额外项、错源、错节点类型、错 socket、反向连接
或 UI path 漂移。Runtime 从 accepted replay 和固定 recipe 独立派生当前 operation 的完整数组，并随其它 evidence
执行 canonical equality。字段在历史持久结果中保持可选，但所有新派发 Light Trails operation 都必须提交精确
数组；调用方不能指定任意节点、socket 或 Python。

Blender Guided Control 对 focused 连接显示 `35.01…53.01 LINK RNA` 及完整端点。该标记说明执行器实际调用并
观察了 Blender NodeTree RNA，不是原生 socket 像素高亮、鼠标拖线或通用节点编辑权限。

## 结果与边界

- Light Trails 的 20 个节点、39 条稳定初始化写入、15 条 accepted 参数写入和 19 条连接创建现在均有叶内有序
  执行证据；最终 no-bake 验证仍是第 54 项独立成功门。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均通过 54 次正向、54 次逆向、补偿、Abort 和完整拓扑；
  双版本 Companion E2E 均通过 54 次 delivery/result、服务端派生核对、强 Observation 与原生 checkpoint。
- 本决策只覆盖冻结 Light Trails recipe 的十九条连接，不开放任意 Geometry Nodes socket、动态节点发现、
  连接替换、multi-input 排序或任意 MCP 图编辑。
- 真实 UI socket 定位、拖拽手势、节点搜索和逐控件 menu/shortcut 仍需宿主可验证的前台事件证据。
