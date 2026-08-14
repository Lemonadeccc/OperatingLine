# 通用宿主架构

## 不变量

OperatingLine 的通用部分只定义意图、计划、状态和证据。宿主 Companion 负责把语义动作与
锚点翻译成 Blender Operator、VS Code Command、GIMP Procedure 等实际能力。
无界面 Orchestrator 是架构中唯一的计划与调度服务；当前实现已经完成协议验证、受信任计划发布、
AI 提案与逐 Companion 人工决策、经鉴权的回环 Companion 拉取、幂等状态回传、
事件/最新快照持久化、能力描述、版本化 ActionCatalog 注册表、PlanningContext、类型化 provider
局部重规划和 Eval/replay 证据导出。独立 Human Eval 协议、内部 `@operatingline/eval-kit`、本地采集 CLI
与回环评审服务在离线数据集层验证 Provider Run、盲审 annotation、分歧裁决和无分数 comparison；它们不
改变 Orchestrator 的 Proposal 或宿主执行权威。评审界面由本地 headless HTTP service 提供给普通浏览器，
不是 Electron 应用，也不进入 Blender 宿主内视觉链。MCP 客户端、CLI、Web 界面或其他第三方工具都是可
替换的协议消费者，不承担宿主内视觉呈现。Codex/Claude Code 直接使用回环 Streamable HTTP；
Claude Desktop 的本地 MCPB 只提供 stdio→HTTP 薄连接器并继承 Runtime instructions，不复制 Tool
Schema、保存 Token 或取得宿主执行权。

```text
ProcedureTree
  ├─ source-grounded group/leaf hierarchy
  ├─ semanticOperations[] with concrete parameters
  ├─ menuTracks[] / shortcutTracks[] / mcpTracks[]
  ├─ semanticRefs align unequal execution sequences
  └─ candidate/verified/rejected provenance before GuidePlan compilation

Immutable Procedure Library
  ├─ tree id + monotonic immutable revision
  ├─ canonical SHA-256 integrity and atomic audit event
  ├─ exact/latest reads + stable summary pagination
  └─ validated knowledge only; no proposal or host execution

GuidePlan
  ├─ presentation tree: parentId + order
  ├─ execution graph: dependsOn
  └─ executable leaf
       ├─ action(adapterId, name, arguments)
       ├─ semantic anchors
       ├─ expected observations
       └─ rollback policy

GuideProposal
  ├─ proposalId + targetAdapterId
  ├─ immutable GuidePlan revision
  └─ per-companion accepted/rejected decision

ActionCatalog
  ├─ adapterId + catalogVersion
  ├─ strict argument schemas + resource effects
  ├─ supported anchors + observations + rollback
  ├─ ordered planning phases + action membership
  ├─ adapter-owned semantic capabilities + action membership
  └─ declared safety and host-version boundaries

InteractionCatalog
  ├─ adapterId + independent catalogVersion
  ├─ exact ActionCatalog version binding
  ├─ one ordered recipe per action
  ├─ native_path → exact host target + accepted action binding
  └─ semantic_path → explicit unavailable reason + manual reference

PlanningQualityReport
  ├─ baselineVersion + exact catalog reference
  ├─ deterministic errors/warnings + phase coverage
  ├─ requirement → capability → executable-leaf trace
  ├─ resource dependency + visible-guidance findings
  └─ no semantic or aesthetic score

PlanningPromptPacket
  ├─ exact PlanningContext + catalog version
  ├─ strict GuideProposal draft JSON Schema
  ├─ capability-aware 1.1.0 / historical replay 1.0.0
  ├─ deterministic planning workflow instructions
  └─ MCP Prompt / Tool / HTTP delivery, no embedded model

PlannerProvider
  ├─ explicitly injected in-process plugin + public descriptor
  ├─ generate(PlanningPromptPacket) + optional replan(ReplanningPromptPacket)
  ├─ receives an AbortSignal and returns an untrusted JSON draft
  └─ strict validation + quality evidence, never auto-proposes

Local AI client distribution
  ├─ Codex/Claude CLI idempotent config installer
  ├─ environment-referenced Bearer token, never embedded
  ├─ MCP discover/initialize workflow instructions
  └─ Claude Desktop MCPB stdio → loopback HTTP bridge

GuideGoalRequest
  ├─ immutable host-authored goal + reserved Plan ID
  ├─ exact adapter + instance + ActionCatalog version
  ├─ pending MCP discovery + exact PlanningPromptPacket lookup
  └─ linked instance-scoped Proposal, never automatic execution

GuideRevisionRequest
  ├─ requestId + adapterId + instanceId + catalogVersion
  ├─ complete immutable base Plan
  ├─ stable nodeId + user-visible nodeNumber references
  └─ user-authored revision message

ReplanningPromptPacket
  ├─ immutable revision request + exact catalog + instance state
  ├─ referenced_subtrees_v1 deterministic locality scope
  ├─ capability-aware 1.1.0 / historical replay 1.0.0
  ├─ strict complete PlannerReplanDraft JSON Schema
  └─ provider-free MCP Tool/HTTP delivery or explicit provider.replan()

PlannerReplanGenerationResult
  ├─ canonical complete draft + Plan diff
  ├─ identity + locality + catalog + quality evidence
  ├─ proposalCreated: false
  └─ explicit canonical replan.propose required

GuideRevisionThreadHistory
  ├─ thread + adapter + instance scope
  ├─ exact request + proposal + diff + decision per turn
  ├─ derived review state
  └─ newest page + beforeTurn cursor

EvalExportBundle
  ├─ adapter + Plan + optional instance scope
  ├─ exact catalogs + related immutable events
  ├─ frozen snapshot id/upper sequence + stable cursor
  ├─ aggregate counts inside the frozen event view
  └─ canonical content SHA-256 + raw-data warning

HumanEvalSuite
  ├─ versioned rubric + initial/local-replan cases
  ├─ must/must_not/should requirements + content-addressed references
  ├─ collecting/released/retired lifecycle
  └─ blind review, no numeric score/ranking, no synthetic published runs

ProviderEvalRun
  ├─ exact case + packet + request + strict result/error
  ├─ provider/model/API + host/catalog environment + generation settings
  ├─ source event/artifact hashes + condition/treatment hashes
  └─ no credentials, raw provider response, or private reasoning

Local Human Eval collection
  ├─ frozen versioned snapshot from loopback Runtime
  ├─ provider_only or host_execution_with_manual_artifacts capture
  ├─ one signed provider-blind sidecar required for every run
  └─ serialized atomic writers under one dataset lock

Headless Eval review service
  ├─ loopback HTTP + ordinary browser, not Electron
  ├─ opaque run/evidence/annotation tokens per session
  ├─ no provider profile, aliases, sidecar, or real run id in browser DTOs
  └─ independent preparer, two reviewers, and disagreement adjudicator

Headless Eval collection status service
  ├─ separate loopback-only operator session, read-only routes
  ├─ aggregate treatment/sign-off/review/adjudication counts only
  ├─ no case/run/provider/reviewer identifiers or review artifacts
  └─ collection minimums only, release readiness always not assessed

HumanEvalAnnotation / HumanEvalAdjudication
  ├─ exact run + rubric content hashes
  ├─ provider-blind per-criterion human judgments + evidence
  ├─ supersession without history overwrite
  └─ preserve disagreement, adjudicate independent current reviews

HumanEvalComparisonReport
  ├─ groups runs only by identical condition hash
  ├─ preserves reviewer judgments and missing/incomplete states
  ├─ published view excludes synthetic test fixtures
  └─ no numeric score or provider ranking
```

