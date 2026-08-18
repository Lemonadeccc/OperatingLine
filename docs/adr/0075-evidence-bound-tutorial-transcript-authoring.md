# ADR 0075：证据绑定的教学视频字幕编写

- 状态：Accepted
- 日期：2026-08-18

## 背景

ProcedureTree 已能保存 `tutorial_video` 来源和 `video_segment` 证据，Provider authoring 也能从一句目标
生成经严格校验的 candidate。不过此前 Runtime 没有教学来源输入合同，调用方只能在目标文本里拼接字幕；
视频 URI、权利声明、时间区间、原文和置信度不能成为 packet-bound provenance，模型也可能重写或编造
时间段。

直接下载 YouTube、调用转录服务或把画面推断当成事实会同时引入网络副作用、凭据/费用、内容权利和训练
数据治理问题。本切片只接受调用方已经取得并明确提交的字幕分段，不把来源声明升级为法律审核或发布许可。

## 决策

保留目标专用的 `ProcedureAuthoringPromptPacket 1.0.0`；带教学字幕的请求生成新的 `1.1.0` packet。两个版本
由同一 MCP/HTTP/Provider/validate 管线处理，旧的 `1.0.0` 严格客户端不需要接受新字段。

请求可附带一个 tutorial：

- 视频必须使用 HTTPS URI、非空标题和精确正整数时长；
- `rightsStatus` 只允许 `permission_granted`、`license_verified` 或 `public_domain`，不接受 `unknown`；
  `license_verified` 必须同时给出 license；
- transcript 的 `origin` 固定为 `user_supplied`，可带 locale；
- 最多 2,000 个分段，每段包含 `startMs`、`endMs`、原文和 `0..1` 置信度；分段必须按时间排序、互不
  重叠、具有正区间且不超过视频时长；
- 整个自包含 packet 继续受 256 KiB canonical 大小上限约束。

Runtime 按 tree ID/revision 生成稳定的教程 source ID 和顺序 evidence ID，把每段规范化为不可变
`video_segment`。候选响应 Schema 固定视频来源和全部分段证据，并要求每个 semantic operation 至少引用
一个给定教程 evidence ID。服务端 validator 再独立执行相同规则：缺失、改时、改文、改置信度、用同一
source ID 添加新证据，或产生没有教程证据的语义 operation，均 fail closed。层级、大步骤、小步骤、Action
及参数仍是 Provider 生成的 candidate，不因引用字幕而成为 verified Blender 操作。

`operatingline.procedure.prompt.get` 和 `POST /api/v1/procedure/prompt` 只构造 packet；它们不访问视频、不
转录、不调用模型。显式 `procedure.authoring.generate` 可把完整 `1.1.0` packet 交给已配置 Provider，既有
requested/completed/failed evidence 会保存精确请求、packet hash 和结果，并继续保证不自动 store、
materialize、propose 或 execute。

## 安全与治理边界

- Runtime 不请求视频 URI，因此该字段不是下载器，也不形成 SSRF 网络入口。
- 权利状态是调用方声明，不是法律结论；本切片不允许其直接进入 released 训练集。
- 字幕和视频元数据会随完整 packet 发送给显式选择的远端 Provider，调用方仍须先审阅其数据传输与费用披露。
- candidate 只能描述字幕支持的语义步骤；菜单、快捷键和 action-level MCP 轨迹继续保持 unavailable，直到
  独立的确定性 grounding 与真实宿主验证完成。

## 后续

仍需实现经授权的 YouTube 获取、字幕抓取或语音转录、画面/按键识别、自动分段、证据帧、局部置信度校准、
可视化树编辑与评论、真实逐控件 grounding，以及去重、版本切分、双人盲审和训练/RAG 发布治理。
