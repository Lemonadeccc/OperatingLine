# `@operatingline/openai-runtime`

这是一个显式启用 OpenAI Planner Provider 的独立 composition root。默认的
`@operatingline/orchestrator` standalone 仍然不导入厂商 SDK、不读取模型凭据，也不会自动选择
provider。

## 启动

复制仓库根目录 `.env.example` 为被 Git 忽略的 `.env` 并填写，或把同名变量导出到 shell 环境，
然后执行：

```bash
pnpm dev:openai
```

运行脚本使用 Node.js 24 内置的 `--env-file-if-exists` 显式读取仓库根 `.env`，不引入额外的 dotenv
依赖；已有 shell 环境变量也会正常生效。

必须显式设置：

- `OPERATINGLINE_ACCESS_TOKEN`：本地 MCP/HTTP 接口访问令牌，至少 16 个字符。
- `OPENAI_API_KEY`：只由本运行入口传给 OpenAI Provider，不进入协议、事件或公开 descriptor。
- `OPERATINGLINE_OPENAI_MODEL`：明确的模型 ID；项目不会静默选择或升级模型。

可选设置：

- `OPERATINGLINE_OPENAI_EMBEDDING_MODEL`：明确的 embeddings 模型 ID。只有设置后，Provider 列表才公布
  Procedure semantic retrieval 能力；它与 `OPERATINGLINE_OPENAI_MODEL` 独立，不会静默复用 Responses
  模型。每次检索仍要求调用方确认精确 descriptor、embedding model、API/runtime settings、数据传输和
  cost policy。
- `OPERATINGLINE_DATABASE_PATH`：默认 `.data/operating-line-openai.db`。
- `OPERATINGLINE_PORT`：默认 `0`，由系统选择空闲回环端口。
- `OPERATINGLINE_ALLOW_LEGACY_COMPANIONS`：默认 `true`；设为严格的 `false` 后，拒绝未先建立可续租
  Session 的旧版 Companion。只接受精确值 `true` 或 `false`。
- `OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID`：Google Cloud 中类型为 **Desktop app** 的 OAuth client ID。
  设置后先运行 `pnpm youtube:auth login`，系统浏览器通过临时 `127.0.0.1` loopback 回调完成授权；只请求
  `youtube.force-ssl` scope，refresh token 只保存到操作系统凭据库，不提供明文文件回退。可用
  `pnpm youtube:auth status` 验证 grant/刷新，用 `pnpm youtube:auth logout` 撤销并保证删除本地凭据。
  Consent screen 仍为 Testing 的 Google 项目可能签发七天后过期的 refresh token。
- `OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN`：兼容用的预授权短期 token。不能与上述 client ID 同时设置，
  否则启动前直接失败。配置后可显式调用 `operatingline.procedure.tutorial.youtube.import`；授权账号必须能编辑目标视频，Runtime
  只读取元数据和指定字幕轨，不下载视频。若不知道 track ID，可先调用
  `operatingline.procedure.tutorial.youtube.tracks.list`，明确确认网络与当前官方 50-unit 配额后枚举元数据；
  再按明确偏好调用 `operatingline.procedure.tutorial.youtube.tracks.recommend` 做无网络、无额外 quota、无模型
  调用的本地排序。确认后调用 `operatingline.procedure.tutorial.youtube.tracks.select` 保存精确 serving track、
  选择理由及采用/覆盖推荐的结果；可选理由备注会进入本地证据账本。当前 import request `1.1.0` 必须引用该
  `selectionRequestId`，并在任何 API 调用前核对收据与 video/track identity；历史 `1.0.0` 仅保留兼容读取。
  选择操作不下载内容。Token 不进入协议、事件或日志。Managed OAuth 在 API 请求前刷新；API 请求已经返回
  401 时不会自动重放该请求，调用方须检查 status/重新登录后显式重试。

## 调用顺序

初始规划：

1. 调用 `operatingline.planner.providers.list`，检查远端传输、凭据管理、可用性和并发声明。
2. 使用返回的 `providerId` 和一个新 UUID `requestId` 调用 `operatingline.planner.generate`。
3. 检查 `status` 与 `planningQuality`。当前 Blender `1.22.0` 使用 Planning Packet `1.1.0` 和 quality baseline
   `1.1.0`；草案必须把每条具体需求通过 `planning.capabilityCoverage` 映射到 catalog capability 和
   action 匹配的可执行叶子。历史目录继续使用 packet/baseline `1.0.0`。该结果固定
   `proposalCreated: false`。
4. 只有确定要送入宿主审查时，才把草案显式提交给 `operatingline.guide.propose`。

自然语言 ProcedureTree 编写：

1. 调用 `operatingline.procedure.authoring.providers.list` 检查相同 Provider 披露；可先调用不触发模型的
   `operatingline.procedure.prompt.get` 查看精确 packet。
2. 用新 UUID `requestId`、Provider ID、tree ID/revision、目标与可选目录版本调用
   `operatingline.procedure.authoring.generate`。也可附带权利状态明确的 HTTPS 教程视频和已由调用方提供的
   有序字幕分段；这会生成 packet `1.1.0`，Runtime 不下载或转录视频。
3. Runtime 将完整 packet 规范编码后发送，返回 candidate 立即经过 identity、installed catalog 与 compile
   门。成功也不自动 store、materialize、propose 或执行；用户审阅后必须分别显式调用后续入口。