## 接入等级

| 等级     | 宿主条件                    | 可提供体验                                     |
| -------- | --------------------------- | ---------------------------------------------- |
| Native   | 官方插件/扩展 API           | 内部任务树、对象锚点、Overlay、原生动作与回退  |
| Assisted | 命令/API 可用但 UI 扩展有限 | 外部任务树、宿主命令、部分观察与回退           |
| Observed | 只有 Accessibility/视觉接口 | 屏幕提示与人工确认，不保证精确锚点或确定性回退 |

协议通过能力画像选择体验，规划器不得假设所有软件都有 Blender 等级的能力。

自动 action 只能位于结构叶子，并且其 `dependsOn` 只能指向其他自动 action。所有 Companion
按 DAG 拓扑顺序执行；`order` 和 `id` 只负责在多个 ready 节点之间提供跨语言稳定次序。
步骤 ID 限制为协议定义的可移植 ASCII 标识符，避免不同运行时的 Unicode 排序规则造成漂移。
actionless 叶子是说明或人工步骤，不会被自动执行器当作已经完成的依赖。

Companion protocol v1 以单宿主计划为投递单位：一个 GuidePlan 的所有非空 action 必须使用
同一个 `adapterId`。Orchestrator 在发布时拒绝混合宿主计划，不临时过滤步骤；否则会破坏
`parentId`、`dependsOn`、编号和 revision 的整体语义。纯 actionless 计划没有宿主路由信息，
当前只保存为已发布计划，不进入 Companion 投递链路。跨宿主投影与协调需要后续协议设计。

## Companion 同步契约

首个 transport 使用经 Bearer Token 鉴权的回环 HTTP 短轮询：Companion 以
`adapterId + instanceId` 标识实例，使用同组的
`knownPlanId + knownRevision + knownPlanContentSha256` 拉取更新，并以
唯一 `reportId`、单实例递增 `sequence` 回传状态。Orchestrator 将精确重试识别为 duplicate，
拒绝旧 sequence，并把同 reportId 的不同内容识别为 conflict。

同一次拉取也可以返回该宿主的最新 GuideProposal。Companion 用 `knownProposalId` 阻止待审草案
重复入队；用户在宿主内接受或拒绝后，以 `proposalId + adapterId + instanceId` 回传决策。
同一实例对同一 proposal 的同值重试是 duplicate，相反决策是 conflict；另一个宿主实例拥有
独立的审查决定。提案和决策都以完整版本化 payload 追加写入数据库，Orchestrator 重启后仍可
恢复尚未决定的最新提案与 Plan revision 水位。

宿主还可以从没有初始 AI 计划的状态提交不可变 `GuideGoalRequest`。请求只记录用户目标、预留 Plan ID、
精确 adapter/instance/catalog 和时间，不选择或调用 Provider。外部 MCP 客户端通过
`operatingline.goal.requests.list` 发现 pending 请求，再用 `operatingline.goal.prompt.get` 取得现有
供应商无关 PlanningPromptPacket。客户端先 evaluate 完整 draft，再把 draft 与 `goalRequestId` 交给
既有 `operatingline.guide.propose`；Orchestrator 核对请求身份并把 Proposal 只投递给原实例。请求提交、
packet 获取、规划、Proposal 到达和 Reject 都不改变宿主场景；Accept 只安装，`Next` 才可能执行动作。
同一实例只保留一个 pending goal request，并在 Initial Plan Run、Replan Run、Dialogue Run 与未决 Proposal 之间执行
目标级互斥。Goal 来源 PlanningContext 只携带发起实例的状态；规划事件在 packet 外层保存
request/instance 来源，实例范围 Eval 不接受无来源或其他实例的 context、prompt、quality 证据。
完整请求边界见 [ADR 0020](../adr/0020-host-initiated-goal-to-guidance.md)。

宿主还可以把活动树或待审树的节点引用提交为不可变 GuideRevisionRequest。Orchestrator 核对完整
base Plan、精确目录版本与每个节点编号，并通过 MCP 暴露待处理请求。外部模型客户端只能返回相同
Plan ID 的完整更高 revision；它不能原地 patch 已审批计划。生成的 Proposal 绑定请求 ID 并按
`targetInstanceId` 只投递给发起实例，仍然经过同一宿主内 Accept/Reject 门禁。协议 `1.1.0` 为请求
增加线性 `revisionThread`；后续 turn 必须引用当前 head，并以父请求关联 Proposal 的完整 Plan 为
精确基线，而且父 Proposal 必须已在同一宿主实例接受。Orchestrator 对 base/target 计算确定性 Plan diff，保留计划字段、节点增删移动、步骤字段
以及 action 参数的 JSON 前后值；宿主只负责验证并呈现，不自行猜测差异。

