# ADR 0079：经授权的 YouTube 字幕轨枚举

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0078 要求调用方给出精确 caption track ID，才能下载并绑定一个授权字幕文档。普通用户通常只有视频
URL 或 video ID，无法从播放器稳定获得 API track ID。让 Runtime 静默选择语言或自动字幕又会掩盖
`standard`、`ASR`、`forced`、draft、processing status 与辅助功能属性之间的重要差异，并使后续训练证据
缺少明确选择依据。

官方 `captions.list` 可以按 `videoId` 返回关联字幕轨元数据，但不返回字幕正文。该方法需要 OAuth scope，
当前文档记录每次调用消耗 50 quota units；响应结构没有分页 token。

## 决策

新增 `ProcedureTutorialYoutubeTrackListRequest/Result 1.0.0`，通过以下入口暴露：

- MCP `operatingline.procedure.tutorial.youtube.tracks.list`；
- HTTP `POST /api/v1/procedure/tutorial/youtube/tracks`。

请求只接受 UUID `requestId`、精确的 11 字符 video ID，以及固定为 `true` 的网络请求、配额和视频编辑权限
确认。OAuth token 继续仅由 composition root 注入；严格 Schema 拒绝 credential 和其他额外字段。

Source 只调用一次 `captions.list(part=snippet&videoId=...)`，不设置 track `id` filter，也不调用
`captions.download` 或 `videos.list`。响应沿用 1 MiB JSON 上限、统一超时、禁止 redirect、严格 UTF-8 与
安全远端错误规则。每个 item 必须属于请求 video ID，track ID 必须唯一；Runtime 按 ID 稳定排序后返回：

- track ID、BCP-47 language 与最长 150 字符的用户可见 name；
- `ASR`/`forced`/`standard` track kind 与 audio track type；
- CC、large text、easy reader、draft 和 auto-sync 标志；
- `serving`/`syncing`/`failed` 状态、可选 failure reason 与 last-updated 时间。

Result 固定声明 `youtube.captions.list`、当前文档的 50 quota units，以及
`captionContentDownloaded/videoMediaDownloaded/modelCalled/procedureStored/proposalCreated/hostExecutionStarted`
全部为 `false`。空 tracks 数组是有效结果，表示授权请求成功但没有字幕轨；Runtime 不推荐或自动选择任何
item。

Coordinator 在网络请求前持久化 requested evidence。相同 requestId 与完全相同输入共享进行中的请求或返回
已完成结果，不同输入冲突。网络调用开始后的失败、权限错误或结果校验失败都要求新的 requestId，避免隐藏
重复配额。completed evidence 保存严格请求和元数据结果，failed evidence 只保存安全错误码；事件不包含 OAuth
token 或字幕正文。Runtime 重启后可以从 completed evidence 返回相同结果而不再次访问 API。

## 结果

用户现在可以先枚举自己有权管理的视频字幕轨，再把明确选择的 track ID 交给 ADR 0078 import。枚举证明的
只是 OAuth 身份能够读取这些轨道元数据，不代表内容已获得训练发布许可，也不证明字幕语义或时间码正确。

仍需 OAuth 登录/refresh、基于用户偏好的显式推荐辅助、视频媒体/ASR fallback、画面与按键识别，以及把已选
字幕获取与 Provider ProcedureTree 生成组合成一个仍受逐阶段授权的工作流。

## 参考

- <https://developers.google.com/youtube/v3/docs/captions/list>
- <https://developers.google.com/youtube/v3/docs/captions>
- <https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps>
