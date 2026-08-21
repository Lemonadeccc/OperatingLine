# ADR 0096：已验证媒体 manifest 到 Procedure authoring 准备

- 状态：Accepted
- 日期：2026-08-20

## 背景

ADR 0084 已完成授权视频的下载、ASR、证据帧、OCR、UI/快捷键候选和确定性语义分段，但 completion 仍只是
媒体 manifest。若调用方把完整分析 JSON 再上传给 authoring，既会重复传输大对象，也可能把被替换的 artifact
引用、错误权利状态或跨时间段候选当作可信 prompt grounding。

## 决策

新增只读准备入口 MCP `operatingline.procedure.tutorial.media.authoring.prepare` 与 HTTP
`POST /api/v1/procedure/tutorial/media/authoring/prepare`。请求只引用已完成媒体任务的原始 request id 与
server job id，并给出 authoring tree identity、目标、目录版本及视频标题；不接受调用方权利状态/license 文本、媒体字节、路径、
credential、tool argv 或调用方替换的分析结果。

Runtime 从持久 coordinator 取回原始分析请求和完成结果，并从已记录的 rights authorization basis 派生 packet
权利状态，不允许 prepare caller 改写；再调用原 pipeline verifier 重新检查结果 Schema、每个 CAS artifact 的 bytes/hash、manifest bytes、root
hash 与 artifact URI 列表。verifier 返回内容还必须与输入规范化 hash 完全一致，防止校验器静默替换分析。

准备器按 semantic segment 时间顺序生成 tutorial authoring packet，并返回独立 evidence binding：原 semantic
segment id、最终 prompt evidence id、时间范围、canonical description、ASR/OCR/UI/shortcut candidate id，以及
artifact/frame/timestamp 引用。ASR 引用必须与 segment 有非空时间交集；视觉与快捷键候选的 frame timestamp
必须落在 segment 闭区间内。质量报告给出 ASR、frame、OCR、UI 和 shortcut 覆盖率；无 segment、跨时段引用或
完全无 grounding signal 时返回 `blocked` 且 `packet=null`。

准备器使用仅限 runtime 内部的 verified request schema 构造 packet `1.5.0`。公开 prompt/generate request 仍只
接受 `user_supplied` transcript，不能自行声明 `local_media_analysis`。packet provenance 绑定分析 fingerprint、
manifest artifact/hash/root、tool executable/version-output/invocation/configuration digest、model digest、确定性分段
digest，以及每段 semantic id、prompt evidence id、ASR/OCR/UI/shortcut id 与 evidence 引用；不复制完整分析对象。

结果和分析均有确定性 SHA-256 fingerprint。所有路径固定声明 `providerCalled=false`、`procedureStored=false`、
`proposalCreated=false`、`hostExecutionStarted=false`。准备入口不把 OCR/UI/快捷键候选升级为 verified Blender
控件，也不直接生成 ProcedureTree。

## 结果

媒体流水线第一次拥有可公开调用、可校验、可追溯到 prompt evidence id 的 authoring 准备阶段。本阶段自身仍不调用
Provider、不生成或保存树；后续 Provider generation、catalog materialization、四哈希人工 review/store 和本地确认 UI
由 [ADR 0097](0097-reviewed-media-procedure-authoring-run.md) 的独立 run 承担。两项组合形成从已授权媒体分析结果到已审阅
ProcedureTree 的分阶段闭环，但仍不等于 Blender 宿主复现、Observation 成功证明或 released 训练数据。