HTTP 对应入口为 `GET /api/v1/procedure/authoring/providers` 与
`POST /api/v1/procedure/authoring/generate`。

ProcedureTree 语义检索：

1. 仅在需要该能力时设置 `OPERATINGLINE_OPENAI_EMBEDDING_MODEL`，然后调用
   `operatingline.procedure.semantic.providers.list` 阅读包含 descriptor、embedding model、API/runtime
   settings 与 cost policy 的完整 disclosure。
2. 使用新 UUID、自然语言 query、该 disclosure 原样快照、`topK/minScore` 和逐项授权调用
   `operatingline.procedure.semantic.search`。默认语料只含 latest verified leaf；可用 adapter/catalog
   filter 缩小最多 256 个 leaf 的 bounded live batch。
3. Runtime 不发送 source/evidence 原文，自己校验向量并计算 cosine。结果不含向量、不生成或保存树、
   不创建 Proposal、不执行 Blender。HTTP 对应入口为 `GET /api/v1/procedure/semantic/providers` 与
   `POST /api/v1/procedure/semantic/search`。

若配置了上述 YouTube OAuth token，可在用户明确确认网络与配额消耗后先调用
`operatingline.procedure.tutorial.youtube.tracks.list`，提交精确的 11 字符 video ID；结果只包含字幕轨元数据，
明确声明一次 `captions.list` 的 50-unit 成本。可选调用
`operatingline.procedure.tutorial.youtube.tracks.recommend`，引用该 completed list 并提供有序偏好；Runtime
返回稳定排名与排除原因，但不联网、调用模型或选择轨道。调用方确认精确 track ID 后调用
`operatingline.procedure.tutorial.youtube.tracks.select` 保存选择和受限理由；理由备注会持久化。随后再调用当前
`operatingline.procedure.tutorial.youtube.import` request `1.1.0`，提交 `selectionRequestId`、所选 caption
track ID、SRT/WebVTT 目标格式和权利声明。它先在本地核对选择收据与精确 video/track identity，再通过官方
API 核对字幕轨归属和 serving 状态，返回带非自由文本选择 provenance 的 packet `1.4.0`，但不调用模型、
保存树、创建 Proposal 或执行 Blender。官方字幕下载要求授权账号具备视频编辑权限，因此该入口不能抓取
任意公开视频字幕。选择理由备注不会进入 packet，也不会转发给 OpenAI Provider。

节点局部重规划：

1. 用户先在 Blender 中提交带节点 `Ref` 的 Revision request；调用
   `operatingline.replan.requests.list` 取得其 `requestId`。
2. 调用 `operatingline.replan.providers.list` 并检查同一 provider 披露；可先用
   `operatingline.replan.prompt.get` 查看不会触发模型调用的类型化 packet。
3. 用一个不同于 revision request ID 的新 UUID 作为 generation `requestId`，连同
   `revisionRequestId + providerId` 调用 `operatingline.replan.generate`。
4. 只有结果为 `ready` 且 `planningQuality.valid`、`locality.valid` 均为 true 时，才把返回的 canonical
   `draft` 原样映射到 `operatingline.replan.propose`，并额外传入
   `generationRequestId: <generation requestId>`。任何编辑或过期 revision 都会被拒绝。
   Capability-aware replan 的 coverage 还只能引用规范化引用子树内的可执行叶子。
5. Proposal 仍只进入发起 Blender 实例的只读审查；宿主用户 Accept 后才会安装，之后仍需用户执行
   `Start`/`Next` 才会修改场景。

HTTP 对应入口依次为 `GET /api/v1/replan/providers`、`POST /api/v1/replan/prompt`、
`POST /api/v1/replan/generate` 和 `POST /api/v1/replan/propose`。所有 MCP/HTTP 请求都需要本地 Bearer
Token。

| 操作                   | 可能调用 OpenAI/计费 | 创建 Proposal | 安装或执行计划 |
| ---------------------- | -------------------- | ------------- | -------------- |
| `replan.prompt.get`    | 否                   | 否            | 否             |
| `replan.generate`      | 是                   | 否            | 否             |
| `replan.propose`       | 否                   | 是            | 否             |
| Blender Accept         | 否                   | 审批既有提案  | 只安装         |
| Blender `Start`/`Next` | 否                   | 否            | 用户显式执行   |

成功生成的严格草案、coverage、quality/locality 报告和 provenance 会进入未自动脱敏的 Eval 证据。
缺失、未知、action 不匹配或局部范围外的 coverage 会产生 `needs_revision`，不会创建 Proposal。
确定性校验只证明 Schema、identity、目录、引用子树范围、coverage 可追溯性和当前结构质量规则成立，
不产生语义分数，不自动选择 provider，也不证明 OpenAI 已正确理解任意目标或修订消息。Proposal 审批和
`Start`/`Next` 场景执行边界保持不变。完整决策见
[ADR 0017](../../docs/adr/0017-catalog-grounded-goal-coverage.md)。
Procedure authoring 边界见 [ADR 0070](../../docs/adr/0070-explicit-procedure-authoring-provider.md) 与
[ADR 0075](../../docs/adr/0075-evidence-bound-tutorial-transcript-authoring.md)。
