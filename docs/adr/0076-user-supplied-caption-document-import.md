# ADR 0076：用户提供字幕文档的确定性导入

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0075 已允许调用方逐段提交教学视频字幕，但要求调用方先自行把完整字幕拆成毫秒区间数组。这样既容易
产生顺序、重叠和时间换算错误，也无法证明规范化分段来自哪一份原始字幕文档。直接由 Runtime 获取 YouTube
字幕或调用语音转录又会引入网络、凭据、费用、内容权利和训练数据治理边界。

本切片只处理调用方已经合法取得并主动提交的 SRT/WebVTT 文本，不访问视频 URI，也不把权利声明视为法律
审核或 released 训练许可。

## 决策

新增版本化 `ProcedureTutorialTranscriptImportRequest 1.0.0`，通过 MCP
`operatingline.procedure.tutorial.import` 与 HTTP `POST /api/v1/procedure/tutorial/import` 暴露。请求绑定：

- 目标 adapter/catalog、goal、tree ID/revision 和可选 locale；
- 与 ADR 0075 相同的 HTTPS 视频、精确时长及非 unknown 权利状态；
- `origin: user_supplied` 的 SRT 或 WebVTT 全文、可选字幕 locale，以及调用方声明的统一 `0..1` 置信度；
- 最多 256 KiB 原始 UTF-8 字节和最多 2,000 个规范化 cue。

解析器先保留原始字符串用于 SHA-256 与 UTF-8 字节数，再只为解析去除首个 BOM、统一换行。SRT 要求正且
严格递增的数字 cue ID 与 `HH:MM:SS,mmm` 时间；WebVTT 要求 header/空行，支持可选 cue ID、标准毫秒时间
和 end timestamp 后的显示设置，并忽略 NOTE/STYLE/REGION 元数据块。字幕标签被移除，常用命名/数字实体
被确定性解码；不支持的控制字符、空 cue、非正区间、乱序、重叠或超过视频时长均 fail closed。

导入成功生成 `ProcedureAuthoringPromptPacket 1.2.0`。它在既有视频 source 和规范化 segment evidence 之外
保存：

- 原文格式、原始内容 SHA-256、UTF-8 字节数和 cue 数；
- `operatingline-caption-cues-v1` 规范化标识；
- `user_declared_default` 置信度及 `tutorialTranscriptDocumentBound` 约束。

packet schema 和服务端 authoring validator 都按版本区分三条兼容路径：`1.0.0` 只能是 goal-only，`1.1.0`
只能是调用方已分段的 tutorial，`1.2.0` 必须带 document provenance。validator 从 packet 中还原规范化教程
输入并携带 document metadata 重建 packet；cue 数、统一置信度或 catalog 不一致会被拒绝，document metadata
与 normalized cues 共同进入 packet 内容哈希。

## 副作用与安全边界

- 导入不发起网络请求，不下载视频或字幕，不调用 ASR、OCR、视觉模型或 Provider。
- 原始字幕全文不进入返回 packet；packet 只保留精确 digest/统计量和用于建树的规范化 cue。
- packet integrity 是内容寻址而非服务端签名；验证原始文档仍需调用方保留文档并重新计算 digest，本切片不把
  一个可由客户端重新封装的 packet 当成独立提交真实性证明。
- 接口不自动存储 ProcedureTree、创建/接受 Proposal 或执行 Blender。
- 字幕文本仍是不可信任务数据，不得解释为系统工作流指令。
- 本 ADR 的 `procedure.tutorial.import` 保持只读且不调用 Provider；后续
  [ADR 0077](0077-caption-document-provider-generation.md) 通过独立显式入口协调 document packet 与 Provider，
  没有改变导入入口或既有 `procedure.authoring.generate` 请求合同。

## 后续

仍需实现授权来源获取与字幕轨选择、语音转录、画面/按键/OCR 证据、镜头和语义自动分段、局部置信度、
树形可视化编辑，以及双人盲审和训练/RAG 数据集发布治理。
