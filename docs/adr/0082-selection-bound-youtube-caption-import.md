# ADR 0082：选择收据绑定的 YouTube 字幕导入

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0081 已能持久化用户明确确认的字幕轨选择，但最初的 YouTube import `1.0.0` 仍只接收调用方再次提交的
video ID 和 caption track ID。仅靠调用工作流约定两处 identity 相同，无法在网络和配额副作用发生前证明
导入引用了哪一条已记录选择，也无法阻止调用方在选择后替换视频或轨道。

选择收据还可能带有最长 1,000 字符的自由文本备注。备注适合保留在本地审计账本，但不应因字幕导入而自动
进入 authoring packet，或在后续生成时转发给 Provider。

## 决策

保留 `ProcedureTutorialYoutubeImportRequest 1.0.0` 仅用于恢复历史 completed import；新的 `1.0.0` 调用在
任何证据或网络副作用前被拒绝。当前请求版本 `1.1.0` 额外强制要求 `selectionRequestId`。Runtime 在持久化
网络请求证据和调用任何 YouTube API 之前，从本地 evidence ledger
恢复对应的 completed selection receipt，并要求收据中的 video ID 和 caption track ID 与 import 请求完全
一致。收据不存在、未完成或 identity 不一致时 fail closed，不访问网络，也不消耗 YouTube API quota。

当前 selection Result `1.1.0` 把原选择请求 fingerprint 放入收据。ADR 0081 已持久化的 Result `1.0.0` 仍可
恢复：Runtime 使用 completed event 顶层既有 fingerprint 生成内存中的 `1.1.0` 视图，不改写历史事件。
旧 import requested/failed evidence 缺少 `selectionRequestId` 时也继续按历史未绑定事件解析。

成功的当前导入生成 `ProcedureAuthoringPromptPacket 1.4.0`。Packet 在既有 YouTube acquisition provenance
之外绑定结构化、非自由文本的选择 provenance，使后续 validator 和 Provider 输入可追溯到明确记录的选择，
同时不暴露自由文本备注。备注继续留在本地选择 evidence 中，不复制到 packet，也不通过 authoring generation
转发给 Provider。

现有 OAuth 边界不变：access token 仍只由 composition root 注入，不进入公开请求、日志或事件；导入仍要求
调用方逐请求确认网络、配额与预期编辑权限，并且仍不能获取任意公开视频字幕。

## 结果

当前 YouTube 字幕导入不再把“调用方提交了一个 track ID”当作已完成人工选择。选择、导入和最终 packet 形成
同一条可验证 identity 链，而且不把可能敏感的自由文本备注扩大到模型数据边界。历史 `1.0.0` payload 仍可由
兼容读端处理，但不代表当前安全工作流。

教学来源里程碑的选择绑定项已完成。下一项是 OAuth 登录与 token refresh；选择确认可视化 UI、视频媒体/ASR、
画面与按键识别、自动语义分段和证据帧仍留在后续范围。

## 参考

- [ADR 0078](0078-authorized-youtube-caption-acquisition.md)
- [ADR 0079](0079-authorized-youtube-caption-track-discovery.md)
- [ADR 0080](0080-explicit-youtube-caption-track-recommendation.md)
- [ADR 0081](0081-persisted-youtube-caption-track-selection.md)