协议 `1.3.0` 还允许请求携带直接引用 action 参数的结构化 `before/after` edit。宿主先用精确目录验证
隔离副本，Orchestrator 再核对 base 值与合并后的完整 arguments；Provider 输出若没有逐项采用 `after`，
locality gate 以 `parameter_edit_not_applied` 拒绝。表单草稿、请求排队和 Proposal preview 都不修改活动
Plan 或场景。

协议 `1.4.0` 把 thread 内线性历史扩展为显式 revision DAG，但不改变既有父链唯一性。每个请求声明
`revise`、`fork` 或 `merge`；fork 从另一条已接受 head 建立 turn 1，merge 继续目标 thread 并引用另一条
已接受 head。Runtime 要求 source 仍是当前 head，并从请求父边加 fork/merge source 边推导唯一最低共同
祖先。三方合并按 Plan/step 字段递归组合独立 JSON object 改动，数组保持原子；同字段分歧、删除与编辑
并发、Plan identity 变化、无唯一共同祖先或空 source contribution 都会在创建请求或 prompt 时失败。
Provider 收到完整 ancestor/source/target 与权威 `expectedMergedPlan`，输出必须与其深度相等；它不能自行
解决冲突。Merge Proposal 保存 `mergeBaseRequestId`，仍经过同一 diff 与 Accept/Reject 门。

`CompanionDialogueRun 1.0.0` 为 Revision Workspace 增加一条独立、逐轮授权的模型对话路径。用户必须
明确选择支持 dialogue/replan 的 Provider，并确认数据处理、可能费用、最多两次 Provider 调用、固定
`0.8` 自动重规划阈值以及只创建 Proposal 的边界。第一次调用把助手文本增量持久化为 append-only
revision，并只返回严格的 `answer` 或 `replan(confidence)` 决策；没有 replan 决策或置信度低于阈值时
只结束回答。达到阈值时，Runtime 才把预先授权的普通 `revise` 候选原子保存为 GuideRevisionRequest，
再以第二次调用复用既有类型化 replan、quality/locality gate 与 canonical propose。Blender 不直接消费
Provider SSE，只短轮询 durable Run 状态；任何成功重规划最多进入只读 Proposal，Accept 前不安装计划，
`Next` 前不修改场景。完整边界见
[ADR 0035](../adr/0035-streamed-dialogue-and-semantic-replanning.md)。

`operatingline.replan.thread.get` 与 `/api/v1/replan/thread` 从现有请求、Proposal 和决策表派生只读
消息历史，不复制一份可变聊天日志。查询以 thread、adapter 和 instance 隔离，默认返回最新页并用
`beforeTurn` 向前分页；每页仍按 turn 正序阅读。Blender 合并已加载页面，但不会把 Proposal 当作
模型推理或流式聊天内容。

`operatingline.replan.branches.list` 与 `/api/v1/replan/branches` 同样从规范化表派生每条 thread 的 durable
head。只有已接受 head 返回完整 Plan 与内容 SHA-256；Blender 可在无 receipt、无待审 Proposal/活动 Run
时切换到它，切换只替换 Session，不执行 action 或修改场景。

Companion Session `1.0.0` 把在线 presence 与耐久状态快照分离：列表、规划和重规划上下文只暴露仍在
15 秒 TTL 内的最新快照；5 秒心跳续订租约，过期只从在线视图移除，不删除审计状态。新版 Companion
还在首次投递前协商 Guide 协议、ActionCatalog 与 `AdapterCapabilities`；Phase 0 旧客户端只有由合法
状态报告续订、且可关闭的有界隐式 presence。完整协议与兼容边界见
[ADR 0040](../adr/0040-companion-session-leases.md)。该 presence 证明后台传输近期可达，不证明宿主
主线程或动作执行已就绪；lease 当前只约束 Guide/state 通道，不替代全局 bearer 和端点 payload 校验。
Transport、线程和 UI 规则由各宿主实现，但不得改变以下不变量：

- 计划投递本身不执行 action，也不删除宿主数据。
- 提案接收与校验只建立只读预览；只有宿主内的显式 Accept 才能替换没有未回退 receipt 的
  活动会话，Reject 必须保持活动计划与宿主数据不变。
- 宿主 API 调用只能发生在宿主允许的线程/事件阶段。
- 动作目录必须是允许列表，不能把任意代码执行包装成通用 action。
- 非法计划、过期或冲突状态必须显式失败。
- 离线能力与网络能力分开声明，断线不能破坏已安装的本地计划。

`0.1.0` 的 observation 是执行后的遥测：`satisfied: false` 会被原样回传，但尚不改变
`step_succeeded` transition，也不触发自动补偿。它不能被规划器或 eval 当作已验证成功；
动作结果与观察判定、补偿策略的分离仍属于下一阶段。

当前“AI 规划”边界是 model-neutral：Codex、Claude 或其他 MCP 客户端先选择
`operatingline.plan_and_propose` MCP Prompt、调用 `operatingline.planning.prompt.get` Tool，或直接调用
`operatingline.planning.context`，取得目标宿主的精确版本化目录、Companion 状态、revision 提示、
计划约束和目录声明的有序阶段。客户端根据自然语言目标选择 `requiredPhaseIds` 并生成完整
GuidePlan，再调用 `operatingline.planning.evaluate`。当前 Blender `1.12.0` 目录提供十四项适配器自有
`semanticCapabilities`；capability-aware 规划必须在 `planning.capabilityCoverage` 中声明
`requirement -> capability -> executable leaf` 链。quality baseline `1.1.0` 除既有阶段树、阶段顺序、
资源创建与依赖、语义锚点和预期观察外，还确定性检查能力/步骤存在、步骤可执行且 action 属于相应能力。
历史无能力目录继续以 baseline `1.0.0` 回放。`operatingline.guide.propose` 会用相同 planning intent
重跑质量门，有 error 时不会持久化 Proposal。每次检查会追加
`planning.quality.evaluated` 事件用于 replay/Eval。

