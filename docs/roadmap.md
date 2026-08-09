# OperatingLine 路线图

本文记录产品能力，而不是 OMX 的临时运行状态。每个里程碑只有在实现、测试和文档证据齐全后
才能标记完成。

## 已完成

- [x] Headless Orchestrator、版本化 GuidePlan 和宿主能力画像。
- [x] Blender 原生任务树、彩色数字/引导线、Show/Hide、Next/Back。
- [x] 可执行并逐步补偿回退的雪人建模、材质、灯光、相机与预览渲染垂直切片。
- [x] AI GuideProposal 的宿主内只读预览、接受/拒绝和幂等决策。
- [x] Blender 刚性骨骼动画：版本化 rig/pose action、三段关键帧、指定帧渲染和可补偿回退。

## 已完成的规划基础

- [x] 版本化 ActionCatalog：让 AI 查询真实允许动作、参数、资源读写、观察和回退能力。
- [x] `operatingline.planning.context`：把目录、协议约束和宿主状态组合成供应商无关的规划上下文。
- [x] 节点引用与异步修订请求：在活动树或待审树选择 `Ref`，绑定完整 base Plan、稳定节点 ID、
      显示编号和精确目录版本。
- [x] 请求关联重规划：MCP 客户端读取待处理请求并提交完整的新 Plan revision；Proposal 只投递给
      发起实例，仍需 Blender 内接受或拒绝。
- [x] 线性多轮修订与差异审查：请求保存 `threadId + turn + parentRequestId`，后续请求必须以父
      Proposal 的完整计划为基线；每个重规划 Proposal 携带确定性 Plan/节点/字段/参数 diff，
      Blender 在接受前展示摘要。
- [x] 可分页修订消息历史：从规范化请求、Proposal 与同实例人工决策派生完整 turn 记录；MCP/HTTP
      可按 `beforeTurn` 向前查询，Blender 可查看最近轮次、展开已加载内容并继续加载更早页面。
- [x] Eval/replay 证据导出：按 adapter、Plan 和可选实例导出目标、精确目录、完整提案、人工决策、
      步骤观察与回退；format `1.1.0` 在第一页冻结 `snapshotUpperSequence`，后续页必须复用
      `snapshotId + snapshotUpperSequence`，因此新追加事件不会改变同一次导出的关系、汇总或分页内容。
      Bundle 继续使用内容哈希，且不虚构质量评分。
- [x] 跨目标结构规划质量基线：历史 catalog `1.2.0` 发布有序阶段画像；MCP/HTTP 可对完整候选 Plan
      检查阶段树、资源依赖、锚点和观察，Proposal 自动执行同一门禁；雪人和机器人两个目标均通过，
      机器人参考计划已在 Blender 4.5/5.1 中完成建模、材质、渲染与全量回退。
- [x] 目录约束的目标需求覆盖证据：Blender catalog `1.3.0` 发布七项 `semanticCapabilities`；
      capability-aware Planning/Replanning Packet `1.1.0` 要求 provider 声明
      `requirement -> capability -> executable leaf`，quality baseline `1.1.0` 确定性拒绝缺失、未知、
      action 不匹配或局部范围外的映射。无能力的历史目录仍使用 packet/baseline `1.0.0` 精确回放；
      coverage 随 quality 事件进入 Eval，但不产生语义分数或自动创建 Proposal。见
      [ADR 0017](adr/0017-catalog-grounded-goal-coverage.md)。
- [x] 供应商无关 Planner Packet：MCP Prompt、MCP Tool 与 HTTP 复用同一版本化构建器，提供一致的
      PlanningContext、Proposal 草案 Schema 和 evaluate→propose 规则；生成事件进入 Eval，不依赖
      已弃用的 MCP Sampling，也不在 Orchestrator 保存模型密钥。
- [x] 宿主发起 Goal-to-Guidance：Blender 可从 Sidebar 提交不可变自然语言目标；MCP 客户端通过
      `goal.requests.list` 与 `goal.prompt.get` 取得精确 packet，再把完整 draft 与 `goalRequestId` 交给
      既有 `guide.propose`。请求和 Proposal 只绑定原宿主实例，默认不自动调用 Provider；Accept 前不
      替换 Session 或修改场景。Synthetic Canvas contract 与真实 Blender 跨进程闭环均已验证。见
      [ADR 0020](adr/0020-host-initiated-goal-to-guidance.md)。
