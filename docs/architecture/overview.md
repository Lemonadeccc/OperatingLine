# 通用宿主架构

## 不变量

OperatingLine 的通用部分只定义意图、计划、状态和证据。宿主 Companion 负责把语义动作与
锚点翻译成 Blender Operator、VS Code Command、GIMP Procedure 等实际能力。
无界面 Orchestrator 是架构中唯一的计划与调度服务；当前实现已经完成协议验证、受信任计划发布、
AI 提案与逐 Companion 人工决策、经鉴权的回环 Companion 拉取、幂等状态回传、
事件/最新快照持久化、能力描述、版本化 ActionCatalog 注册表、PlanningContext 和 Eval/replay
证据导出。MCP 客户端、CLI、Web 界面或其他第三方工具都是可替换的协议消费者，不承担宿主内
视觉呈现。

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
  └─ declared safety and host-version boundaries

PlanningQualityReport
  ├─ baselineVersion + exact catalog reference
  ├─ deterministic errors/warnings + phase coverage
  ├─ resource dependency + visible-guidance findings
  └─ no semantic or aesthetic score

PlanningPromptPacket
  ├─ exact PlanningContext + catalog version
  ├─ strict GuideProposal draft JSON Schema
  ├─ deterministic planning workflow instructions
  └─ MCP Prompt / Tool / HTTP delivery, no embedded model

PlannerProvider
  ├─ explicitly injected in-process plugin + public descriptor
  ├─ receives one exact PlanningPromptPacket + AbortSignal
  ├─ returns an untrusted PlanningProposalDraft
  └─ strict validation + quality evidence, never auto-proposes

GuideRevisionRequest
  ├─ requestId + adapterId + instanceId + catalogVersion
  ├─ complete immutable base Plan
  ├─ stable nodeId + user-visible nodeNumber references
  └─ user-authored revision message

GuideRevisionThreadHistory
  ├─ thread + adapter + instance scope
  ├─ exact request + proposal + diff + decision per turn
  ├─ derived review state
  └─ newest page + beforeTurn cursor

EvalExportBundle
  ├─ adapter + Plan + optional instance scope
  ├─ exact catalogs + related immutable events
  ├─ stable sequence cursor + aggregate counts
  └─ canonical content SHA-256 + raw-data warning
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
`adapterId + instanceId` 标识实例，使用成对的 `knownPlanId + knownRevision` 拉取更新，并以
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
GuidePlan，再调用 `operatingline.planning.evaluate`。版本化 `1.0.0` 质量门确定性检查根阶段树、
阶段顺序、资源创建与依赖、语义锚点和预期观察；`operatingline.guide.propose` 会用相同 planning
intent 重跑质量门，有 error 时不会持久化 Proposal。每次检查会追加
`planning.quality.evaluated` 事件用于 replay/Eval。

Planner Packet `1.0.0` 把完整上下文、严格 Proposal 草案 JSON Schema 和相同工作流规则作为一个
确定性协议对象；同一构建器为 MCP Prompt 提供渲染文本，并让 MCP Tool/HTTP 返回完整 packet。
`planning.prompt.generated` 进入同一证据链。Prompt 是用户控制入口，Tool 是模型控制入口，两者都由
客户端选择模型和发送授权。这三条 provider-neutral packet 入口和默认 standalone 不调用模型、不读取
供应商密钥，也不依赖从 2026-07-28 起已弃用的 MCP Sampling；只有独立 opt-in composition root 会把
显式配置的 provider 注入同一核心 runtime。

Orchestrator 不内置模型，也不通过关键词假装理解目标；目标所需阶段由调用方显式声明。质量报告
没有总分，只证明候选 Plan 满足当前目录可表达的结构与资源流约束。它不判断结果是否好看、目标
语义是否完整；通用边界会递归验证目录的机器可执行参数 Schema，Blender Companion 仍负责真实资源
与执行时宿主状态的最终验证。当前雪人与机器人
两个可重放参考证明质量门不再只绑定一个题材，但不能外推为任意自然语言目标已经可靠。详细决策见
[ADR 0011](../adr/0011-cross-target-planning-quality-gate.md)。Planner Packet 的供应商边界见
[ADR 0012](../adr/0012-provider-neutral-planner-packets.md)。

可选 Planner Provider 建立在 packet 之上。只有嵌入 `startRuntime` 的 composition root 显式传入
`plannerProviders`，对应 provider 才会注册；默认 standalone 不读取 provider 配置、凭据或任意模块。
MCP `operatingline.planner.providers.list` 与 HTTP `GET /api/v1/planner/providers` 只返回公开
descriptor，包含可用性、并发限制、执行位置、数据传输和“凭据由 provider 管理”的声明，不包含密钥。
本地执行只能声明不传输，远端执行必须声明 provider-managed 传输，矛盾组合会被协议拒绝。
调用方必须在每次生成时向 MCP `operatingline.planner.generate` 或 HTTP
`POST /api/v1/planner/generate` 明确给出 `providerId` 与 UUID `requestId`；核心没有默认 provider，
也不做自动选择。

```text
explicit caller
    │ providerId + requestId + goal
    ▼
Orchestrator ── exact Planner Packet ──> injected PlannerProvider
    │                                      │ provider-owned credentials/network/cost
    │<──── untrusted PlanningProposalDraft ┘
    ▼
canonical packet copy + strict schema + immutable identity + nested ActionCatalog + quality checks
    │
    └─ PlannerGenerationResult { status, draft, planningQuality, proposalCreated: false }
                                               │ separate explicit call
                                               ▼
                                 operatingline.guide.propose
                                               │
                                               ▼
                                      in-host human approval
```

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
模型只存在于 provider 配置和描述文本，不进入通用 generate wire request。生成不会自动连接 Blender
节点修订、不创建 Proposal，也不证明任意目标的语义规划质量。具体决策见
[ADR 0014](../adr/0014-openai-responses-planner-provider.md)。

Generate 可能把用户目标、Companion 状态和完整 ActionCatalog 传给远端服务并产生费用；公开 descriptor
只做披露，不替调用方作授权决定。核心不把 API Key、endpoint 或模型参数放进 wire schema，也不持久化
provider 原始错误、原始响应或私有推理。它会持久化成功生成的严格草案、质量报告和 requested/completed
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
每个包携带引用到的精确 ActionCatalog、整个 scope 的计数和当前分页事件；`afterSequence` 使用数据库
显式自增序列，跨重启稳定，单页最多 1,000 条。尚未带 Plan reference 的初始 `connected` 状态不会
被猜测归入某个计划。

内容摘要覆盖协议/格式版本、scope、目录、事件页、分页信息、汇总和数据处理声明，不包含随机
`exportId`、`exportedAt` 或摘要自身。相同事实页因而得到相同 SHA-256。当前实现不自动脱敏，也不
计算质量分数；`planning.prompt.generated` 的输入契约、provider 生成的严格草案、
`planning.quality.evaluated` 中的确定性
finding 与 `satisfied: false` observation
都保持原始事实，不会被导出层改写成主观语义评分或执行失败结论。调用方在分享或训练前必须审核
敏感内容。详细决策见
[ADR 0007](../adr/0007-versioned-eval-evidence-export.md)。

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
节点引用与重规划决策见
[ADR 0006](../adr/0006-immutable-node-revision-requests.md)。
Eval/replay 导出决策见
[ADR 0007](../adr/0007-versioned-eval-evidence-export.md)。
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