Planning/Replanning Packet `1.1.0` 用于带 `semanticCapabilities` 的目录，把完整上下文、严格草案
JSON Schema、coverage 要求和相同工作流规则作为确定性协议对象；历史目录仍生成和解析 packet
`1.0.0`。同一构建器为 MCP Prompt 提供渲染文本，并让 MCP Tool/HTTP 返回完整 packet。
`planning.prompt.generated` 进入同一证据链。Prompt 是用户控制入口，Tool 是模型控制入口，两者都由
客户端选择模型和发送授权。这三条 provider-neutral packet 入口和默认 standalone 不调用模型、不读取
供应商密钥，也不依赖从 2026-07-28 起已弃用的 MCP Sampling；只有独立 opt-in composition root 会把
显式配置的 provider 注入同一核心 runtime。

Orchestrator 不内置模型，也不通过关键词假装理解目标；目标所需阶段和具体需求均由 provider/调用方
显式声明。质量报告没有总分，只证明候选 Plan 满足当前目录可表达的结构、资源流和 coverage
可追溯约束。它不判断需求抽取是否正确、参数是否满足描述、结果是否好看或目标语义是否完整；
通用边界会递归验证目录的机器可执行参数 Schema，Blender Companion 仍负责真实资源
与执行时宿主状态的最终验证。当前雪人与机器人
两个可重放参考证明质量门不再只绑定一个题材，但不能外推为任意自然语言目标已经可靠。详细决策见
[ADR 0011](../adr/0011-cross-target-planning-quality-gate.md)。Planner Packet 的供应商边界见
[ADR 0012](../adr/0012-provider-neutral-planner-packets.md)。目录约束 coverage 决策见
[ADR 0017](../adr/0017-catalog-grounded-goal-coverage.md)。

节点局部重规划对当前 Blender `1.12.0` 使用独立的 `ReplanningPromptPacket 1.1.0`；历史目录继续使用
`1.0.0`。MCP
`operatingline.replan.prompt.get` 与 HTTP `POST /api/v1/replan/prompt` 从一个仍 pending 的线性 thread
head 构建相同 packet；其中绑定完整 immutable base Plan、引用节点、精确 ActionCatalog、发起实例最新
状态、确定性目标 revision 和 `referenced_subtrees_v1` scope。该入口只生成 packet，不调用模型或创建
Proposal。外部 MCP 客户端也可以直接消费 packet，自行生成完整新 Plan，再通过既有 evaluate/propose
边界送审。

`referenced_subtrees_v1` 会去除被另一个引用根包含的重复内层根。输出必须是完整 Plan，且 title、
`rootStepId`、scope root 的 `parentId + order` 和 scope 外步骤不变；既有后代不能跨规范化 scope 移动，
新步骤只能加入 scope 内，并且不能是 no-op。这些条件由 Orchestrator 根据 base/target Plan
确定性检查，不依赖 provider 遵守 prompt。Capability-aware replan 的 coverage step 还必须位于规范化
引用子树内；范围外映射产生确定性 error。Locality 和 coverage 都只证明声明符合机器规则，不证明
自然语言修改正确。

可选 Planner Provider 建立在 packet 之上。只有嵌入 `startRuntime` 的 composition root 显式传入
`plannerProviders`，对应 provider 才会注册；默认 standalone 不读取 provider 配置、凭据或任意模块。
MCP `operatingline.planner.providers.list` 与 HTTP `GET /api/v1/planner/providers` 只返回公开
descriptor，包含可用性、并发限制、执行位置、数据传输和“凭据由 provider 管理”的声明，不包含密钥。
本地执行只能声明不传输，远端执行必须声明 provider-managed 传输，矛盾组合会被协议拒绝。
调用方必须在每次生成时向 MCP `operatingline.planner.generate` 或 HTTP
`POST /api/v1/planner/generate` 明确给出 `providerId` 与 UUID `requestId`；核心没有默认 provider，
也不做自动选择。

Provider SDK 的 `generate()` 为必选，`replan()` 为可选。只有实现 `replan()` 的 provider 才会出现在
MCP `operatingline.replan.providers.list` / HTTP `GET /api/v1/replan/providers`，并可被
`operatingline.replan.generate` / `POST /api/v1/replan/generate` 显式调用。初始与局部协调器共享同一
invocation manager，因此 provider/全局并发、同一 `adapter + planId` 排他、超时、关闭、持久 request ID
和 at-most-once 重试规则跨两种 operation 一致；request identity 还包含 operation，不能在 initial 与
replan 间复用同一个 UUID。

```text
explicit caller
    │ providerId + requestId + goal
    ▼
Orchestrator ── exact Planner Packet ──> injected PlannerProvider
    │                                      │ provider-owned credentials/network/cost
    │<──── untrusted PlanningProposalDraft ┘
    ▼
canonical packet copy + strict schema + immutable identity + nested ActionCatalog + coverage + quality checks
    │
    └─ PlannerGenerationResult { status, draft, planningQuality, proposalCreated: false }
                                               │ separate explicit call
                                               ▼
                                 operatingline.guide.propose
                                               │
                                               ▼
                                      in-host human approval
```

局部生成同样不会隐式送审：

```text
pending GuideRevisionRequest
    │ prompt.get (no model, no Proposal)
    ▼
ReplanningPromptPacket ── explicit replan.generate ──> provider.replan()
    │<──────── untrusted complete PlannerReplanDraft ────────┘
    ▼
identity + referenced-subtree locality + ActionCatalog + coverage + quality checks
    │
    └─ { status, draft, planDiff, locality, proposalCreated: false }
                                               │ exact draft + generationRequestId
                                               ▼
                                  explicit replan.propose
                                               │
                                               ▼
                         instance-scoped Proposal → in-host Accept/Reject
```

带 `generationRequestId` 的 `replan.propose` 必须逐字段等于 completed generation 中的 canonical draft，
并再次核对 immutable request、实例、当前目标 revision、locality 和质量门。成功时 Proposal、revision
request 关联、revision-proposed 事件与 provider-generation provenance 在一个数据库事务中写入。这样
`generate` 的数据传输/费用授权、创建可审批 Proposal 和宿主内接受是三个独立状态转换。没有
`generationRequestId` 的 provider-free 外部客户端路径继续兼容，但不会声称来自某次 provider generation。

