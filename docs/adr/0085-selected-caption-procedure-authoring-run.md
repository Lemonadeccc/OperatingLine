# ADR 0085：已选官方字幕的分阶段 ProcedureTree 编写

- 状态：Accepted
- 日期：2026-08-19

## 背景

ADR 0081 至 0083 已把一个可编辑 YouTube 视频的精确 serving 字幕轨绑定到持久化选择收据，并允许当前
YouTube import 在网络与配额确认后生成含获取 provenance 的 authoring packet。ADR 0070 与 0077 已能让
显式选择的 Provider 生成经过 packet identity、目录和 compile 校验的 candidate ProcedureTree；ADR 0046
也提供独立的确定性 materialization。此前调用方仍须分别协调这些入口，无法用一个可恢复的 run 证明同一份
选择、packet、Provider 输出、物化结果、人工审阅和最终存储属于同一条证据链。

组合入口不能把“Provider 返回了树”直接等同于可保存结果。Provider candidate 与目录 grounding 后的
materialized tree 可能不同，审阅者必须看见并确认精确版本。流程也不能因进程重启自动重放字幕下载或
Provider 调用，否则可能重复消耗 YouTube quota、产生 Provider 费用，或取得不同的外部结果。

## 决策

新增版本化、异步的 selected-caption authoring run，固定按以下顺序推进：

`caption_import → provider_generation → materialization → exact-hash review → storage`

Create 请求只接受 `kind: selected_youtube_caption` 的当前 YouTube import 请求、从 Provider 列表原样回传的
完整可用 descriptor 快照，以及 Provider 数据处理与可能费用的三项确认。Runtime 会在记录请求前把该快照与
live descriptor 逐字段核对。Caption import 继续要求已经记录的
`selectionRequestId`，并在任何 YouTube API 调用前核对选择收据、video ID 和 caption track ID。Run 不接受
普通公开视频 URL、自动选轨、媒体分析 manifest 或调用方提供的未绑定 packet。

前三个阶段依次复用现有 selection-bound YouTube import、prepared-packet Provider generation 和目录绑定
materialization。状态只能报告固定阶段前缀；完成 materialization 后进入 `awaiting_review`，并返回完整的
Provider generation 与 materialization preview。此时没有 ProcedureTree 被保存。

Store 审阅必须携带 run 返回的精确 `reviewId`，同时逐项提交并确认：

- authoring packet 的 canonical SHA-256；
- Provider candidate ProcedureTree 的 canonical SHA-256；
- materialized ProcedureTree 的 canonical SHA-256。

任一 identity 或哈希不一致都 fail closed。调用方也可显式 discard，该结果成为终态且不存储树。通过 store
审阅后，Runtime 构造完整 binding，把字幕 import/选择收据、Provider descriptor 摘要、generation completed
event 与可用的 runtime-attestation 摘要、目录 materialization、
三哈希审阅和目标 tree revision 串在一起。不可变 ProcedureTree、精确 operation index、通用存储审计事件和
`procedure.tutorial.authoring.completed` binding 证据在同一个 SQLite transaction 中写入；缺少任一部分时
整体回滚。相同输入可幂等恢复，冲突输入不能复用 request ID。

Run 通过 MCP `operatingline.procedure.tutorial.authoring.runs.create`、`...runs.status`、
`...runs.review`、`...runs.resume`，以及对应 HTTP create/status/review/resume 入口提供。进程重启后，已完成
外部阶段的结果从既有 completed evidence 恢复，但未完成的 `caption_import` 或 `provider_generation` 不会自动
重放。只有确定性的 `materialization` 与本地原子 `storage` 可进入 `recovery_required`，并要求精确
recovery receipt 后显式 resume。

该流程不消费 ADR 0084 的媒体分析 manifest，也没有媒体下载、ASR fallback、画面/按键识别或自动语义分段。
它不创建、发布或接受 Proposal，不执行 Blender，也不把存储的 candidate 宣称为宿主验证或 released 训练
数据。

## 结果

项目获得“已授权且已选择的官方字幕 → Provider → 目录物化 → 精确人工审阅 → 不可变候选树”的一体化、
可审计工作流。`completed` 只证明 catalog-grounded candidate ProcedureTree 与完整 binding 已原子保存；它不
证明 Blender 已执行、Observation 已成功或当前场景状态正确。

选择确认可视化 UI、媒体分析/ASR manifest 到完整 ProcedureTree 的组合、画面与快捷键证据 grounding、
大步骤/小步骤质量校准、可视化树编辑和训练数据发布仍需后续实现。

## 参考

- [ADR 0043](0043-immutable-procedure-tree-library.md)
- [ADR 0046](0046-catalog-bound-procedure-materialization.md)
- [ADR 0070](0070-explicit-procedure-authoring-provider.md)
- [ADR 0077](0077-caption-document-provider-generation.md)
- [ADR 0081](0081-persisted-youtube-caption-track-selection.md)
- [ADR 0082](0082-selection-bound-youtube-caption-import.md)
- [ADR 0083](0083-managed-youtube-oauth.md)
- [ADR 0084](0084-authorized-youtube-media-analysis.md)
