# ADR 0065：人工审批的受管 Procedure 叶节点回放证明

- 状态：Accepted
- 日期：2026-08-17

## 背景

目录绑定的 Procedure materialization 已能把一个 candidate leaf 展开为带精确参数顺序的菜单和快捷键
轨迹，但结果仍是 `candidate`/`structural_only`，而 compile 会把交互轨迹投影掉，只保留可执行 Action、
Observation 与回退。另一方面，GuideProposal 的人工审批、Blender managed Action、receipt、成功门和
Companion report 已各自存在。缺口是把这三条边界用一个不可变、可审计的关联信封连接起来，同时避免把
受管 Action 的成功误写成菜单、快捷键或 MCP 轨迹已执行。

现有 `resource_exists` 只证明 logical resource 可由 receipt registry 解析，不能证明 UV Sphere 的名称、
位置、半径、Object→Mesh 绑定、拓扑或 Mesh 内容仍与执行结果一致，因此不足以产生 verified 结果证明。

## 决策

协议新增 `ProcedureLeafReplay 1.0.0` 的 proposal request、binding、finalize request 和 attestation 合同，
并生成对应 JSON Schema。首个切片只接受：

- 一个绑定具体 Blender instance 的 replay；
- 整棵物化树恰好一个 leaf，且为可执行的 `blender.mesh.create_uv_sphere`；
- 已安装 ActionCatalog/InteractionCatalog 对同一原始 packet + candidate 的重新验证和物化；
- 一个已物化 menu、一个 candidate shortcut 和明确 unavailable 的 MCP track；
- `success_gate + rollback_step`、`compensating_action`，以及参数与 Action 完全一致的唯一
  `uv_sphere_ready` Observation。

`operatingline.procedure.replay.propose` 和 `POST /api/v1/procedure/replay/propose` 不执行宿主工作。
它们把原始 request、完整 MaterializationResult、编译 Plan、待审 GuideProposal、目录 recipe、固定 claims
和 canonical SHA-256 作为 replay binding，与 Proposal 在同一 SQLite transaction 中持久化。相同 replay
内容幂等返回 duplicate；相同 identity 的不同内容 fail closed。

Proposal 仍必须在目标 Blender 实例中明确 Accept。replay decision 与 terminal report 都必须在接收时通过
当前协商 Companion lease；服务端把 Proposal、decision 和 report 的 receipt 以单调序号追加到同一持久化
账本，并要求后两者来自同一 lease fingerprint。只有数据库中存在该 Proposal 的精确 accepted decision，
且同一 Companion 会话的 terminal `completed + step_succeeded` report 在服务端接收顺序上晚于 decision，
`operatingline.procedure.replay.finalize` 或对应 HTTP endpoint 才能创建 attestation。协调器逐项核对
adapter/instance、Plan identity 与内容哈希、execution ID、leaf/active/completed step、host version range、
空 error/observation gate，以及唯一 satisfied `uv_sphere_ready` 的精确参数和完整强校验字段。客户端提供的
`occurredAt` 只作一致性检查，不能替代服务端 receipt 顺序。binding 和 attestation 都是
追加式记录，并通过独立 replay 事件进入冻结游标的 Eval/replay 导出。

## 强 Observation

ActionCatalog 冻结 `1.17.0` 并发布 `1.18.0`，仅为 UV Sphere 增加
`uv_sphere_ready`。InteractionCatalog 冻结 `1.27.0` 并发布 `1.28.0`，recipe 内容不变，只把精确
ActionCatalog binding 更新为 `1.18.0`。

Blender evaluator 要求参数恰好包含 `resourceId`、`objectName`、`radius`、`location`，并核对同一
`blender.mesh.create_uv_sphere` receipt 拥有的 Collection、Object 和 Mesh、固定三项 created/mutation
记录、Object→Mesh 与 managed Collection link、名称/位置、实际 basis rotation、单位 scale/delta、无 parent、
constraint、modifier、shape key 或 material slot、固定 32×16 sphere topology、有限坐标、顶点半径和 receipt
记录的 Mesh 内容签名。
返回 details 只包含稳定证明字段，不暴露 receipt token、pointer 或 session UID。双版本 Blender 集成测试
覆盖正常执行/补偿，以及改名、移动、缩放、换 Mesh、改顶点、加 modifier/shape key、断开 collection、
篡改 action tag 和 receipt action 的拒绝路径。

## 证明范围

attestation 的证据类别为 `companion_reported_managed_action_leaf_replay`，固定声明：

- `managedActionResult: verified`；
- `menuTrack: catalog_grounded_not_executed`；
- `shortcutTrack: candidate_not_executed`；
- `mcpTrack: unavailable`。

因此该记录证明的是目标 Companion 上报的已接受受管 Action 结果与 success gate；lease 证明同一协商传输
会话和服务端接收顺序，不是独立的人类身份签名，也不证明具体由 Next、guided menu 或 Redo 哪个 UI 入口
触发。它不证明逐控件菜单、
真实键盘事件、快捷键等价或 action-level MCP 调用。当前 attestation 也没有独立的 Blender 原生 Undo
checkpoint 字段；已有 managed compensating `Back` 与 Extension 原生 Undo 行为不能被扩写为本合同已证明
Undo checkpoint。后续 Back/Undo 不删除这条历史事件，因此它也不证明对象在当前宿主状态中仍然存在。
失败或不完整 report 不产生 verified attestation。

## 兼容性与后续

- 历史 ActionCatalog `1.17.0`、InteractionCatalog `1.27.0` 保持逐字快照与精确回放。
- replay 表和 attestation 表通过 schema migration 15 增加；migration 16 增加带 FK/CHECK 的统一
  managed-replay receipt 序列。Proposal + replay binding、带 lease 的 decision/report 与各自 receipt 都只能
  原子提交，attestation 另行追加。Phase 0 其他 legacy traffic 仍可无 receipt 持久化，但不能生成 verified
  replay attestation。
- 后续需要独立实现真实 menu/shortcut operation executor、action-level MCP registry/executor、原生 Undo
  checkpoint 证明、失败/恢复 attestation，以及 UV Sphere 之外的 Action 覆盖。
- 视频导入、语义 RAG、可视化 ProcedureTree 编辑、revision 分支/合并和 released 训练数据治理不属于本切片。

## 未选择方案

- **直接执行 materialized menu/shortcut**：当前没有可证明 context、逐控件状态、资源接管与补偿的通用
  UI executor。
- **把 guided menu wrapper 记为 menu replay**：该入口最终调用同一个 managed Session Action，不能证明
  原生轨迹中的每个 operation 被执行。
- **只保存 hashes 或单独保存 tree**：会丢失原始 packet、MaterializationResult、目录 digest、coverage 与
  Proposal 的完整关联证据。
- **用 `resource_exists` 作为成功门**：无法排除几何、名称、transform、data link 或执行后内容篡改。