初始和局部 provider generation 都把缺失 coverage、未知 capability、不存在或 actionless 的 step、
action/capability 不匹配以及局部范围外 step 作为 planning-quality error。结果状态为
`needs_revision`，`proposalCreated` 保持 `false`；只有单独的 canonical propose（或已逐次授权的 Run
组合该调用）才能创建待审 Proposal。Coverage 不改变 provider 的显式选择、数据披露、宿主 Accept 或
`Start`/`Next` 执行边界。

能够等待长 Promise 的 MCP/HTTP 客户端继续使用上述分离路径。Initial Goal 还可以在 Goal 已持久化后，
由宿主用户明确选择 Provider、查看数据/可能费用披露并逐次确认异步
`CompanionInitialPlanRun 1.0.0`：

```text
Goal acknowledgement + explicit provider + per-call disclosure confirmation
                                │
                                ▼
POST companion/initial-plan-run ── 202 queued
                                │ background, exact Goal provenance
                                ├─ needs_revision ── no Proposal
                                └─ ready ── canonical Goal Proposal
                                                    │
short GET status ◄──────────────────────────────────┘
        │ proposal_created
        ▼
existing Companion delivery → in-host Accept/Reject → Next may mutate scene
```

Goal Run 把 `goalRequestId + targetInstanceId` 与完整生成请求一起纳入 fingerprint 和事件，普通 MCP
generate 不能以相同 UUID 冒充宿主授权。Goal Proposal、请求关联与唯一 generation provenance 在一个
事务中写入；恢复只认该来源并且绝不再次调用 Provider。详细决策见
[ADR 0021](../adr/0021-host-authorized-asynchronous-initial-plan-runs.md)。

局部修订的宿主 Companion 另有版本化异步
`CompanionReplanRun 1.0.0`：它在用户查看 Provider descriptor 并逐次确认后，先持久化授权并立即返回
`202 queued`，再由 Orchestrator 后台复用相同 generate 和 canonical propose 权威。

```text
host acknowledgement + explicit provider + per-call disclosure confirmation
                                │
                                ▼
POST companion/replan-run ── 202 queued
                                │ background, same validated authorities
                                ├─ needs_revision ── no Proposal
                                └─ ready ── canonical replan.propose
                                                    │
short GET status ◄──────────────────────────────────┘
        │ proposal_created
        ▼
existing Companion delivery → in-host Accept/Reject → Next may mutate scene
```

Run request 不携带凭据、endpoint、模型或 reasoning；它绑定 generation/revision UUID、Provider ID/version、
adapter/instance，以及数据处理、可能费用和 Proposal creation 三项确认。同一宿主实例只允许一个非终态
Run，且已有待决 Proposal 时拒绝新 Run；所有 Proposal 写入还会在事务中原子取得一个 unresolved slot，
所以 Provider 等待期间的并发外部 Proposal 最多让 Run 安全失败，不会留下两个待审项。状态仅为 `queued | generating | needs_revision |
proposal_created | failed | interrupted`，携带 `sceneChanged: false`、安全错误或确定性 quality/locality
findings，不返回 raw draft/错误/推理。Runtime 重启/关闭会从 durable completed/proposed evidence 恢复
needs-revision 或 Proposal，必要时只用持久化 canonical result 补完 propose，绝不再次调用 Provider；
只有不确定的非终态 Run 标记 `interrupted`。Retry 必须重新确认并使用新 generation UUID，不能静默重复可能已计费的调用。此组合授权允许 ready 结果进入
既有 Proposal 审查面，不包含 Accept 或执行授权。详细决策见
[ADR 0016](../adr/0016-host-mediated-asynchronous-replan-runs.md)。

宿主在非终态期间保留精确 Run identity，并阻止第二次 request、Provider refresh 与并发 Proposal decision；
普通 Plan/Proposal delivery 不得清除该 identity。首次 ACK 只接受当前 pending request，精确重复为 no-op；
非活动的新 Plan 安装会使旧 request context 失效，晚到 ACK 不能恢复授权。
独立到达的 Proposal/status 以 `(revisionRequestId, proposalId)` 复合键在宿主内有界对账，且 request-linked
Accept 必须再次匹配当前 active Plan 与 diff base；容量压力不会自动替用户 Reject。

首个具体实现 `@operatingline/openai-planner-provider` 使用官方 OpenAI JavaScript/TypeScript SDK 的
Responses API。构造 provider 时必须给出明确模型；独立 `services/openai-runtime` 还要求
`OPENAI_API_KEY`，并通过 `pnpm dev:openai` 显式启动。它与默认 `pnpm dev` 是两个 composition root：
前者安装一个 OpenAI provider，后者继续以空 provider registry 启动，不导入厂商 SDK 或读取模型凭据。

```text
pnpm dev                                  pnpm dev:openai
    │                                         │ explicit model + API key
    ▼                                         ▼
provider-free standalone                 services/openai-runtime
                                              │ inject one remote provider
                                              ▼
                                      official OpenAI Responses SDK
```

本机 CLI 使用第三个显式 composition root `pnpm dev:clients`。它同时注册 Codex CLI 与 Claude Code CLI
descriptor；缺失的 executable 保留为不可用项。Blender 仍通过同一个宿主授权 Initial/Replan Run 调用，
而不是新增一条绕过 Provider 契约的命令路径。

```text
pnpm dev:clients
    │ probe installed executables only
    ▼
services/cli-runtime
    │ exact renderedPrompt over stdin after one Blender confirmation
    ├─> Codex: temporary cwd + ephemeral + read-only + no shell env inheritance
    └─> Claude: safe mode + no tools/session + bounded per-run budget
              │ JSON only
              ▼
      canonical Provider validation → pending Proposal → in-host Accept/Reject
```

