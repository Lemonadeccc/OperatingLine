# ADR 0078：经授权的 YouTube 字幕获取

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0076 接受调用方已经持有的 SRT/WebVTT，ADR 0077 可把该文档交给显式选择的 Provider，但 Runtime
仍不能从视频平台获得字幕。直接抓取任意公开视频字幕会绕过平台权限模型，也无法稳定证明字幕轨、视频和
权利声明的对应关系；把 OAuth 凭据放进 MCP/HTTP 请求或持久化证据还会扩大秘密暴露面。

官方 YouTube Data API 对字幕读取有明确限制：`captions.list` 只返回轨道元数据，`captions.download` 才返回
字幕正文，并且下载要求 OAuth 身份有编辑目标视频的权限。一次完整导入还会产生可观的 API 配额成本，因此
网络与配额操作必须由调用方逐请求显式确认。

## 决策

新增 `ProcedureTutorialYoutubeImportRequest 1.0.0`，通过以下入口暴露：

- MCP `operatingline.procedure.tutorial.youtube.import`；
- HTTP `POST /api/v1/procedure/tutorial/youtube/import`。

请求只接受 UUID `requestId`、目录与树 identity、目标、精确的 11 字符 video ID、caption track ID、
SRT/WebVTT 格式、可选预期语言、默认 cue 置信度、权利声明，以及固定为 `true` 的网络请求、配额与编辑权限
确认。请求 Schema 严格拒绝 OAuth credential 字段。`license_verified` 必须携带 license。

可选 caption source 仅由 composition root 通过 `OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN` 注入。它不实现
OAuth 登录、redirect 或 refresh；token 必须在运行时外取得，不进入 MCP/HTTP payload、日志、descriptor 或
持久化事件。未配置 source 时入口返回可重试的 unavailable，不写 requested evidence，也不访问网络。

一次导入依序调用官方 API：

1. `videos.list(part=snippet,contentDetails&id=...)` 获取标题和 ISO 8601 时长；
2. `captions.list(part=snippet&videoId=...&id=...)` 核对精确轨道归属、语言及 `serving` 状态；
3. `captions.download(id, tfmt=vtt|srt)` 下载字幕正文。

所有请求使用同一个预授权 Bearer token、禁止 redirect，并受统一超时控制。JSON 响应最多 1 MiB，字幕正文
最多 256 KiB；响应必须是有效 UTF-8，远端错误正文不进入公开错误。原始字幕沿用 ADR 0076 的确定性解析、
摘要和 cue 规范化，不增加解析依赖。

成功结果使用 `ProcedureAuthoringPromptPacket 1.3.0`。除 `1.2.0` 的文档摘要外，它还绑定
`youtube_data_api_v3` 来源、`oauth_video_edit_permission`、video/track identity、track language/kind、
draft/auto-sync/serving/last-updated 和下载格式。Packet version、来源 URI、locale、format、request identity
与 `tutorialTranscriptAcquisitionBound` 必须同时匹配；Zod 和发布的 JSON Schema 都执行对应约束。

Coordinator 在网络请求前持久化 requested evidence。相同 requestId 与完全相同输入共享进行中的请求或返回
已完成 packet；不同输入冲突。requested/failed 之后不允许同 requestId 自动重试，调用方必须显式使用新的
requestId，避免隐藏的重复配额消耗。completed evidence 保存严格请求和规范化 packet，failed evidence 只保存
安全错误码；两者均不保存 OAuth token 或原始字幕全文。

该入口只获取一个调用方已知 ID 的字幕轨，不枚举轨道、不下载视频媒体、不转录音频、不调用 Provider、
不保存 ProcedureTree、不创建 Proposal，也不执行 Blender。OAuth 编辑权限和调用方权利声明都不自动构成
released 训练许可。

## 结果

项目现在可以在平台授权边界内，把一个真实 YouTube 字幕轨转换为可验证、可重启恢复的教程 authoring
packet，同时保留原有 candidate-only、人工审阅和宿主执行边界。它不能用来抓取任意公开视频字幕。

仍需 OAuth 授权流程与 token refresh、字幕轨枚举/选择、视频媒体导入与 ASR、画面/按键识别、自动语义
分段、证据帧抽取，以及把 `1.3.0` packet 交给 Provider 后生成完整 ProcedureTree 的组合入口。

## 参考

- <https://developers.google.com/youtube/v3/docs/videos/list>
- <https://developers.google.com/youtube/v3/docs/captions/list>
- <https://developers.google.com/youtube/v3/docs/captions/download>
- <https://developers.google.com/youtube/v3/docs/captions>
- <https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps>