- [x] 显式 Planner Provider 契约与运行时边界：嵌入方可注入进程内插件，MCP/HTTP 可列出并明确选择
      provider；核心只发送严格 Planner Packet，验证返回草案、identity、嵌套 ActionCatalog 参数和
      结构质量，固定返回 `proposalCreated: false`，并记录可重放 requested/completed/failed 证据。
      默认 standalone 保持 provider-free，核心不读取凭据或自动选择模型。
- [x] 首个具体厂商插件：可选 `@operatingline/openai-planner-provider` 通过官方 OpenAI SDK 调用
      Responses API，要求明确模型与凭据，固定 `store: false`、32,768 输出 token 上限、
      `maxRetries: 0` 并传递
      `AbortSignal`。当前动态 action/observation records 使用 JSON Object mode，核心继续执行权威
      严格验证。独立 `services/openai-runtime` 与 `pnpm dev:openai` 显式装配该远端、provider-managed
      插件，不改变默认 standalone。
- [x] 类型化 Provider 节点局部重规划：当前 capability-aware `ReplanningPromptPacket 1.1.0` 绑定 immutable request、
      精确目录、实例状态与 `referenced_subtrees_v1` scope；Provider 可选实现 `replan()`，MCP/HTTP 提供
      list/prompt/generate/propose 顺序。初始与局部生成共享调用、并发、超时和持久 request ID 管理；
      `generate` 固定不建 Proposal，只有携带 canonical `generationRequestId` 的显式 `replan.propose` 才在
      同一事务记录 Proposal、请求关联与 provenance。相关事件已进入 Eval 路由；OpenAI opt-in provider
      同时支持初始规划和局部重规划，默认 standalone 仍 provider-free。
- [x] Blender 原生 Revision Workspace：在一个可折叠操作日志中组合当前基线、最多 8 个
      结构化节点引用、逐条移除、独立修订正文、线性历史、Plan diff 和 Accept/Reject。引用去重，
      跨基线引用会显式失败而不丢失草稿；折叠或 `Hide Guidance` 不丢失状态。发送只排队，
      不会自动调用 provider 或修改场景。
- [x] 宿主授权的异步 Replan Run：Blender 在 Runtime acknowledgement 后列出无凭据 Provider
      descriptor，保持默认不选择，并在每次调用或重试前显示数据传输/可能费用披露和原生确认 dialog。
      Orchestrator 持久化授权后立即返回 `202`，后台复用严格 provider generation 与 canonical propose；
      Blender 只做短状态轮询。单实例 Run/待决 Proposal 互斥，失败或重启不自动重试；所有生成状态和
      Proposal preview 都不改场景或 active Session，仍需 Accept/Reject，`Next` 才执行动作。
- [x] 人工 Eval 采集基础设施：新增独立 `HumanEvalSuite`、`ProviderEvalRun`、
      `HumanEvalAnnotation`/`HumanEvalAdjudication` 与无分数 `HumanEvalComparisonReport` 协议，内部
      `@operatingline/eval-kit` 验证跨记录引用、精确 catalog/base Plan、内容哈希、安全 artifact、冻结
      live 事件链、盲审/裁决和 released readiness；published report 要求 artifact-verified dataset。
      `pnpm eval:check` 与 `pnpm eval:report` 可验证和报告目录数据集。首个 Blender suite 处于
      `collecting`，包含 7 个案例、6 条 lineage，并禁止 synthetic Run 进入 published comparison。
      见 [ADR 0018](adr/0018-versioned-human-eval-evidence.md)。
