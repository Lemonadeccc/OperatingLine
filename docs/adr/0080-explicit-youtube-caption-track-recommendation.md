# ADR 0080：需显式确认的 YouTube 字幕轨推荐

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0079 能枚举授权账号可管理视频的字幕轨，但一个视频可能同时包含多种语言、人工字幕、自动语音识别
字幕、forced track、辅助音轨、草稿和尚未完成处理的轨道。直接取第一个 item 会把 API 返回顺序误当成用户
偏好，也会让后续字幕导入缺少可解释的选择依据。再次调用 Provider 做选择会引入不必要的数据传输、成本和
不确定性。

推荐只能是辅助信息，不能替代用户对精确 caption track ID 的确认。尤其是推荐结果不应自动触发字幕下载，
也不应被持久化为训练真值。

## 决策

新增 `ProcedureTutorialYoutubeTrackRecommendationRequest/Result 1.0.0`，通过以下入口暴露：

- MCP `operatingline.procedure.tutorial.youtube.tracks.recommend`；
- HTTP `POST /api/v1/procedure/tutorial/youtube/tracks/recommend`。

请求引用一个已完成并持久化的 track-list `requestId` 和同一 video ID，不重新携带最多 2,000 条轨道元数据。
调用方必须显式给出：

- 按优先级排列的语言，以及只允许精确匹配还是允许 primary-subtag fallback；
- 是否允许不在语言列表中的轨道；
- 按优先级排列且同时作为 allowlist 的 track kind 与 audio track type；
- 是否允许 draft，以及是否偏好 closed captions 和人工同步；
- 固定为 `true` 的 `explicitSelectionRequired`。

Runtime 只读取 Coordinator 已恢复的 completed track-list evidence。不存在的引用返回 404；requestId 或 video
identity 不一致时 fail closed。排序先排除非 `serving`、不允许的 draft、语言、track kind 和 audio track
type，再依次比较语言匹配类别、语言偏好位置、track-kind 位置、audio-track 位置、draft/CC/auto-sync penalty，
最后按 caption track ID 进行稳定 ASCII tie-break。Result 返回完整候选轨道、连续 rank、各项排序信号和每条
被排除轨道的全部原因，并校验候选与排除数组恰好覆盖来源轨道数量。

结果可以给出第一候选的 `recommendedCaptionTrackId`，但同时固定声明：

- `selection.required: true`；
- `selection.automaticallySelected: false`；
- `selection.selectedCaptionTrackId: null`；
- 不联网、不增加 API quota、不下载字幕或视频、不调用 Provider，也不保存 Procedure、创建 Proposal 或执行
  宿主。

推荐本身不写入事件账本，因为它是对不可变 completed list 的无副作用确定性投影，不是人工选择标签。后续
[ADR 0081](0081-persisted-youtube-caption-track-selection.md) 使用独立显式入口记录实际选择与理由；import 仍由
调用方提交精确 caption track ID。

## 结果

用户可以先付出一次明确披露的枚举配额，再用自己的偏好获得稳定、可解释的候选顺序。Runtime 重启后可直接
引用恢复的 track-list evidence 重新计算，不产生第二次网络请求或 quota 消耗。客户端必须展示推荐和排除
原因，并在 import 前取得显式选择；ADR 0081 已提供选择理由收据，但不能把算法第一名静默转换为下载操作。

后续 [ADR 0082](0082-selection-bound-youtube-caption-import.md) 已把选择收据与当前 import 强制绑定。仍需 OAuth
登录/refresh、选择确认 UI、视频媒体/ASR fallback、画面和按键识别、自动语义分段，以及把已选字幕获取与
Provider ProcedureTree 生成组合成逐阶段授权工作流。

## 参考

- [ADR 0078](0078-authorized-youtube-caption-acquisition.md)
- [ADR 0079](0079-authorized-youtube-caption-track-discovery.md)
