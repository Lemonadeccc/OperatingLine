# ADR 0099：Mirror Modifier Action-level MCP

- 状态：Accepted
- 日期：2026-08-21

## 背景

InteractionCatalog `1.39.0` 只为 factory Cube 的 Subdivision Surface 声明原生 shortcut proof；Mirror
Modifier 仍只有结构化教学路径，不能通过通用 action executor 执行。Mirror 的正确性又不只等同于调用
`object.modifier_add(type=MIRROR)`：它必须绑定 OperatingLine 拥有的 target 与 modifier identity、精确 axis、
固定属性、受限源网格和 evaluated topology。

## 决策

冻结 `interaction-catalog-1.39.0.json`，新增 InteractionCatalog `1.40.0`。新版本只把
`blender.modifier.add_mirror` 的 MCP projection 标为 `operatingline.blender.action.execute` 可用；menu 与
shortcut projection 继续 unavailable。公开 execute 请求仍不接受 action 名或参数，Runtime 从已接受且未启动的
单叶 replay binding 派生 `{targetId, modifierId, modifierName, axis}`。

Companion 仅执行固定的 managed Mirror contract，并在完成报告中提供 `modifier_ready` 强 Observation。Runtime
要求 target/modifier/type/axis 完全匹配，Mirror 固定属性、源内容、evaluated finite/limits 全部满足，且动态
vertex/edge/face count 为正的安全整数。成功还必须位于人工接受、Start state CAS、可信 action receipt 和
Start→Next 原生 Undo checkpoint 之后；失败沿用既有补偿回退与 recovery attestation，不能由目录 grounding
替代执行证明。

## 结果

- 旧 InteractionCatalog binding 不继承 Mirror 执行权限。
- Mirror menu/shortcut 仍只是 unavailable 教学面，不冒充逐控件执行。
- 当前扩展是一个有界 managed modifier action，不代表 Modifier、Geometry Nodes 或 Blender 全菜单覆盖。
