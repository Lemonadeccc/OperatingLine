# ADR 0101：Solidify Modifier Action-level MCP

- 状态：Accepted
- 日期：2026-08-21

## 背景

InteractionCatalog `1.41.0` 已包含精确的 UV Sphere menu-control proof，并保留 Solidify Modifier 的四步
`semantic_path`，但 Solidify 的 menu、shortcut 与 MCP materialization 都不可用。原生 Modifier UI 或一次
`object.modifier_add(type=SOLIDIFY)` 不能证明 OperatingLine 的受管合同：精确 target/modifier identity、
thickness/offset、固定 Solidify RNA、源 Mesh 未被修改、真实 evaluated topology、Observation 和补偿回退。

## 决策

冻结 `interaction-catalog-1.41.0.json`，发布仍精确绑定 ActionCatalog `1.22.0` 的 InteractionCatalog
`1.42.0`。新版本只把 `blender.modifier.add_solidify` 的 MCP projection 标为
`operatingline.blender.action.execute` 可用；menu 与 shortcut 继续 unavailable。公开 execute 请求仍不接受
Action 或参数，Runtime 只从已接受、已 Start、未触碰的单叶 replay binding 派生
`{targetId, modifierId, modifierName, thickness, offset}`。

Solidify receipt 增加 Object→Mesh 同值 guard 与源 `mesh_content` guard。Companion 的 `modifier_ready` 必须
逐项证明：

- target、modifier 与 `SOLIDIFY` type 精确匹配；
- thickness/offset 与 accepted Observation 参数在容差内一致；
- `EXTRUDE`、even offset、rim、非 rim-only 及其余未开放 RNA 保持固定合同；
- `sourceContentIntact=true`，即 receipt 记录的源 Mesh 内容未变；
- `evaluatedFinite=true`、`evaluatedWithinLimits=true`，且真实 evaluated vertex/edge/face count 为正整数并
  保持在 `8192/16384/8192` 上限内。

Runtime 与 protocol 使用同一封闭 Observation shape；额外字段、缺失字段、类型混淆、参数偏移、源内容变化、
固定属性变化或 evaluated topology 越界都 fail closed。成功还必须连接人工 decision、Start state CAS、可信
Companion receipt 与 Start→Next 原生 Undo checkpoint；失败沿用既有补偿与 recovery attestation。

## 结果

- 历史 InteractionCatalog `1.41.0` 保持逐字冻结，不继承 Solidify MCP 权限。
- 该权限只覆盖 accepted replay 的 next step，不开放任意 Action、参数、Python、Blender operator 或通用
  Modifier 执行。
- Solidify menu/shortcut 仍 unavailable；action-level MCP 成功不证明逐控件 UI 或快捷键执行。
- `action.status=succeeded` 与 replay finalization 都只证明其可信报告时刻；报告后的当前状态仍需新的
  nonce-bound current-state challenge。