- [x] 本地 Human Eval 采集与 provider-blind 评审面：实现冻结 snapshot、`provider_only` /
      `host_execution_with_manual_artifacts` capture、每 Run 必需的独立 preparer sign-off sidecar，以及只监听回环地址的
      headless review service。普通浏览器只接收 opaque Run ID 和签署后的盲审投影，不接收 Provider
      profile、alias 清单、sidecar 或真实 Run ID；reviewer/adjudicator pseudonym 不能与 preparer 重合，
      adjudicator 也不能是该 Run 的 reviewer。默认 capture/blind/review/check/report 不调用模型 Provider
      或产生 API 费用；snapshot 只使用且不保存本地 Runtime access token。人工 artifact 模式只验证宿主
      terminal event；工程/PNG 没有 Runtime hash 绑定，只可供本地盲审，不能满足 released visual artifact
      evidence。Provider profile/settings 也只是 operator-attested，Run 强制 `not_reproducible`；发布级
      treatment comparison 仍等待 Runtime attestation。见
      [ADR 0019](adr/0019-local-human-eval-capture-and-blind-review.md)。

## 后续里程碑

- [ ] 更大的人工 Eval：把已完成的版本化采集基础设施推进为经过真实采集、独立盲审和数据审核的
      released 数据集。Capability trace 只证明 provider 声明可追溯到目录 action；确定性 packet、JSON
      输出、严格 Schema、locality 和质量门都不能写成“模型已经理解任意目标”；同进程插件也不是强
      安全隔离。
  - [x] 定义无分数 suite/run/annotation/adjudication/comparison 协议、`@operatingline/eval-kit`、
        `eval:check`/`eval:report`，并提交 7 个 `collecting` Blender 案例，覆盖 initial plan、local replan
        和 adversarial 能力边界。
  - [x] 实现本地 `eval:snapshot` → `eval:capture` → `eval:blind` → `eval:review` 工具链、单写者锁和
        provider-blind 浏览器投影；这只完成安全的本地采集/评审面，不代表已经采集或评审任何真实数据，
        也不构成发布级 treatment/artifact attestation。
  - [ ] 按明确的数据披露与可能费用确认，为 7 个案例采集真实 Provider Run；当前 `runCount` 为 0。
  - [ ] 为每个 Run 取得至少两名校准 reviewer 的 provider-blind annotation，保留并按需 adjudicate
        分歧；当前 `blindSignoffCount`、`annotationCount` 与 `adjudicationCount` 均为 0。
  - [ ] 附加真实 Blender 执行事件与内容哈希渲染 artifact，完成人工数据审核后再把 suite 从
        `collecting` 推进到 `released` 并发布 comparison。
  - [ ] 让 Runtime 对 Provider/model/settings 与生成 artifact hash 提供不可变 attestation；在此之前，
        operator-attested capture 固定 `not_reproducible`，手工附加 PNG 不能满足 released visual evidence。
- [ ] 实时模型对话与自动语义重规划：当前已完成 Revision Workspace 节点引用 UI、类型化 provider
      local replan、逐次授权的异步 Run 和完整 Proposal 审批，但仍是显式工具链；尚无流式助手回复、
      provider 自动选择/调用，或基于语义置信度的自动重规划。自动化若引入，仍不得绕过数据披露、
      Proposal 审批和场景执行门禁。
- [ ] 修订工作区增强：在完整线性消息历史和 Plan diff 基础上增加明确的分支/合并策略与参数表单
      编辑，不把异步请求伪装成实时聊天。
- [ ] 骨骼与动画深化：在当前四骨骼刚性绑定和三段姿态关键帧之外，扩展可审查 rig、蒙皮/权重、动画
      编辑、观察与安全回退能力。
- [ ] Eval 评分与训练治理：在原始证据导出之上增加显式评分器、脱敏/同意/保留策略、数据集切分、
      训练授权与可追溯训练流水线。
- [ ] 第二软件宿主：以真实原生插件验证协议、能力降级和视觉引导的跨宿主语义。
- [ ] 补做 OMX 正式双通道审查：执行说明见
      [OMX 正式双通道代码审查待办](quality/omx-code-review.md)。

## 设计约束

- 宿主内视觉由原生 Companion 提供，不使用独立桌面窗口冒充精确宿主引导。
- AI 计划先成为 Proposal，只有宿主内明确接受后才可执行。
- action 必须来自目标宿主发布的版本化目录；未知动作、参数或能力不得猜测。
- 树负责呈现和引用，DAG 负责执行；自动 action 只能位于叶子节点。
- 所有局部修改都产生新的不可变 revision，保留旧计划、决策和执行证据。
