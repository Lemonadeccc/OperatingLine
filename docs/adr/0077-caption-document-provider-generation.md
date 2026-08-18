# ADR 0077：字幕文档的显式 Provider 建树

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0076 能把调用方提供的 SRT/WebVTT 确定性转换为 document-bound
`ProcedureAuthoringPromptPacket 1.2.0`，但只能由 MCP 宿主模型或外部客户端继续消费。已有
`procedure.authoring.generate` 则只接受普通目标或调用方已经逐段提交的教程；直接扩宽这个请求会混淆三种
packet 来源，也会破坏既有公开合同。

需要一条明确、可审计且不扩大执行权限的路径，让调用方在审阅 Provider 的数据传输与费用披露后，从完整
字幕文档直接得到经过同一确定性门禁的 candidate ProcedureTree。

## 决策

新增 `ProcedureTutorialTranscriptGenerateRequest 1.0.0`。它复用 ADR 0076 的严格 document import 字段，
只增加 UUID `requestId` 与显式 `providerId`，并通过以下独立入口暴露：

- MCP `operatingline.procedure.tutorial.generate`；
- HTTP `POST /api/v1/procedure/tutorial/generate`。

Coordinator 依序执行：严格解析字幕文档、构建并校验 `1.2.0` packet、记录 requested evidence、调用所选
Provider 的 `authorProcedure()`、校验 candidate Schema 与 packet identity，再执行安装目录绑定的 authoring
validation 和 ProcedureTree compile。成功结果继续固定声明 `modelCalled: true`，以及
`procedureStored/proposalCreated/hostExecutionStarted: false`。

既有 `procedure.tutorial.import` 仍不调用 Provider；既有 `procedure.authoring.generate` 的 `1.0.0/1.1.0`
请求合同也保持不变。三个入口按输入来源分离，共享 packet、Provider capability、输出和验证合同。

## 幂等、恢复与最小化证据

文档 generate 复用 `procedure_authoring` invocation manager 和 requested/completed/failed 事件。request
fingerprint 覆盖精确请求，因此即使只改变原始文档换行或标签，同一 request ID 也会被识别为冲突；重复的完全
相同请求只调用 Provider 一次，Runtime 重启后可从 completed evidence 返回同一结果。

原始 `captionDocument.content` 不进入 Provider packet 或持久化事件。Provider 只收到文档摘要、统计量、
规范化 cue 与任务上下文。completed evidence 保存从 packet 重建的规范化分段请求，并保留原始请求
fingerprint；这足以恢复结果和判定后续请求一致性，同时避免持久化完整 SRT/WebVTT 语法。

## 安全与信任边界

- Runtime 不获取视频或字幕 URL，也不执行下载、ASR、OCR、画面分析或自动来源授权判断。
- 调用 generate 可能传输规范化字幕文本和任务上下文并产生费用，必须由调用方显式选择 Provider。
- Provider 输出仍是不可信 candidate，不能自行声明 available 菜单、快捷键或 MCP grounding。
- 成功生成不会保存或物化 ProcedureTree，不会创建/接受 Proposal，也不会执行 Blender。
- 视频权利声明不是法律审核，也不使内容自动具备训练数据发布许可。

## 后续

后续 ADR 0078 已增加仅限授权账号可编辑视频、且要求精确已知 caption track ID 的官方 YouTube 字幕获取。
仍需 OAuth 登录/刷新与字幕轨枚举、任意合法来源的视频媒体获取/语音转录、画面与按键识别、自动语义分段、
向量/语义 RAG、流式对话、局部重规划、可视化树编辑，以及双人盲审和正式训练数据集治理。
