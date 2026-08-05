# OperatingLine

[![CI](https://github.com/Lemonadeccc/OperatingLine/actions/workflows/ci.yml/badge.svg)](https://github.com/Lemonadeccc/OperatingLine/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> 当前阶段：`0.1.0` 垂直切片。Blender 内引导与本地 Orchestrator ↔ Companion
> 计划投递/状态回传闭环已可运行；AI/MCP 客户端还可以提交待审 GuideProposal，由用户在
> Blender 内预览任务树并明确接受或拒绝。用户还可从活动树或待审树引用节点、提交不可变修订
> 请求，再由外部 MCP 客户端返回只投递给该 Blender 实例的完整新版 Proposal。内置计划可完成并
> 回退一张确定性的雪人渲染预览。
> Orchestrator 现在可以查询 Blender `1.2.0` ActionCatalog 和 PlanningContext，并导出带稳定游标
> 与内容哈希的 Eval/replay 原始证据。修订请求现在支持持久化线性多轮 thread；每个返回提案都带
> 精确 Plan diff，并在 Blender 内显示节点与简单参数前后值。结构化修订消息历史现在可分页回放，
> Blender 可展开或继续加载更早轮次。跨目标规划现在还有版本化阶段画像、确定性质量门和一个在
> Blender 4.5/5.1 中真实执行的机器人基准。版本化 Planner Packet 还能通过 MCP Prompt、Tool 或
> HTTP 把同一份上下文、严格输出 Schema 和 evaluate→propose 工作流交给客户端自己的模型；运行时
> 也可显式注入进程内 Planner Provider，生成经严格验证但尚未提交的初始草案。节点修订现在还有独立
> `ReplanningPromptPacket 1.0.0`、引用子树 locality 门禁和可选 provider `replan()`；MCP 客户端仍以
> 两个显式步骤完成 generate 与 propose。Blender 用户现在也可在 Runtime 确认请求后，明确选择一个
> 已注册 Provider、查看数据传输/可能费用披露，并逐次确认异步 Replan Run；Runtime 只在 canonical
> 结果 ready 时创建待审 Proposal，之后仍必须在 Blender Accept/Reject。仓库提供一个同时支持初始/局部规划的可选 OpenAI Responses Provider 和
> 独立 opt-in composition root；默认 standalone 仍不加载厂商 SDK 或凭据。Blender 内已有可折叠的
> Revision Workspace，用于结构化节点引用、Provider handoff、Run 状态、历史、diff 和提案审批；流式模型对话、任意目标语义
> 数据集、自动评分/训练治理、骨骼动画深化和第二宿主仍在路线图中。

OperatingLine 是一套面向 AI/MCP 软件操作的可观察引导协议与宿主适配框架。

## 问题与价值

当 AI 通过 MCP 操作 Blender 等复杂软件时，用户往往只看到最终结果：不知道 AI 当前在做什么、
为什么这样做、操作了哪个对象，也难以定位需要修改的步骤。

OperatingLine 把高层目标拆成可引用的任务树，再把可执行叶子节点绑定到语义动作、
宿主内锚点、完成验证和回退策略。用户可以看到当前步骤，按顺序前进或回退，并用
`1.2.1` 这样的编号精确引用某个节点。

OperatingLine 不在目标软件外叠加透明窗口。任务树、引导线和操作控件由每个宿主的原生
Companion/Extension 在软件内呈现；无界面 Orchestrator 负责协议验证、计划发布或提案、
本地 Companion 投递、人工决策、状态查询、事件记录和能力描述。

## 真实可运行能力

- **Headless Orchestrator**：提供经鉴权的 MCP/HTTP 接口，可验证和直接发布 GuidePlan，也可
  持久化 AI GuideProposal、按宿主实例投递并记录幂等的接受/拒绝决策；同时查询最新执行状态，
  把追加式事件与每个实例的最新快照写入本地数据库。
- **版本化协议**：定义 GuidePlan、GuideProposal/Decision、树/DAG、语义锚点、动作绑定和能力画像，并生成
  JSON Schema 与跨语言 fixture。
- **ActionCatalog 与 PlanningContext**：MCP 客户端可以查询目标宿主真实允许的动作版本、参数
  Schema、资源读写、观察、回退、安全边界、最新 Companion 状态和下一 Plan revision；未知动作、
  未知或不符合嵌套 Schema 的参数、未声明 anchor/observation/rollback 会在 AI Proposal 边界失败。
- **跨目标规划质量门**：Blender catalog `1.2.0` 把 10 个动作划分为 Geometry、Materials、
  Animation、Render setup 与 Output。`operatingline.planning.evaluate` 对候选完整 Plan 检查阶段树、
  阶段顺序、目标所需阶段、资源创建/依赖、语义锚点和观察；Proposal 会再次执行同一确定性门禁。
  报告只有可追溯的 error/warning，不虚构主观分数。
- **供应商无关 Planner Packet**：`operatingline.plan_and_propose` MCP Prompt、
  `operatingline.planning.prompt.get` Tool 与 `POST /api/v1/planning/prompt` 复用同一版本化 packet
  构建器；Prompt 呈现其中的 `renderedPrompt`，Tool/HTTP 返回完整 packet。它内含精确
  PlanningContext、严格 GuideProposal 草案 JSON Schema 和 evaluate→propose 规则。客户端
  选择自己的模型和发送授权；Orchestrator 不读取模型 API Key，也不使用已弃用的 MCP Sampling。
- **显式 Planner Provider 边界**：嵌入 Orchestrator 的调用方可通过
  `@operatingline/planner-provider-sdk` 注入一个或多个进程内 provider，再由
  `operatingline.planner.providers.list` 与 `operatingline.planner.generate` 显式选择并调用。
  Provider 自己管理凭据和外部请求；generate 可能传输目标、宿主状态与目录并产生费用。返回值会
  经过严格 Schema、identity、ActionCatalog 和规划质量校验，但始终带 `proposalCreated: false`；
  调用方仍须另行调用 `operatingline.guide.propose`，并由宿主内用户接受后才可执行。
- **可选 OpenAI Responses Provider**：`@operatingline/openai-planner-provider` 使用官方 OpenAI
  JavaScript/TypeScript SDK 的 Responses API。调用方必须显式提供模型和凭据；请求固定
  `store: false`、最多 32,768 个输出 token、SDK `maxRetries: 0`，并把核心的 `AbortSignal` 传给
  SDK。Provider 的 `generate()` 和 `replan()` 分别消费初始与局部 packet。当前 packet 的动态
  action arguments 与 observation parameters 不符合厂商严格 Structured Outputs 子集，因此插件使用
  JSON Object mode，返回值仍由 OperatingLine 核心执行权威的严格 Schema、identity、catalog 和质量
  校验。独立的 `services/openai-runtime` 只在 `pnpm dev:openai` 时装配该远端 provider；公开
  descriptor 明确声明数据传输与凭据均由 provider 管理。
- **节点引用与请求关联重规划**：Blender 的活动树和待审树都提供 `Ref`；Revision request 绑定
  完整 base Plan、稳定节点 ID、显示编号、目录版本与消息。MCP 客户端读取待处理请求并提交完整的
  更高 Plan revision；接受后继续引用会继承同一线性 revision thread。每个请求关联 Proposal
  携带精确的 Plan/节点/字段/参数差异，结果只回到发起实例，仍需用户接受，任何中间阶段都不修改场景。
- **Blender Revision Workspace**：原生 Sidebar 中的可折叠工作区把当前基线、最多 8 个结构化
  节点引用、独立修订正文、Provider handoff、异步 Run 状态、线性历史、Plan diff 和 Accept/Reject
  放在同一个操作日志中。
  引用可逐条移除，重复引用会去重，切换到不同基线前必须显式清空草稿；`Hide Guidance`
  只隐藏视口线、数字、状态和任务树，不删除工作区、草稿、Run、历史或场景。Provider 默认不选择，
  也不会自动调用。
- **类型化 Provider 局部重规划**：`ReplanningPromptPacket 1.0.0` 绑定 pending immutable request、
  精确目录、实例状态、完整 base Plan 和 `referenced_subtrees_v1` scope。MCP/HTTP 提供独立的
  replan provider list、prompt、generate 与 propose 入口；初始/局部生成共享并发、超时、取消和持久
  request ID 管理。`generate` 会严格检查 identity、目录、规划质量、Plan diff 与局部性，但固定
  `proposalCreated: false`。要把 provider 草案送审，`replan.propose` 必须携带 canonical
  `generationRequestId` 且逐字段匹配草案，才会原子记录 Proposal/request/provenance；随后仍须宿主用户
  接受。既有 provider-free 完整 Plan 提交路径继续兼容。
- **宿主授权的异步 Replan Run**：Blender 只在 revision request 已由 Runtime acknowledgement 后开放
  可选 Provider handoff。公开 descriptor 不含凭据，界面不自动选择 Provider；远端调用前明确说明会
  发送修订消息、完整 base Plan/引用、ActionCatalog 和最新 Companion 状态，并提示可能产生费用。
  每次 `Confirm Provider Run` 或 Retry 的 `Confirm New Provider Run` 都通过 Blender 原生确认 dialog 取得一次性授权和新的 generation
  UUID。`POST /api/v1/companion/replan-run` 快速返回 `202`，Orchestrator 后台复用现有严格 generate 与
  canonical propose，Blender 继续用短请求轮询 `queued`、`generating`、`needs_revision`、
  `proposal_created`、`failed` 或 `interrupted`。同一宿主实例只允许一个非终态 Run。所有 Proposal
  writer 还会原子争用一个待决槽；并发外部 Proposal 最多使 Run 安全失败，不会隐藏旧提案。
  Runtime 重启会从可信 completed/proposed
  证据恢复状态或只补完 canonical propose，不会静默重做可能已计费的 Provider 调用。Run 和 Proposal
  preview 均不改场景或 active Session。Accept 只替换空闲 Session，`Next` 才执行第一次场景修改。
  Run 活动期间可继续查看和执行已接受计划，但新的修订提交、Provider 刷新和并发 Proposal 决策会暂时
  禁用；精确 Run ID 不会被普通 Plan/Proposal 投递或晚到 ACK 清除。Proposal 与 terminal status 即使
  乱序到达，也只按 `(revisionRequestId, proposalId)` 绑定；Accept 前还会核对当前 Plan 仍等于 diff base。
  旧版 request-linked Proposal 若没有可验证的 diff base，只能只读查看或 Reject，不能直接 Accept。
  默认 standalone 的 Provider 列表为空，外部 MCP 路径仍可用。
- **修订消息历史**：`operatingline.replan.thread.get` 与对应 HTTP 接口从规范化持久化记录还原每轮
  用户请求、完整 Proposal、Plan diff 和同实例人工决策。默认读取最新页，使用 `beforeTurn` 向前
  分页；Blender Sidebar 可查看最近三轮、展开已加载轮次并继续加载更早内容。
- **Eval/replay 证据导出**：MCP 或 HTTP 客户端可按 adapter、Plan 和可选 Companion 实例分页导出
  用户目标、精确 ActionCatalog、完整 Proposal、人工决定、逐步 observation 与 rollback。Bundle
  自带稳定事件 sequence、内容 SHA-256 和未脱敏警告，但不会把遥测虚构成质量评分。
- **Blender Extension**：在 3D View Sidebar 显示任务树，支持展开/折叠、Start/Next/Back 和
  Show/Hide Guidance；已完成节点为蓝色、Back 目标为红色、Next 目标为绿色、后续节点为灰色。
  视口同时显示最多四个全局序号、带深色描边的红/绿引导线与箭头；可显式连接回环地址上的
  Orchestrator，非阻塞拉取新计划或提案并回传步骤结果。提案会显示独立的只读任务树、
  `Accept Plan` 与 `Reject Plan`；接受前 Start/Next 不可执行，且场景与活动计划不会改变。
- **完整雪人预览垂直切片**：内置 revision 4 计划包含 7 个阶段、15 个可执行步骤，依次完成
  地面、三段身体、脸部、纽扣、手臂、材质、头部组件与手臂的四骨骼刚性绑定、三段姿态关键帧、
  隔离渲染场景、双 Area Light、相机和帧 20 的 320 × 320 Eevee PNG；`Back` 可以逐步反向补偿
  整条执行链。
- **Blender MCP Bridge**：可以不修改已安装的 Blender MCP 扩展，仅通过允许列表命令
  触发 OperatingLine 控件。

Blender Extension 已在 Blender 4.5.3 LTS 和 5.1.1 中通过无界面集成测试。

![OperatingLine 在 Blender 内的彩色任务树、前进回退按钮、步骤序号与雪人引导线](docs/assets/blender-guidance.png)

> [!IMPORTANT]
> 当前完成的是内置 GuidePlan 驱动的确定性雪人预览，以及“外部 AI 生成计划 → Blender 内
> 预览 → 人工接受/拒绝”的通用审批基础，不是“AI 已能自动完成任意 Blender 任务”。
> OperatingLine 不内置或绑定某一家模型。Codex、Claude 等客户端现在可以先选择
> `operatingline.plan_and_propose` Prompt 或调用 `operatingline.planning.prompt.get` Tool 取得统一规划
> packet；也可继续直接调用 `operatingline.planning.context`。客户端依据阶段画像生成候选计划，再调用
> `operatingline.planning.evaluate` 后提交 GuideProposal。当前 Blender 目录仍只覆盖 10 个已验证动作，
> 阶段选择仍由外部模型或显式注入的 provider 根据目标声明，因此这不等于已经内置“任意任务自动
> 拆解”。默认 standalone 启动路径不加载 provider、凭据或任意模块；可选 OpenAI composition root
> 必须由操作者显式启动并提供模型与 API Key。进程内插件与 Orchestrator 共享进程，不构成强安全
> 隔离。当前修订输入不是流式聊天；已经支持 Blender 原生 Revision Workspace、可追溯的多轮线性
> thread、Plan diff、结构化历史、显式 provider-backed local replan，以及宿主内逐次授权的异步
> Replan Run，但尚未提供流式助手回复、provider 自动选择/调用、自动语义
> 重规划、用户可编辑参数表单、显式分支/合并或实时模型对话。Locality 与结构质量门只证明机器约束，
> 不证明模型理解了任意修改意图。更大的人工 Eval、自动评分/训练治理、骨骼动画深化和第二宿主也尚未完成。
> 未连接 Orchestrator 时，Extension 继续使用打包内的雪人 fixture；Bridge 仍只是受限控件
> 调用的过渡方案，不参与新的专用 Companion 同步链路。

实现状态与后续验收条件统一记录在[项目路线图](docs/roadmap.md)；因当前运行表面能力不足而待补的
正式 OMX 双通道审查记录在[审查待办](docs/quality/omx-code-review.md)。

## 工作原理

```text
Codex / Claude / another MCP client
                 │ MCP
                 ▼
services/orchestrator
目录/规划上下文 · 计划验证 · 修订请求 · 异步 Replan Run · Proposal 审批 · Companion 投递 · 状态/事件 · Eval 导出
                 │ authenticated loopback HTTP
                 │ plan/proposal pull · decision/state report
        ┌────────┴─────────┐
        ▼                  ▼
adapters/blender      adapters/<host>
native extension      native companion
        │                  │
        ▼                  ▼
     Blender          another application
```

`protocol/` 是跨语言交换格式，`packages/protocol` 是 TypeScript 绑定与 Schema 生成器。
任务树的 `parentId + order` 负责展示和编号，`dependsOn` 形成实际执行 DAG。每个叶子节点
可包含动作名、经校验的参数、语义锚点、预期观察和回退方式。

Blender 当前允许 10 类通用 action：创建平面、创建 UV 球、批量创建基础体、创建并分配单个
材质、创建并分配材质组、创建并刚性绑定骨架、创建姿态关键帧、创建隔离渲染场景、创建灯光
相机组，以及生成受限临时目录中的指定帧渲染预览。动作注册表按步骤 ID 绑定执行器；同一种
action 可以安全地出现在多个步骤中。

这些动作的规范描述位于 `adapters/blender/catalog/v1/action-catalog.json`。目录版本与协议版本
分别演进；Orchestrator composition root 安装真实目录，而不是在通用规划代码中复制 Blender
私有知识。完整决策见
[ADR 0005](docs/adr/0005-versioned-action-catalog-planning-context.md)。
节点引用、实例定向投递和不可变重规划见
[ADR 0006](docs/adr/0006-immutable-node-revision-requests.md)。
稳定事件序列与版本化 Eval 证据包见
[ADR 0007](docs/adr/0007-versioned-eval-evidence-export.md)。
刚性骨架与姿态关键帧的安全边界见
[ADR 0008](docs/adr/0008-bounded-rigid-rig-animation.md)。
多轮 revision thread 与确定性 Plan diff 见
[ADR 0009](docs/adr/0009-linear-revision-threads-and-plan-diffs.md)。
可分页修订消息历史与同实例接受门禁见
[ADR 0010](docs/adr/0010-paginated-revision-history.md)。
跨目标阶段画像与确定性质量门见
[ADR 0011](docs/adr/0011-cross-target-planning-quality-gate.md)。
供应商无关 Planner Packet 与 MCP Prompt 见
[ADR 0012](docs/adr/0012-provider-neutral-planner-packets.md)。
显式 Planner Provider 的进程内插件、安全与重试边界见
[ADR 0013](docs/adr/0013-explicit-planner-provider-boundary.md)。
首个具体插件的 OpenAI Responses 调用与数据边界见
[ADR 0014](docs/adr/0014-openai-responses-planner-provider.md)。
类型化 Provider 节点局部重规划、canonical propose 与 provenance 见
[ADR 0015](docs/adr/0015-typed-provider-local-replanning.md)。
宿主逐次授权、异步 Run、重启/重试与场景不变量见
[ADR 0016](docs/adr/0016-host-mediated-asynchronous-replan-runs.md)。

每个步骤的 action receipt 可以记录多个新建 datablock、对既有自有资源的 mutation 和文件
产物。资源身份同时校验 Blender pointer、不可预测 receipt token 和计划内 logical ID，避免
仅凭名称或可复制属性删除对象。复合动作先检查整批名称与逻辑 ID 冲突；执行中途失败会补偿
已经产生的部分结果。回退 mutation 前还会比较当前值与动作完成后的记录值，发现用户或其他
工具已经修改时拒绝覆盖。若自有 Mesh、Material 或 Collection 已被外部对象引用，`Back` 会在
零写入预检阶段停止并保留步骤收据；解除外部引用后可以重试，不会静默留下失管资源。

自动动作只允许绑定在结构叶子上，并且只能依赖其他自动动作；Companion 必须按
`dependsOn` 的拓扑顺序执行，`order` 只作为同时可执行节点的稳定排序条件。没有 action 的
叶子保留给说明、人工确认或未来规划，不会被当前自动执行器悄悄视为已完成。
步骤 ID 使用协议限定的可移植 ASCII 格式，保证 TypeScript、Python 和未来其他适配器的
并列步骤排序一致。

Companion protocol v1 的一个 GuidePlan 内，所有非空 action 必须使用同一个 `adapterId`。
当前 Orchestrator 会在发布阶段显式拒绝混合宿主计划，而不会把必然无法安装的完整计划投递给
某一个宿主。跨宿主计划需要另外设计保持树、依赖、编号和 revision 语义的投影/调度协议；
纯 actionless 计划因缺少宿主路由信息，当前只可发布和查询，不会由 Companion 接口投递。

Companion 负责把这些通用定义翻译成宿主的 Operator、Command 或 Procedure，并在宿主内
解析对象、世界坐标或自有控件等稳定锚点。持久协议不使用易受窗口、DPI 和布局变化影响的
固定像素坐标。

Blender Companion 的网络线程只交换 HTTP/JSON，并把新计划或提案放入队列；`bpy.app.timers`
在 Blender 主线程校验提案、建立只读预览、安装已接受计划、执行动作和更新 UI。状态报告通过
`reportId + sequence` 实现
精确重试、乱序拒绝和最新快照恢复。计划投递本身不会删除已经创建的场景对象：运行中收到
新 revision 时会暂存更新，等用户 Back 到起点后再安装。

## 5 分钟快速开始

前置要求：Node.js 24、Corepack、pnpm，以及 Blender 4.5+。

```bash
git clone https://github.com/Lemonadeccc/OperatingLine.git
cd OperatingLine
corepack enable
pnpm install
pnpm package:blender
```

如果 Blender 不在平台默认路径，显式指定可执行文件：

```bash
BLENDER_BIN=/absolute/path/to/blender pnpm package:blender
```

打包产物为 `artifacts/blender/operating_line-0.1.0.zip`。在 Blender 中选择
`Edit → Preferences → Extensions → Install from Disk`，安装并启用该 ZIP。

这条快速开始可以直接运行 Blender Extension 内置雪人计划，不需要先启动 Orchestrator。

### 连接实时 Orchestrator

使用固定回环端口启动 Orchestrator；Token 至少 16 个字符，并应由当前用户自行生成：

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-secret-token'
export OPERATINGLINE_PORT=43123
pnpm dev
```

然后在 Blender 的 `OperatingLine` Sidebar 中：

1. 确认 `Edit → Preferences → System → Network → Allow Online Access` 已开启。
2. `Runtime URL` 填写 `http://127.0.0.1:43123`。
3. `Bearer token` 填写同一个 Token；该字段使用 `SKIP_SAVE`，不会写入 `.blend`。
4. 点击 `Connect`。连接成功后，Extension 会保留当前离线计划，并只拉取 ID/revision 更新的计划。
5. 把 Codex、Claude 或其他 MCP Client 连接到 `http://127.0.0.1:43123/mcp`。AI 生成的计划
   可由用户选择 `operatingline.plan_and_propose` MCP Prompt，或让模型调用
   `operatingline.planning.prompt.get`，传入目标宿主、自然语言 `goal` 和稳定 `planId`；没有这些
   客户端能力时仍可直接调用 `operatingline.planning.context`。根据返回的精确 catalog、
   `planningPhases`、`recommendedRevision` 和响应 Schema 构造完整 GuideProposal 草案。然后调用
   `operatingline.planning.evaluate`，传入目标、候选 Plan 和模型从目标中选择的
   `requiredPhaseIds`；解决全部 error 后再调用 `operatingline.guide.propose`，并把同一
   `{ goal, requiredPhaseIds }` 放入可选 `planning` 字段。Blender 内会出现待审树，
   用户点击 `Accept Plan` 后它才成为活动计划。`operatingline.guide.publish` 保留为受信任调用方
   直接发布确定性计划的兼容路径，不经过人工审批。
   如果嵌入方已经显式注入 Planner Provider，可先调用 `operatingline.planner.providers.list` 查看
   可用性、数据传输和凭据管理声明，再用一个新的 UUID `requestId` 调用
   `operatingline.planner.generate`。该调用可能向 provider 传输 packet 并产生费用；返回的
   `draft` 即使状态为 `ready`，也只是未信任生成物经过确定性校验后的候选，
   `proposalCreated` 固定为 `false`。调用方必须检查 `planningQuality`，再自行调用
   `operatingline.guide.propose`。错误对象的 `retryMode` 会明确要求复用原 ID、换新 ID 或不要重试；
   provider 已开始后的失败、超时或进程中断不会自动重试，显式重试需使用新的 UUID。默认 `pnpm dev`
   standalone 没有配置 provider，因此列表为空且不会调用模型。
6. 若要修改某个局部节点，在活动树或待审树点击 `Ref`，在 `Revision request` 中描述变化并发送。
   MCP 客户端先调用 `operatingline.replan.requests.list` 读取 pending request。Provider-free 客户端可用
   `operatingline.replan.prompt.get` 取得独立的类型化 packet，自行生成完整更高 revision，再直接调用
   `operatingline.replan.propose`。显式 provider 路径先调用 `operatingline.replan.providers.list` 检查
   数据传输声明，再用一个不同于宿主 revision request ID 的新 UUID 调用
   `operatingline.replan.generate`，传入 `{ requestId, revisionRequestId, providerId }`。该调用可能传输数据
   并产生费用，但固定 `proposalCreated: false`；只有 `status: ready`、`planningQuality.valid` 与
   `locality.valid` 都成立时，才能把 canonical `draft` 原样提交给 `operatingline.replan.propose`，并额外
   携带 `generationRequestId: <generate requestId>`。任何草案编辑或过期 revision 都会失败。
   `replan.propose` 只创建发起实例的待审 Proposal；Blender 会显示 Plan/节点/参数差异，不会直接执行。
   用户 Accept 后只安装计划，仍由后续 `Start`/`Next` 显式执行。只有接受后再次提交引用才会成为同一
   thread 的下一轮。调用
   `operatingline.replan.thread.get` 并传入 `{ threadId, targetAdapterId, instanceId, beforeTurn?, limit? }`
   可分页读取完整结构化历史。
   也可以完全留在 Blender Revision Workspace：请求显示为 Runtime acknowledged 后，选择一个明确的
   Provider，阅读 local/remote 数据处理、发送范围和可能费用提示，再点 `Confirm Provider Run` 并在
   原生 dialog 确认。该确认只授权本次异步 Run；Retry 会换新 generation UUID 并再次确认。界面只轮询
   短状态请求，最终 Proposal 仍走相同的 diff 与 Accept/Reject 审批。默认 `pnpm dev` 无 Provider 时，
   该区域显示空列表，前述 MCP 路径继续可用。
7. 需要保存评测或回放证据时，调用 `operatingline.eval.export`，传入
   `{ targetAdapterId, planId, instanceId?, afterSequence?, limit? }`；也可请求
   `GET /api/v1/eval/export`。继续分页时把上一页 `nextAfterSequence` 作为新游标。导出未自动脱敏，
   分享或用于训练前必须检查目标文本、修订消息、动作参数、观察和错误详情。

局部重规划的权限边界：

| 操作                     | 调用 provider/可能计费 | 创建 Proposal | 安装或执行计划 |
| ------------------------ | ---------------------- | ------------- | -------------- |
| `replan.prompt.get`      | 否                     | 否            | 否             |
| `replan.generate`        | 是                     | 否            | 否             |
| `replan.propose`         | 否                     | 是            | 否             |
| Blender Replan Run       | 是（每次确认）         | ready 时是    | 否             |
| Blender `Accept Plan`    | 否                     | 审批既有提案  | 只安装         |
| Blender `Start` / `Next` | 否                     | 否            | 用户显式执行   |

### 显式启用 OpenAI Planner Provider

默认 `pnpm dev` 仍保持 provider-free。只有需要让本地 runtime 通过 OpenAI Responses API 生成候选
草案时，才设置明确的模型和凭据并启动独立 composition root：

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-secret-token'
export OPERATINGLINE_PORT=43123
export OPENAI_API_KEY='replace-with-your-openai-api-key'
export OPERATINGLINE_OPENAI_MODEL='replace-with-an-explicit-model-id'
pnpm dev:openai
```

该入口只注册 OpenAI provider，不会自动调用模型。外部调用方仍须先读取
`operatingline.planner.providers.list` 或 `operatingline.replan.providers.list` 的远端传输声明，再显式
提供 `providerId` 与新 UUID 调用相应的 `planner.generate` 或 `replan.generate`；Blender 路径则要求用户
在 Revision Workspace 选择该 Provider 并对每个 Run 单独确认。Packet 中的目标或修订
消息、宿主状态和 ActionCatalog 会发送给 OpenAI；成功返回的严格草案、质量/locality 报告和 provenance
会进入 OperatingLine 的未脱敏 Eval 证据。底层 generation 不会创建 Proposal、修改 Blender 或执行
节点；初始规划仍须单独调用 `guide.propose`。局部规划可以由外部调用方用 canonical
`generationRequestId` 调用 `replan.propose`，或由已逐次确认的 Blender Replan Run 在 ready 时组合该
调用；两者产生的 Proposal 都必须由宿主用户接受。

例如，MCP 客户端在规划前使用：

```json
{
  "targetAdapterId": "blender",
  "goal": "创建一个由基础体组成的机器人并渲染 PNG 预览",
  "planId": "robot-preview"
}
```

如果只需要目录，调用 `operatingline.action_catalog.get`；可选 `catalogVersion` 用于精确重放。
PlanningContext 不替 AI 思考，也不会扩充宿主能力：目录未列出的雕刻、权重绘制、modifier 或
任意 Python 操作必须明确保留为人工步骤。可重放的非雪人参考输入位于
[`robot-preview.benchmark.json`](protocol/fixtures/v1/planning/robot-preview.benchmark.json)。

计划安装、Start/Next/Back 和步骤观察可以通过
`operatingline.companions.list` 或 `GET /api/v1/companions` 查询。所有 `/mcp` 和 `/api/`
请求都需要 `Authorization: Bearer <token>`；服务与 Blender Companion 都拒绝非回环地址。
当前查询返回的是每个 `adapterId + instanceId` 的最新已知快照，不是带心跳或超时判定的在线
状态；关闭 Blender 后，最后一条快照仍会保留，直到未来引入租约/心跳机制。

## Blender 内交互

在 3D View 中按 `N`，打开 `OperatingLine` 页签：

1. 连接 Orchestrator 后，若收到 AI 提案，先在 `Plan proposal` 区域查看计划 ID/revision、目标宿主、
   revision thread、`+ / - / ~ / moved` 汇总、字段/简单参数前后值和只读任务树。`Accept Plan` 只替换
   没有 receipt 的空闲会话，不执行任何步骤；`Reject Plan` 保留活动计划和场景。活动会话已有结果时，
   必须先用 Back 回到起点才能接受。
2. `Start` 重置已接受的演示会话、展示 Overlay，并将计划置于第一个可执行步骤之前；待审提案
   存在时 Start/Next 会被门禁，避免在审批期间继续修改场景。
3. `Next` 按 15 个步骤依次创建地面、模型与细节，分配雪/煤/胡萝卜/木头/地面材质，创建并
   刚性绑定四骨骼 Armature，插入第 1/20/40 帧姿态，建立隔离 Scene、World、双 Area Light 和
   Camera，最后生成帧 20 的 320 × 320 Eevee PNG。
4. `Back` 回退当前步骤；连续回退可以删除渲染产物并补偿全部 15 步，不删除用户对象。
5. `Hide Guidance` 会一起隐藏视口卡片、彩色数字、引导线、状态详情和任务树，但保留
   Revision Workspace、Start/Back/Next 与 `Show Guidance` 恢复入口；隐藏不会丢失草稿、历史、
   当前步骤或场景状态。
6. 任务树分支可以独立展开或折叠。蓝色 `OK` 表示已完成，红色 `BACK` 表示当前可补偿步骤，
   绿色 `NEXT` 表示下一步，灰色锁表示尚未开放；视口使用相同颜色显示 `01`–`15`。
7. 顶部可折叠的 `Revision Workspace` 将引用、正文、历史、diff 和提案审批放在同一区域。
   树中每个节点的 `Ref` 会加入一条结构化 `@1.2.3  标题` 引用，不会篡改独立的正文；
   可逐条移除，且一次只能引用同一活动计划或同一待审计划中的最多 8 个节点。尝试混用
   两个基线会保留已有草稿并要求先显式 `Clear Draft`。
8. `Send Request` 只把不可变请求排入本地运行时，不调用 Blender action，也不自动选择
   provider。MCP/provider 返回的新计划仍须在同一工作区审批；若基线来自已接受的请求关联
   Proposal，输入区会显示将继续的 thread 与下一 turn。
9. `Revision history` 显示每轮请求、规划器返回的 revision/diff 和接受状态；默认展示最近三轮，
   `All loaded` 展开当前缓存，`Load Older Turns` 按稳定 turn 游标加载更早页面。
10. `Connect`/`Disconnect` 控制本地实时 Companion；Disconnect 会取消尚未安装的远端计划更新
    和本地待审提案。

Blender 公开 Python UI API 不提供任意内置菜单项的稳定屏幕矩形。当前对象和世界坐标锚点会
绘制真实目标线；`operator` 锚点只显示操作 ID 或 `menuPath` 语义路径，并明确标记
`UI target unavailable`，不会伪造一条指向并未被 AI 点击的按钮连线。Back/Next 按钮使用宿主
原生控件：Back 采用 Blender 警示色，Next 使用绿色状态图标；任意按钮背景色不是 `UILayout`
公开能力。

本地 Start/Next/Back/Show/Hide 操作会随 Blender UI 事件自然重绘。只由 Companion timer 更新的
远端计划或连接文案，可能要等到 Blender 下一次正常界面重绘后显示；当前版本不调用 4.5/5.1
未公开的区域重绘接口，也不把测试用 `wm.redraw_timer` 放进生产路径。

默认情况下 `Start` 不删除任何现有对象。只在用户显式勾选
`Delete factory Cube/Camera/Light on Start` 后，Extension 才会尝试清理启动场景；即便已经授权，
也只有场景恰好包含通过保守工厂指纹检查的三件套时才会原子性删除。Blender 不提供这些对象的
可信来源标记，因此显式开关才是删除授权，指纹检查只是额外保护，不能代替授权。

当前回退 receipt 只在本次 Extension 会话内有效，并以步骤 ID 保存该步产生的多个资源、mutation
和文件产物。保存重开或扩展重载后，OperatingLine 不会仅凭可复制的自定义属性接管或删除旧对象；
遇到同名残留时会停止并要求用户明确处理，避免误删用户复制或修改过的内容。若资源在执行后被
外部修改，compare-and-restore 检查会拒绝用旧值覆盖该修改，并保留 receipt 供用户处理冲突。

revision 4 使用 `resource_exists`、`material_assigned`、`armature_ready`、
`pose_animation_ready`、`render_scene_ready`、`render_rig_ready` 和
`render_artifact_exists` 七类 observation 检查资源、材质、骨架绑定、关键帧、场景、灯光相机
和 PNG 产物。协议 `0.1.0` 仍把 observation 作为执行后遥测：不满足的观察会回传，
但不会把 action 的 `step_succeeded` 自动改判为失败，也不会触发自动补偿。

`guide.publish` 直接发布路径在运行中收到更高 revision 时，Extension 不会因为“收到计划”而
自动回退场景。该受信任更新会显示为 pending，用户 Back 到起点后才会安装。`guide.propose`
始终进入独立人工审批，不会自动安装；Disconnect 会取消本地 pending/待审状态。非法协议版本、
非允许列表动作、非回环 URL、超大响应和过期/冲突状态报告都会显式失败。

## 与现有 Blender MCP 并存

`adapters/blender/bridge` 是过渡性外部客户端。它连接已安装 Blender MCP 扩展在回环地址
上开启的 TCP transport（默认 `127.0.0.1:9876`），不修改该扩展，也不启动第二个同端口服务。

OperatingLine Bridge 只允许 `start`、`next`、`back` 和 `toggle_overlay` 四个控件，
并强制限制回环地址、端口范围、总请求时限和响应大小。但是，当前上游 MCP transport 本身
接受 Python 代码，因此 Bridge 不是安全沙箱，不应对非受信网络开放该端口。

## 如何适配其他开源软件

跨软件复用的是协议和契约，不是 Blender 代码。新宿主从 `adapters/<host>` 接入：

1. 盘点宿主的官方扩展 API、主线程规则、命令目录、对象身份和 undo/checkpoint 能力。
2. 从 `adapters/_template/capabilities.example.json` 建立能力画像，把每项能力声明为
   `native`、`emulated` 或 `unsupported`。
3. 实现允许列表 action catalog；不对外暴露任意代码执行或任意文件路径。
4. 把通用语义锚点解析为宿主对象、命令、节点或自有面板控件；解析失败时停止而不是盲目点击。
5. 用宿主原生面板、Overlay 或类似扩展点呈现任务树和引导；没有扩展 API 时如实降级。
6. 运行 `tests/contract` 的通用契约测试，再补充宿主集成测试和端到端验收场景。

宿主分为三级：有官方扩展 API 的 **Native**、有命令/API 但 UI 扩展受限的 **Assisted**、
只有 Accessibility/视觉接口的 **Observed**。降级宿主不得伪装拥有精确锚点或确定性回退。
详见 [通用宿主架构](docs/architecture/overview.md) 和 [适配器约定](adapters/README.md)。

## 为何无需 Blender PR，什么时候需要

当前功能不需要向 Blender Core 提交 PR。Blender 公开 Extension API 已能注册：

- `Panel` / `UILayout`：Sidebar 任务树和控制按钮。
- `Operator`：宿主数据操作；当前雪人垂直切片使用受控 `Back` 补偿回退，不接入 Blender
  原生 Undo 栈，避免 Python 会话状态与 ID datablock 撤销状态脱节。
- `SpaceView3D.draw_handler_add`：`POST_PIXEL` 卡片、数字和引导线。
- `gpu` / `blf`：形状与文字绘制。
- `GizmoGroup`：后续可交互三维锚点。

只有需要新的原生 Editor/Space、公开 API 中缺失的绘制或事件阶段、Blender 官方维护的
持久异步运行时，或 Python Extension 无法提供的安全边界时，才考虑最小化上游 PR。

详见 [Blender Companion](docs/architecture/blender-companion.md)。

## 开发与测试

安装依赖后执行完整的 TypeScript/Node.js 质量检查：

```bash
pnpm check
```

这会依次运行 ESLint、TypeScript 类型检查、Vitest、协议 Schema 漂移检查和 Prettier 格式检查。

运行 Blender Extension 集成测试并构建安装包：

```bash
pnpm test:blender
pnpm test:blender:companion
pnpm test:blender:visual
pnpm package:blender
```

`pnpm test:blender` 会先用独立 Python 进程运行纯引导状态单元测试，再在每个检测到的 Blender
4.5+ 可执行文件中运行基础 Extension 回归和完整雪人测试；后者验证复合动作冲突不会留下部分结果、外部
Mesh/Material/Collection/Armature/Action 引用会安全阻止回退、320 × 320 PNG、隔离 Scene，
以及 15 步完整
前进/回退。`pnpm test:blender:companion`
会启动真实 Orchestrator 进程和 Blender，经过 MCP 提交初版提案、Blender 节点引用与修订请求、
两轮线性 thread、MCP 请求关联重规划、精确 Plan diff、完整修订历史、实例定向 Proposal、三次人工接受、
Start/Next/Back、决策与状态回传，验证审批前零执行、默认 Cube 不被删除以及跨进程闭环。
`pnpm test:blender:visual` 会为十个互相隔离的真实 GUI 状态启动 Blender，始终保留默认
Cube、Camera 和 Light，并捕获 `guidance-initial.png`、`guidance-revision-request.png`、
`guidance-revision-collapsed.png`、`guidance-proposal-review.png`、
`guidance-provider-disclosure.png`、`guidance-provider-generating.png`、`guidance-mid-forward.png`、
`guidance-after-back.png`、`guidance-hidden.png` 与 `guidance-operator-fallback.png`；中间前进态
同时写入兼容产物 `artifacts/blender/overlay-smoke.png`。这些截图分别用于检查初始绿色 Next、
节点引用与 Revision request、保留草稿的折叠摘要、待审提案的 thread/diff/参数变化、远端 Provider 数据/费用披露、异步 generating 状态与 Run ID、修订历史与接受/拒绝控件、红色 Back/绿色
Next 并存、回退后的颜色与对象变化、完整隐藏，以及 operator 语义降级。

产品与视觉实现的长期约束记录在 [DESIGN.md](DESIGN.md)，后续宿主不得自行发明冲突的状态色、
锚点真实性或隐藏规则。

macOS 会自动检测 `/Applications/Blender.app` 和 `/Applications/Blender 2.app`；Linux 会检测
`/usr/bin/blender` 和 `/usr/local/bin/blender`。其他安装位置使用 `BLENDER_BIN`。

单独启动 Orchestrator：

```bash
OPERATINGLINE_ACCESS_TOKEN=development-token OPERATINGLINE_PORT=43123 pnpm dev
```

服务只监听 `127.0.0.1`，启动日志会输出 MCP endpoint。当前注册的 MCP tools 为
`operatingline.health`、`operatingline.adapters.list`、`operatingline.companions.list`、
`operatingline.action_catalog.get`、`operatingline.planning.context`、
`operatingline.planning.evaluate`、`operatingline.planning.prompt.get`、
`operatingline.planner.providers.list`、`operatingline.planner.generate`、
`operatingline.replan.providers.list`、`operatingline.replan.requests.list`、
`operatingline.replan.prompt.get`、`operatingline.replan.generate`、
`operatingline.replan.thread.get`、`operatingline.replan.propose`、`operatingline.eval.export`、
`operatingline.guide.publish` 和 `operatingline.guide.propose`。此外注册了用户可选择的 MCP Prompt
`operatingline.plan_and_propose`。

## 提交规范

项目使用 Conventional Commits、Commitizen、Husky 和 Commitlint。优先通过交互式命令生成提交信息：

```bash
git add <files>
pnpm commit
```

常用类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci` 和 `chore`。
Husky 会在提交前运行完整的 `pnpm check`，并使用 Commitlint 检查提交信息。

## 路线图与当前边界

已完成的是协议、Orchestrator 发布/投递/状态端、持久化 Proposal/Decision 与 Blender 内人工
审批、Blender 内引导与可回退建模、真实 Orchestrator ↔ Companion 跨进程闭环，以及受限的
现有 MCP Bridge。当前仍未完成：

1. 把当前两目标的结构质量基线扩展为更大、带人工语义判定的数据集；首个可选 OpenAI Responses
   插件、类型化局部重规划后端和原生 Revision Workspace 已经完成，但它们不证明任意目标语义规划
   可靠；Blender 已接入逐次授权的 Provider Run，但仍未接入流式模型对话、provider 自动选择/调用或
   自动语义重规划。OperatingLine 核心
   仍只负责 packet、权威严格验证、证据和人工审批。
2. 在已完成的线性多轮 revision thread、Plan diff 和结构化消息历史上增加显式分支/合并策略和
   用户可编辑参数表单。
3. 把 observation 从 `0.1.0` 遥测升级为可配置的成功门与恢复策略，并在接入 Blender
   `undo_post`/`redo_post` 后再声明原生 Undo 能力。
4. 在已完成的原始 eval/replay 证据导出之上增加显式评分器、数据脱敏与同意/保留策略、数据集切分
   和训练流水线；当前导出不自动评分，也不应未经审核直接分享。
5. 增加 Companion 心跳、租约与能力协商，再使用同一协议接入第二个开源宿主。
6. 在首个稳定发布前引入 Changesets 与自动发布流程。

首版只保证自有面板控件、三维对象和世界坐标锚点，不承诺精确标注任意 Blender 内置按钮。
对没有官方扩展 API 的宿主，只提供能力画像明确允许的降级体验。

## 参与贡献与安全

提交改动前请阅读 [贡献指南](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。Bug 与
功能建议使用仓库 Issue Forms；安全漏洞请按 [安全政策](SECURITY.md) 私密报告，普通使用问题
参见 [支持说明](SUPPORT.md)。

生产依赖审计可运行 `pnpm audit:prod`；已核实的精确例外与复查条件公开记录在
[依赖审计说明](docs/security/dependency-audit.md)。本轮未引入 Changesets，版本发布流程将在稳定
发布前单独设计。

## License

OperatingLine 使用 [Apache License 2.0](LICENSE)。仓库内改编的第三方材料及其原始许可见
[Third-Party Notices](THIRD_PARTY_NOTICES.md)。