CLI 子进程不会继承任何 `OPERATINGLINE_*` 或 MCPB signing 变量。Codex/Claude 自己管理认证与远端费用；
descriptor 因此声明 remote/provider-managed，而不是因 executable 在本机就错误声明“无数据传输”。默认
runtime 仍不导入这个包。Codex/Claude 桌面 GUI 没有稳定 headless API，继续作为外部 MCP Host 使用。

Runtime HTTP handler 与 stdio bridge 由 MCP SDK 2.0 提供双时代入口。bridge 上游 Client 使用 auto
negotiation，下游使用 `serveStdio`：现代客户端协商 `2026-07-28` 的 `server/discover + _meta`，旧客户端
继续使用 `initialize`。当前业务没有 Sampling/Roots/Elicitation/Tasks consumer，因此只声明实际使用的
Tool、Prompt 与 Resource 转发能力。

OpenAI 请求固定 `store: false` 与 32,768 个输出 token 上限，SDK client 固定 `maxRetries: 0`，并接收
协调器的 `AbortSignal`。初始 `generate()` 与局部 `replan()` 固定 `stream: false`；dialogue 使用
`stream: true`、禁用并行 tool call，并只转发 `response.output_text.delta`。这使核心的显式重试和
at-most-once request ID 语义不被 SDK 隐式重试绕过，但取消仍是协作式的。当前 Proposal Schema 的 action arguments 与
observation parameters 是由版本化
ActionCatalog 约束的动态 records，不符合厂商严格 Structured Outputs 支持的 JSON Schema 子集；插件
因此使用 JSON Object mode，只要求厂商返回可解析 JSON。JSON Object mode 不是 OperatingLine 信任
边界：核心仍对未知返回执行权威的严格 draft Schema、packet identity、递归 ActionCatalog 和确定性
质量校验。

该 provider 的公开 descriptor 声明 `executionLocation: remote`、
`dataTransmission: provider_managed` 与 `credentialManagement: provider_managed`。它不公开模型凭据；
模型只存在于 provider 配置和描述文本，不进入通用 generate wire request。该实现用同一清洗后的
Responses 边界支持初始 `generate()`、局部 `replan()` 与 streamed dialogue；前两者不会自动创建
Proposal，dialogue 也只有在逐次授权且语义阈值通过后才可能组合一个待审 Proposal。这些路径都不证明
任意目标或节点修改的语义规划质量。具体厂商决策见
[ADR 0014](../adr/0014-openai-responses-planner-provider.md)，类型化局部重规划决策见
[ADR 0015](../adr/0015-typed-provider-local-replanning.md)。

Generate 可能把用户目标、Companion 状态和完整 ActionCatalog 传给远端服务并产生费用；公开 descriptor
只做披露，不替调用方作授权决定。核心不把 API Key、endpoint 或模型参数放进 wire schema，也不持久化
provider 原始错误、原始响应或私有推理。它会持久化成功生成的严格草案、coverage、质量报告和 requested/completed
事件供 Eval 使用，因此草案仍可能敏感。运行时对 provider 输出设置大小、并发与超时边界，并把
`AbortSignal` 传给插件；取消是协作式的，忽略 signal 的插件或上游请求可能在核心已经返回超时后继续。
进程内插件能访问所在进程的权限和内存，所以这是清晰的依赖边界，不是进程级安全隔离。

同一 `requestId` 的同内容并发调用共享一个结果；已完成调用可跨重启按证据重放。已经失败、超时或只
留下 requested 证据的 ID 不会被核心自动重试，以免重复付费或产生重复外部副作用；调用方确认后必须
使用新 UUID 发起显式重试。错误的 `retryMode` 会区分可复用原 ID、必须使用新 ID 和不可重试。启动时
只通过事件类型索引读取 generation 证据，不扫描完整 Eval 账本。生成结果不会创建 GuideProposal、
不会投递 Companion，也不会修改 Blender。
即使 `status: ready`，调用方仍需另行 `guide.propose`，而 Proposal 仍可能因其间出现的新 revision
而被正常拒绝。详细决策见 [ADR 0013](../adr/0013-explicit-planner-provider-boundary.md)。

## Eval/replay 证据边界

`operatingline.eval.export` 与 `GET /api/v1/eval/export` 从同一追加式事件账本建立版本化证据包。
`targetAdapterId + planId` 是必需 scope，`instanceId` 可把人工决定和状态限制到一个 Companion。
Orchestrator 通过 Proposal/RevisionRequest ID 解析跨事件关联，因此决定与请求不必紧邻其完整计划。
每个包携带引用到的精确 ActionCatalog、整个冻结 scope 的计数和当前分页事件；`afterSequence` 使用
数据库显式自增序列，跨重启稳定，单页最多 1,000 条。尚未带 Plan reference 的初始 `connected` 状态
不会被猜测归入某个计划。

Format `1.1.0` 的第一页固定使用 `afterSequence: 0`，冻结当时账本的 `snapshotUpperSequence`，并从
format、scope、上界和精确 catalogs 派生 `snapshotId`。Continuation 必须同时提交
`snapshotId + snapshotUpperSequence`，且 cursor 不得超过冻结上界。关系解析、事件匹配、目录选择和
汇总都只读取该上界内的事件；翻页期间追加的新事件不会进入既有快照。Scope、目录或上界与 snapshot
identity 不一致时显式拒绝，避免不同页面悄悄观察到不同账本状态。

内容摘要覆盖协议/格式版本、scope、目录、事件页、分页信息、汇总和数据处理声明，不包含随机
`exportId`、`exportedAt` 或摘要自身。相同事实页因而得到相同 SHA-256。当前实现不自动脱敏，也不
计算质量分数；`planning.prompt.generated` 的输入契约、provider 生成的严格草案及 coverage、
`planning.quality.evaluated` 中原样 coverage 与确定性
finding 与 `satisfied: false` observation
都保持原始事实，不会被导出层改写成主观语义评分或执行失败结论。调用方在分享或训练前必须审核
敏感内容。Replan packet、provider requested/completed/failed 和显式 propose provenance 也按
adapter、Plan 与可选 instance 路由到同一证据包。详细决策见
[ADR 0007](../adr/0007-versioned-eval-evidence-export.md)。

