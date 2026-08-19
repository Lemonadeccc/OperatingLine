# ADR 0084：独立授权的 YouTube 教程媒体分析

- 状态：Accepted
- 日期：2026-08-18

## 背景

现有 YouTube 链路只通过官方 Data API 获取已明确选择的授权字幕轨。它不下载视频媒体，也没有音频抽取、
ASR、证据帧、画面文字或快捷键候选识别。媒体处理属于长耗时、本地文件密集型副作用，不能塞进同步字幕
import、256 KiB authoring packet 或 SQLite JSON 事件。现有 OAuth edit permission 也不是视频下载许可。

YouTube 平台政策与内容权利是两个独立边界。即使调用方拥有内容权利，也不能把第三方下载器默认开放为任意
公开视频抓取能力。媒体下载必须有单独、可审计的权利声明，以及 YouTube 对该下载行为的书面批准记录。

## 决策

新增独立的异步教程媒体分析平面。公开请求只接受严格 video ID、固定分析 profile、时间窗口、固定全量阶段
列表和结构化授权收据；不接受 URL、cookie、OAuth token、可执行文件、argv、本地路径或环境变量。下载 URL
只能由 Runtime 根据已验证 video ID 构造。每个下载请求必须同时声明内容权利依据、
`youtube_written_approval` 平台依据、网络访问、媒体下载和本地保留确认。现有字幕 OAuth 与字幕轨选择收据
不能替代这些确认。

授权记录由 operator 预先放入可信服务端 registry；registry 把精确 video ID、内容权利依据/引用、独立的
YouTube 书面批准引用和有效期绑定在一起。Registry 必须通过绝对路径配置，是当前用户拥有、无符号链接或
硬链接、group/other 无访问权限的私有普通文件。内容权利引用与平台批准引用必须不同：拥有或获准使用内容，
不等于获得 YouTube 对下载行为的书面批准，反之亦然。

本地执行器使用由 composition root 配置的绝对路径和固定调用合同：yt-dlp 仅负责经过授权门的单视频获取，
ffprobe 验证媒体，ffmpeg 生成 16 kHz 单声道 WAV 与有界 PNG 帧，whisper.cpp 生成带毫秒区间的 ASR JSON，
Tesseract TSV 提供带坐标和置信度的文字候选。所有子进程均使用 `shell: false`、最小环境、输出与时间上限，
超时或关闭时终止整个进程树。Composition root 会先把这些可执行文件、whisper 模型和当前 locale 精确需要的
Tesseract `.traineddata` 复制进随机、私有、只读的运行时快照，对快照完成版本与哈希预检；Tesseract job 以
固定 `--tessdata-dir` 使用快照模型，工具 provenance 因而绑定显式配置的 launcher、whisper 模型与
`.traineddata` 字节。该字段不宣称覆盖 launcher 的解释器、动态库或操作系统组件等传递依赖；operator 仍须
维护可信的本机运行时基座，包括导入模块与内核。版本输出哈希只记录快照预检结果，不证明这些传递依赖在
job 期间不可变。请求不能覆盖任何工具参数。

直接写文件的下载、音频、证据帧和 ASR 子进程会在运行期间主动监控输出，超过单文件上限立即终止进程树；
pipeline 同时监控每任务 staging 的总字节数和文件类型，并在导入 CAS 后删除 staging 副本。能力中公布的最大
分析窗口不得超过 16 kHz、单声道、16-bit PCM 音频上限可承载的时间，避免先接受无法在配额内完成的 job。

媒体与派生产物进入私有内容寻址存储。系统自行计算字节数和 SHA-256，拒绝符号链接、硬链接、路径逃逸、
越界文件和被篡改对象；公开协议与事件只保存 `operatingline-media://sha256/<digest>` 引用，不保存绝对路径或
媒体字节。完成 manifest 在原子封存后才可作为 job completion 证据。

OCR 文字和快捷键只标记为候选；协议预留 UI candidate 形状，但当前 capabilities 明确报告不提供 UI element
recognition。识别到 `Shift+A` 不证明 Blender 已执行该快捷键，也不会自动推导菜单路径或 MCP 调用。无
Provider 时，系统用版本化确定性算法按 ASR 停顿、标点、最大时长和快捷键时间生成 candidate semantic
segments；结果仍是媒体分析 manifest，不是 ProcedureTree。完整树生成属于后续分阶段工作流，并继续受
ActionCatalog、InteractionCatalog 和 packet-bound validator 约束。

Job 使用 request fingerprint、singleflight、阶段状态和显式 restart。协议只接受完整且固定顺序的
`download → probe → audio → asr → frames → ocr → segmentation` 七阶段。失败若可恢复，状态只会给出
`retryFromStage: download` 和一次精确 recovery receipt；调用方必须再次确认网络、下载和保留副作用。
Restart 会清空已完成阶段并从 download 全量重跑，绝不复用、恢复或跳过任何先前阶段或部分产物。相同
request ID 的不同输入永远冲突。

公开能力与异步 job 分别通过 MCP `operatingline.procedure.tutorial.media.capabilities`、
`operatingline.procedure.tutorial.media.jobs.create`、`operatingline.procedure.tutorial.media.jobs.status`、
`operatingline.procedure.tutorial.media.jobs.restart`，以及 HTTP
`GET /api/v1/procedure/tutorial/media/capabilities`、`POST /api/v1/procedure/tutorial/media/jobs`、
`POST /api/v1/procedure/tutorial/media/jobs/status`、`POST /api/v1/procedure/tutorial/media/jobs/restart`
提供。未配置 registry、工具、模型、locale 或规范绝对路径，或路径/工具预检失败时，capabilities 明确返回
unavailable，不开放不完整或降级执行。

当前 Windows 平台明确报告 `unsupported_platform`。在证明 owner-only DACL、reparse-point-safe open 和等价的
不可替换快照合同前，不以较弱的 Windows 权限语义宣称该能力可用。

## 结果

项目获得真实、可配置且可验证的下载、探测、ASR、帧提取、OCR、快捷键候选和确定性分段能力，同时保持平台
授权、内容权利、秘密、路径和长任务恢复边界。未配置本地工具或模型时 capabilities 会明确报告 unavailable，
不会把接口占位误报为已实现能力。

该决策不授予任何视频的下载或训练权利，不把 OCR/ASR/快捷键候选升级为验证事实，也不生成、存储、提议或
执行 ProcedureTree。

## 参考

- [ADR 0078](0078-authorized-youtube-caption-acquisition.md)
- [ADR 0082](0082-selection-bound-youtube-caption-import.md)
- [ADR 0083](0083-managed-youtube-oauth.md)
- [YouTube API Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Developer Policies Guide](https://developers.google.com/youtube/terms/developer-policies-guide)
- [FFmpeg Documentation](https://ffmpeg.org/ffmpeg-all.html)
- [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md)
- [Tesseract command-line usage](https://github.com/tesseract-ocr/tessdoc/blob/main/Command-Line-Usage.md)
