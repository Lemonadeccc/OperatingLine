# 通用宿主架构

## 不变量

OperatingLine 的通用部分只定义意图、计划、状态和证据。宿主 Companion 负责把语义动作与
锚点翻译成 Blender Operator、VS Code Command、GIMP Procedure 等实际能力。
无界面 Orchestrator 是架构中唯一的计划与调度服务；当前实现已经完成协议验证、受信任计划发布、
AI 提案与逐 Companion 人工决策、经鉴权的回环 Companion 拉取、幂等状态回传、
事件/最新快照持久化、能力描述、版本化 ActionCatalog 注册表、PlanningContext、类型化 provider
局部重规划和 Eval/replay 证据导出。独立 Human Eval 协议与内部 `@operatingline/eval-kit` 在离线数据集
层验证 Provider Run、盲审 annotation、分歧裁决和无分数 comparison；它们不改变 Orchestrator 的
Proposal 或宿主执行权威。MCP 客户端、CLI、Web 界面或其他第三方工具都是可替换的协议消费者，不承担
宿主内视觉呈现。

```text
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

宿主还可以把活动树或待审树的节点引用提交为不可变 GuideRevisionRequest。Orchestrator 核对完整
base Plan、精确目录版本与每个节点编号，并通过 MCP 暴露待处理请求。外部模型客户端只能返回相同
Plan ID 的完整更高 revision；它不能原地 patch 已审批计划。生成的 Proposal 绑定请求 ID 并按
`targetInstanceId` 只投递给发起实例，仍然经过同一宿主内 Accept/Reject 门禁。协议 `1.1.0` 为请求
增加线性 `revisionThread`；后续 turn 必须引用当前 head，并以父请求关联 Proposal 的完整 Plan 为
精确基线，而且父 Proposal 必须已在同一宿主实例接受。Orchestrator 对 base/target 计算确定性 Plan diff，保留计划字段、节点增删移动、步骤字段
以及 action 参数的 JSON 前后值；宿主只负责验证并呈现，不自行猜测差异。

`operatingline.replan.thread.get` 与 `/api/v1/replan/thread` 从现有请求、Proposal 和决策表派生只读
消息历史，不复制一份可变聊天日志。查询以 thread、adapter 和 instance 隔离，默认返回最新页并用
`beforeTurn` 向前分页；每页仍按 turn 正序阅读。Blender 合并已加载页面，但不会把 Proposal 当作
模型推理或流式聊天内容。

列表接口表示“最新已知状态”，不等同于实时在线证明；当前版本还没有 heartbeat/TTL。
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
GuidePlan，再调用 `operatingline.planning.evaluate`。Blender `1.3.0` 目录还发布七项适配器自有
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

节点局部重规划对当前 Blender `1.3.0` 使用独立的 `ReplanningPromptPacket 1.1.0`；历史目录继续使用
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

能够等待长 Promise 的 MCP/HTTP 客户端继续使用上述分离路径。宿主 Companion 另有版本化异步
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

OpenAI 请求固定 `store: false`、`stream: false` 与 32,768 个输出 token 上限，SDK client 固定
`maxRetries: 0`，并接收协调器的 `AbortSignal`。这使核心的显式重试和 at-most-once request ID 语义
不被 SDK 隐式重试绕过，但取消仍是协作式的。当前 Proposal Schema 的 action arguments 与
observation parameters 是由版本化
ActionCatalog 约束的动态 records，不符合厂商严格 Structured Outputs 支持的 JSON Schema 子集；插件
因此使用 JSON Object mode，只要求厂商返回可解析 JSON。JSON Object mode 不是 OperatingLine 信任
边界：核心仍对未知返回执行权威的严格 draft Schema、packet identity、递归 ActionCatalog 和确定性
质量校验。

该 provider 的公开 descriptor 声明 `executionLocation: remote`、
`dataTransmission: provider_managed` 与 `credentialManagement: provider_managed`。它不公开模型凭据；
模型只存在于 provider 配置和描述文本，不进入通用 generate wire request。该实现用同一清洗后的
Responses JSON 边界支持初始 `generate()` 与局部 `replan()`；两者都不会自动创建 Proposal，也不证明
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
initial plan、adversarial 能力边界和 local replan；当前没有真实 Provider Run、人工 annotation 或
adjudication，因此所有案例都必须报告 missing live Run，不能形成 Provider 结论。

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
文件产物和用于视觉定位的锚点。Blender revision 4 实现使用 pointer、不可预测 receipt token
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
节点引用与重规划决策见
[ADR 0006](../adr/0006-immutable-node-revision-requests.md)。
Eval/replay 导出决策见
[ADR 0007](../adr/0007-versioned-eval-evidence-export.md)。
版本化人工 Eval 与无分数 Provider 对照见
[ADR 0018](../adr/0018-versioned-human-eval-evidence.md)。
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