## Human Eval 证据边界

Human Eval 是原始 Eval export 之上的独立、离线数据集层，不是 Orchestrator 的实时评分服务。
`HumanEvalSuite` 固定 rubric、案例、精确 ActionCatalog 内容哈希、需求、reference artifact、采集状态和
数据政策；
`ProviderEvalRun` 捕获初始规划或局部重规划的精确公开 request/packet/result、Provider treatment、宿主
条件、源事件与 artifact 哈希。Run 的 `conditionSha256` 隔离案例/packet/宿主环境，
`treatmentSha256` 隔离 Provider profile 与 generation settings，防止把不同 catalog、模型参数或宿主
版本伪装成同一对照。

本地采集按固定顺序推进：从回环 Runtime 冻结版本化 snapshot；将其捕获为 `provider_only`、包含已验证
宿主终态及人工提供工程/PNG 的 `host_execution_with_manual_artifacts`，或逐字绑定 Guide/Companion
`1.5.0` 终态哈希的 `host_execution_with_runtime_attested_artifacts` Run；由独立 preparer 对盲审投影与补充 alias 清单
执行 `no_provider_identity_visible` 检查，并对每个精确 PNG 哈希人工确认像素中没有 Provider 标记后写入
不可覆盖的 sign-off sidecar；再由两名独立 reviewer 在
浏览器工作台提交 annotation；若当前 annotation 存在逐 criterion 分歧，才由既不是 preparer 也不是
reviewer 的 adjudicator 裁决。评审 workspace 在打开时要求每个 Run 都有完整、有效且仍绑定当前 Run
内容和盲审投影的 sidecar。

评审服务是只监听 `127.0.0.1` 的 headless HTTP 进程。每个进程建立一个 reviewer 或 adjudicator session，
把 bearer token 放在输出 URL 的 fragment 中，并向浏览器返回 session 内 opaque Run ID。浏览器 DTO 不含
Provider profile、补充 alias、私有 sign-off sidecar 或真实 Run ID；adjudicator 只看到 `Reviewer A`、
`Reviewer B` 等匿名标签。服务在返回与接受内容时都会重新扫描 Provider identity marker。它不是 Electron
桌面壳，也不会把数据上传到远端服务。

Manifest derivation、capture、blind preparation、review、check 与 report 默认完全离线：不需要模型
Provider 凭据，不会调用模型 Provider，也不产生模型 API 费用。`eval:manifest` 从冻结的 runtime-attested
requested/completed 事件派生 profile/settings，要求显式 case/request/run 并拒绝 credential-like 参数；默认生成
provider-only `best_effort`。只有当 execution/report/project/PNG 四个宿主参数完整提供时，它才从精确终态
attestation 派生 runtime-attested host manifest，并在写入前核对文件哈希与 PNG 尺寸。Snapshot 命令仅访问本机 OperatingLine Runtime；其 access token
通过命名环境变量传入且不写入 snapshot。只有在采集链上游选择生成一份新的真实 Provider 输出时，才由
那个可选 Provider 的调用路径承担凭据、网络传输与费用边界。`host_execution_with_manual_artifacts` 所需 Blender 渲染在
本机执行，仅消耗本地计算资源。

`host_execution_with_manual_artifacts` 只把已验证的 terminal host event 与人工提供的工程/PNG 一起保存。
该降级路径不使用终态文件哈希，因此它们没有运行时来源绑定：PNG 可以出现在本地盲审
界面，并由 blind sign-off 绑定内容哈希，但作为 `manual_review_image` 不允许携带 `visualEnvironment`，
不能满足 `released` artifact criterion。工程 `host_project` 与 PNG metadata 都标记
`manual_artifact_not_runtime_bound`。Artifact provenance 与 Provider treatment provenance 是独立维度：
同一 manual-artifact capture 可使用完整 runtime-attested treatment，也可降级为 operator-attested
profile/settings。只有后一种 treatment 降级强制 Run 为 `not_reproducible`；前一种仍不能把人工 artifact
升级成 released visual evidence，也不能单独形成发布级 comparison。

Opt-in Provider 现在可在 requested/completed 事件中写入规范化 profile/settings、treatment hash、request
fingerprint、packet hash 与严格 draft hash。Blender `1.5.0` 终态可保存工程副本并绑定 `.blend`/PNG hash、
尺寸和渲染环境。`eval:manifest` 可离线生成精确的 runtime-attested provider-only 输入，也可在四个宿主
参数完整提供时从精确终态证明派生 runtime-attested artifact 输入；Capture 仍只有在
manifest 与这些事件逐字段一致时才保存 runtime attestation；released
校验还会从冻结 Eval export 重新核对同一终态报告及两个实际 artifact 字节。见
[ADR 0036](../adr/0036-runtime-attested-eval-evidence.md)。这仍不替代真实调用、双人盲审、数据审核或授权。

Capture、blind、review 写入通过数据集根目录 `.human-eval-write.lock/` 中的唯一 UUID ticket 串行化，
并以同目录原子、禁止覆盖的文件提交保护历史。Stale ticket 只能通过
`pnpm eval:recover-lock --dataset <directory>` 恢复；该命令要求 ticket 属于当前用户、记录完整且 PID 已
不存在，活进程/权限不足/畸形 ticket 一律拒绝。唯一 ticket 路径不会被新 writer 复用。`repo://`
reference artifact 的验证必须通过 `--repo-root` 显式绑定
仓库根目录。操作步骤和审计清单见
[Human Eval 本地采集与盲审指南](../guides/human-eval-collection.md)。

`HumanEvalAnnotation` 绑定精确 Run 与 rubric 哈希，reviewer 只以 pseudonym 和校准信息出现，且
`providerIdentityVisible` 固定为 `false`。每个适用 criterion 都保留原始判断、理由和证据；更正通过
supersession 新增记录。`HumanEvalAdjudication` 通过 annotation ID 与内容哈希引用同一 Run 上至少两名
独立 reviewer 的当前记录。`HumanEvalComparisonReport` 按 condition 并列 Run，报告
missing/incomplete/disagreement/adjudicated，保存源记录哈希和自身 integrity，不做数值评分、胜率或
Provider 排名；published audience 自动排除 synthetic test fixture，并拒绝仅做结构校验、未读取实际
artifact 的数据集。

