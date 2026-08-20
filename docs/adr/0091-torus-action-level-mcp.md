# ADR 0091：Torus 的 action-level MCP 执行

- 状态：已接受
- 日期：2026-08-20

## 背景

ADR 0089 与 ADR 0090 已为 UV Sphere、Icosphere、Cube 和 Plane 建立严格 action-level MCP 执行链。
InteractionCatalog `1.35.0` 是这些权限的不可变边界；代码级七 primitive 白名单只负责拒绝越界 action，不能让
目录中仍为 unavailable 的 Torus 自动获得权限。

Torus 已具备受管 Action、补偿回退、原生 Undo checkpoint 和强 `torus_ready` Observation。该 Observation
把 accepted `majorSegments × minorSegments` 绑定到动态顶点、边和面数量，并按参数化公式复算每个顶点；
`majorRadius`、`minorRadius`、位置、名称、资源归属和 Mesh 内容任一不匹配都会 fail closed。它可以复用已有
执行工具，但必须在独立目录版本中显式授权并保留历史 binding 的原语义。

## 决策

冻结 InteractionCatalog `1.35.0`，发布仍精确绑定 ActionCatalog `1.22.0` 的 `1.36.0`。新版本只把
`blender.mesh.create_torus` 的 MCP declaration 从 unavailable 改为与已授权 primitive 相同的
`catalog.action_level_mcp`；UV Sphere、Icosphere、Cube 与 Plane 保持 available，Cone、Cylinder 和其它 action
保持 unavailable。

Torus leaf 物化为唯一 `operatingline.blender.action.execute` operation。公开请求仍只接受格式版本、新 UUID
request、replay ID 与精确 `{reportId, sequence}` CAS；不接受 action、参数、Plan/step ID、Blender operator
或 Python。Runtime 从 immutable replay binding 派生完整 `resourceId`、`objectName`、`majorSegments`、
`minorSegments`、`majorRadius`、`minorRadius` 和 `location`，调用方不能覆盖或重排。

执行继续要求：

1. Proposal、accepted decision 与 Start report 按服务端 receipt 顺序成立；
2. execute 匹配目标实例当前、未移动的 Start CAS，且由同一协商 lease 投递与回报；
3. terminal report 晚于 dispatch，并通过 replay finalize 共用的强 `torus_ready` validator，包括 accepted 参数、
   ownership、内容完整性、逐顶点几何和动态拓扑；
4. 成功 `next` checkpoint 的 `previousCheckpointId` 精确指向 CAS 所绑定 Start checkpoint；
5. 不确定投递进入 `recovery_required`，不得自动重放。

本批同时让所有已授权 primitive 的 `action-result succeeded` 复用 replay finalization 的同一强 Observation
validator，消除“status 成功但强几何稍后才失败”的分叉。该收紧不改变任何历史 Catalog 的 available 集合，
也不把未授权 action 加入执行面。

## 证明边界

- `1.35.0` Torus binding 仍为 unavailable；活动目录升级不会为已存 replay 补发权限。
- Torus 的有序 menu 仍只是 catalog-grounded teaching data，shortcut 仍 unavailable；action-level MCP 成功不证明
  menu 控件或按键被真实执行。
- `action.status=succeeded` 证明 delivery、强 Observation 与 Undo 链通过，但不是追加式 replay attestation；
  provenance receipt 的固化仍由后续 finalize 完成，报告之后的当前状态仍需 nonce-bound challenge。
- Cone 与 Cylinder 没有因本决策获得 action-level MCP 权限。
- `torus_ready` 证明的是 Companion 报告时的受管 Action 结果；之后的当前宿主状态仍需独立 nonce-bound
  current-state challenge。

## 验证

- 冻结 `1.35.0` 的逐字内容与 SHA-256，并证明 `1.36.0` 只改变版本和 Torus MCP declaration；
- materialization 测试验证唯一 server/tool、运行时占位、完整 accepted arguments 和结果绑定；
- Runtime 集成覆盖 decision、Start、lease、CAS、exact delivery、trusted report、完整 `torus_ready`、Start→Next
  checkpoint 链和 succeeded status；缺失 geometry flag 或错误拓扑必须保持非终态并返回 409；
- 冻结 `1.35.0` 的 Torus replay 在完成同样前置条件后仍必须被 execute 拒绝；
- Blender 4.5.3 与 5.1.1 继续验证 accepted segments/radii 对应的几何、动态拓扑、Observation 与回退。

## 后续

Cone 与 Cylinder 继续使用后续独立目录版本激活。逐控件 menu/shortcut executor、七 primitive 之外的 Action，
以及 `recovery_required` 后的人工检查与重新入队仍是独立工作。
