# ADR 0081：持久化的 YouTube 字幕轨显式选择

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0079 提供授权字幕轨元数据，ADR 0080 提供无副作用的确定性推荐，但两者都刻意不产生选择。若客户端只把
推荐第一名复制到 import，项目无法区分用户真正确认、用户覆盖推荐，或调用方静默自动选择。这会削弱审计，
也会把算法输出误当成未来训练的人类标签。

选择理由可能包含自由文本，因此必须限制长度并明确披露其持久化边界。选择收据本身也不能触发字幕获取、
模型调用或 Blender 操作。

## 决策

新增 `ProcedureTutorialYoutubeTrackSelectionRequest/Result 1.0.0`，通过以下入口暴露：

- MCP `operatingline.procedure.tutorial.youtube.tracks.select`；
- HTTP `POST /api/v1/procedure/tutorial/youtube/tracks/select`。

请求引用一个已完成的 track-list requestId、同一 video ID 和精确 caption track ID，并要求
`explicitlyConfirmedByUser: true`。选择理由使用封闭 reason code：推荐候选、语言偏好、字幕质量审阅、无障碍
需求、工作流需求或 `other`。前五种可带最长 1,000 字符备注；`other` 必须带非空备注。MCP 描述和工作流指令
明确披露备注会保存在本地 evidence ledger，并可能进入证据导出。

请求可附带 ADR 0080 的完整推荐偏好。Runtime 对不可变 completed list 重新运行同一确定性策略，记录第一
候选、所选轨道 rank，以及用户是否采用第一候选。理由为 `recommended_candidate` 时，所选轨道必须等于重算
后的第一名，否则 fail closed；其他理由允许用户覆盖推荐。无论是否提供推荐偏好，所选轨道必须存在于来源
列表且状态为 `serving`。

本操作没有外部或异步副作用，因此只在全部校验完成后原子追加一条
`procedure.tutorial.youtube.caption-track-selection.completed` 事件，不写 requested/failed 中间状态。事件包含
严格请求 fingerprint、完整选择收据、轨道元数据、理由与推荐结果，但不含 OAuth token 或字幕正文。相同
requestId 与相同输入返回已完成收据，不同输入冲突；重启后无需访问 YouTube 或重新读取来源列表即可恢复。
持久化失败时没有成功收据，可以安全地用同一 requestId 重试。

Result 固定声明选择证据已保存，同时声明没有网络请求、额外 quota、字幕/视频下载、Provider 调用、Procedure
存储、Proposal 或宿主执行。

## 结果

项目现在能把“算法推荐”和“用户实际选择”作为不同类型的数据保存，并明确表示用户是否覆盖推荐。该收据适合
后续审计和构建人工选择数据，但备注仍可能敏感，导出前需要沿用现有证据审阅与脱敏边界。

后续 [ADR 0082](0082-selection-bound-youtube-caption-import.md) 已把收据变成当前 import `1.1.0` 的强制前置门，
并把非自由文本选择 provenance 绑定到 authoring packet `1.4.0`。当前选择 Result `1.1.0` 还把原请求
fingerprint 放入收据；历史 Result `1.0.0` 会从 completed event 的既有 fingerprint 在内存中升级，不改写账本。
本 ADR 的备注仍只保存在本地证据账本。
仍需在可视化 UI 中展示推荐、排除原因、理由输入和最终确认。

## 参考

- [ADR 0078](0078-authorized-youtube-caption-acquisition.md)
- [ADR 0079](0079-authorized-youtube-caption-track-discovery.md)
- [ADR 0080](0080-explicit-youtube-caption-track-recommendation.md)