内部 workspace package `@operatingline/eval-kit` 负责 Schema、跨记录引用、精确 catalog/base Plan、
内容/artifact 哈希、安全路径/大小边界、冻结 Eval-export page chain、Provider request/outcome 与宿主事件
关联、annotation supersession、adjudication 和 released readiness 验证，并由 `pnpm eval:check` /
`pnpm eval:report` 提供
目录级入口。首个 `blender.core_planning@1.0.0` suite 有 7 个 collecting 案例、6 条 lineage，覆盖常规
initial plan、adversarial 能力边界和 local replan；当前有 0 个 Run、0 个 blind sign-off、0 个人工
annotation 和 0 个 adjudication，因此所有案例都必须报告 missing live Run，不能形成 Provider 结论。

Released readiness 以 case-level stage coverage 约束证据，而不删除失败 treatment：可判断的执行结论
必须绑定精确 Plan revision/实例/host build 的成功或 error 终态，可判断的视觉结论必须绑定实际读取的
host project 与 rendered image；Provider failed、`needs_revision` 或缺少下游证据的 Run 继续以
`unable_to_judge` 出现在对照中。

Suite、Run、annotation 和 adjudication 均固定 `trainingUse: not_authorized`。本地 Eval、研究许可或
reviewed public release 不能解释为训练授权；Eval export 的未脱敏内容也不会因被 Run 引用而自动完成
数据审核。完整决策见 [ADR 0018](../adr/0018-versioned-human-eval-evidence.md)。

## 宿主执行记录与补偿

Companion 应按步骤 ID 保存 action receipt，不能把 action 名当作唯一键；一个计划可以在多个
步骤复用同一种通用 action。receipt 可以包含多个新建宿主资源、对既有自有资源的 mutation、
文件产物和用于视觉定位的锚点。Blender revision 6 实现使用 pointer、不可预测 receipt token
和 logical ID 的组合身份，并额外核对步骤 ID 与 action 名；名称只用于显示和冲突预检，不构成
删除授权。

多资源动作应先验证整批参数、名称、逻辑 ID 和依赖资源，再开始写入。宿主 API 在预检后仍可能
失败，因此执行器还必须记录已产生的副作用并进行失败补偿。mutation 回退采用
compare-and-restore：只有当前值仍等于该动作写入的值时才恢复旧值；检测到外部修改时显式拒绝，
避免静默覆盖用户或其他工具的后续操作。

这是 Blender Companion 当前的补偿实现，不是所有宿主已经具备的通用能力。其他适配器必须在
能力画像中分别声明批量预检、精确身份、失败补偿和冲突检测的支持等级。

当前 HTTP transport 与升级边界见 [ADR 0003](../adr/0003-loopback-companion-polling.md)，
提案审批决策见 [ADR 0004](../adr/0004-human-approved-guide-proposals.md)。
目录与规划上下文决策见
[ADR 0005](../adr/0005-versioned-action-catalog-planning-context.md)。
跨目标规划阶段画像与确定性质量门见
[ADR 0011](../adr/0011-cross-target-planning-quality-gate.md)。
供应商无关 Planner Packet 见
[ADR 0012](../adr/0012-provider-neutral-planner-packets.md)。
显式 Planner Provider 边界见
[ADR 0013](../adr/0013-explicit-planner-provider-boundary.md)。
OpenAI Responses Provider 与 opt-in composition root 见
[ADR 0014](../adr/0014-openai-responses-planner-provider.md)。
目录约束的目标需求覆盖证据见
[ADR 0017](../adr/0017-catalog-grounded-goal-coverage.md)。
类型化 Provider 节点局部重规划见
[ADR 0015](../adr/0015-typed-provider-local-replanning.md)。
宿主授权的异步 Replan Run 见
[ADR 0016](../adr/0016-host-mediated-asynchronous-replan-runs.md)。
宿主授权的异步 Initial Plan Run 见
[ADR 0021](../adr/0021-host-authorized-asynchronous-initial-plan-runs.md)。
流式模型对话与授权内语义重规划见
[ADR 0035](../adr/0035-streamed-dialogue-and-semantic-replanning.md)。
本机 CLI Planner、现代 MCP 协商与 MCPB 签名边界见
[ADR 0023](../adr/0023-local-cli-planners-and-modern-mcp.md)。
节点引用与重规划决策见
[ADR 0006](../adr/0006-immutable-node-revision-requests.md)。
Eval/replay 导出决策见
[ADR 0007](../adr/0007-versioned-eval-evidence-export.md)。
版本化人工 Eval 与无分数 Provider 对照见
[ADR 0018](../adr/0018-versioned-human-eval-evidence.md)；本地采集、provider-blind sidecar 与回环浏览器
评审见 [ADR 0019](../adr/0019-local-human-eval-capture-and-blind-review.md)。
线性 thread 与 Plan diff 见
[ADR 0009](../adr/0009-linear-revision-threads-and-plan-diffs.md)；修订历史见
[ADR 0010](../adr/0010-paginated-revision-history.md)。

## 新宿主适配流程

1. 盘点官方插件 API、线程模型、命令目录、对象身份、观察和 undo/checkpoint。
2. 填写能力画像，明确 `native`、`emulated`、`unsupported`。
3. 实现稳定 action catalog；不暴露任意代码执行或任意文件路径。
4. 实现语义锚点解析与失败停止行为。
5. 运行通用 contract tests，再添加宿主 integration/e2e tests。
6. 只有公共 API 无法满足核心能力时，才向上游项目提出最小 API PR。

如果宿主已经有 MCP 或其他命令 transport，Companion 可以通过外部 `bridge/` 与其并存。
Bridge 必须把上游的宽泛能力收窄为允许列表命令，且不得将上游任意代码执行
宣称为 OperatingLine 的安全边界。

适配器起始约束见 [`adapters/README.md`](../../adapters/README.md)。
