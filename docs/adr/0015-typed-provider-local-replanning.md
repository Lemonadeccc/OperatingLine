# ADR 0015：类型化 Provider 节点局部重规划

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0006、0009 和 0010 已建立不可变节点引用、实例定向 Proposal、线性 revision thread、Plan diff
与可分页历史。ADR 0012–0014 又建立了供应商无关初始规划 packet、显式进程内 Planner Provider 和
可选 OpenAI Responses 实现。但这两条能力此前没有类型化地接通：外部 MCP 客户端可以自行处理修订
请求，已注入 provider 却只能生成初始计划。

局部重规划不能等同于让模型自由改写整个计划。请求已绑定完整 base Plan、稳定节点引用、精确
ActionCatalog 和发起实例；如果只靠 prompt 文本约束修改范围，越界变化可能混入一个看似有效的完整
Plan。模型调用成功也不能自动获得创建 Proposal、安装计划或执行宿主动作的权限。

## 决策

为局部重规划定义独立的 `ReplanningPromptPacket 1.0.0`，而不是复用初始规划
`PlanningPromptPacket`。Packet 的 `operation` 固定为 `local_replan`，包含：

- 一个仍处于 pending、且是线性 thread 当前 head 的完整不可变 `GuideRevisionRequest`；
- 与请求精确匹配的 ActionCatalog、发起实例最新 Companion 状态和确定性目标 revision；
- `referenced_subtrees_v1` locality scope；
- 严格 `PlannerReplanDraft` JSON Schema，以及 evaluate→replan.propose 工作流；
- 将用户消息、Plan 与目录明确划为不受信任务数据的确定性 `renderedPrompt`。

Provider SDK 在既有必选 `generate()` 旁增加可选
`replan({ requestId, packet, signal }): Promise<unknown>`。没有实现 `replan()` 的 provider 仍可用于初始
规划，但不会出现在 replan provider 列表中，也不能被局部生成入口调用。公共入口为：

- MCP `operatingline.replan.providers.list` 与 HTTP `GET /api/v1/replan/providers`；
- MCP `operatingline.replan.prompt.get` 与 HTTP `POST /api/v1/replan/prompt`；
- MCP `operatingline.replan.generate` 与 HTTP `POST /api/v1/replan/generate`；
- 既有 MCP `operatingline.replan.propose` 与 HTTP `POST /api/v1/replan/propose`。

`prompt.get` 只构建 packet，不调用模型或创建 Proposal。`generate` 必须显式给出独立 UUID
`requestId`、宿主 `revisionRequestId` 和 `providerId`；生成 request ID 不得与 revision request ID 相同。

## `referenced_subtrees_v1` locality

引用按 base Plan 中的稳定节点 ID 解释。如果一个被引用节点已经位于另一个被引用节点之下，规范化
scope 只保留外层根，避免同一子树重复归属。Provider 仍必须返回完整的新 GuidePlan，不得返回 patch、
changed-nodes-only 或部分计划。

确定性 locality 门禁要求：

1. Plan title 与 `rootStepId` 不变；
2. 每个规范化 scope root 仍存在，且自身的 `parentId + order` 不变；
3. scope 外步骤完全不变；
4. 既有后代只能在同一个规范化 scope root 内移动；
5. 新步骤只能添加在规范化 scope root 内；
6. 必须产生至少一项可审查变化。

该门禁与严格 draft/identity、ActionCatalog 和规划质量校验并列执行。`status: ready` 仅表示草案通过
这些机器可判定的约束；它不证明用户自然语言意图已经被正确、完整或美观地实现。

## 调用、Proposal 与 provenance

初始规划和局部重规划协调器共享一个 invocation manager。它统一执行 provider 可用性、并发、同一
`adapter + planId` 排他、超时、`AbortSignal`、关闭、request fingerprint、跨重启已完成结果重放和
at-most-once 重试语义。Operation identity 同时包含 `initial_plan | local_replan`，因此同一个 request ID
不能跨操作复用。

`replan.generate` 返回严格的 `PlannerReplanGenerationResult`，其中包含 canonical draft、Plan diff、
planning quality、locality report，并固定 `proposalCreated: false`。它不持久化 GuideProposal、不投递
Companion、不安装计划，也不执行节点。

若调用方要把 provider 草案送审，必须另行调用 `replan.propose`，提交完全相同的 draft 字段并显式携带
其 `generationRequestId`。Orchestrator 从已完成结果读取 canonical draft，核对请求、adapter、instance、
当前目标 revision、locality 和质量门；任何变化或过期结果都被拒绝。Proposal、revision-request link、
`guide.revision.proposed` 与 `planning.provider.replan.proposed` provenance 事件在一个数据库事务中写入。
重复提交只有在既有 Proposal 与 canonical 输入一致、且事务 provenance 属于同一 generation 时才返回
duplicate；另一个 generation 即使生成相同 Plan，也不能冒领既有 Proposal。

不携带 `generationRequestId` 的既有外部客户端路径仍可提交完整 replan，但必须经过原有请求、目录、
质量和人工审批边界；它不会被记录为某次 provider generation 的 provenance。

## Eval 与数据边界

局部 packet、provider requested/completed/failed，以及显式 propose provenance 事件进入既有
Eval/replay 路由，并按 adapter、Plan 和可选 instance 过滤。成功 completed 证据包含严格草案、diff、
locality 与质量报告；原始 provider 响应、原始错误、凭据和私有推理不保存。Eval 仍不自动脱敏或计算
语义分数，分享或训练前必须审核用户修订消息、宿主状态、动作参数和生成草案。

## OpenAI Provider 与默认运行时

`@operatingline/openai-planner-provider` 的 `generate()` 与 `replan()` 都把各自 packet 的
`renderedPrompt` 交给同一 Responses JSON 请求边界，因此 OpenAI opt-in runtime 同时支持初始规划和
局部重规划。它继续固定 `store: false`、`stream: false`、32,768 输出 token、SDK `maxRetries: 0`，并
传递协调器的 `AbortSignal`。

默认 `pnpm dev` standalone 仍使用空 provider registry，不导入厂商 SDK、不读取模型凭据，也不会自动
调用模型。`pnpm dev:openai` 仍是显式远端 composition root；provider descriptor 只披露传输和凭据管理
边界，不替调用方完成授权。

## 未选择的方案

- **复用初始规划 packet**：会混淆不可变 revision request、实例、thread lineage 和局部修改规则。
- **仅靠 prompt 要求“只改引用节点”**：自然语言要求不能代替确定性 locality 验证。
- **让 provider 返回 JSON Patch**：会隐藏完整计划的结构、目录和审批结果，破坏不可变 revision。
- **generate 后自动创建 Proposal**：会把可能计费的数据传输与送入宿主审批合并为一次隐式授权。
- **propose 时允许编辑 provider draft**：会使 generation 证据无法证明实际送审内容。
- **让所有 provider 必须实现 replan**：会无必要地破坏只支持初始规划的插件。
- **把确定性 locality/质量门写成语义理解**：机器约束不能证明自然语言修改质量。

## 后果与后续

- 已注入 provider 现在可以在不绕过完整 Plan、Proposal 和宿主人工接受边界的前提下处理节点局部修订。
- OpenAI opt-in runtime 同时支持初始 generate 与 local replan；默认 standalone 仍 provider-free。
- 技术切片不包含新的“节点聊天”UI、流式自然语言聊天、自动选择 provider、自动发起语义重规划或自动
  接受 Proposal。
- 更大的人工标注 Eval、语义评分与训练数据治理、骨骼/动画能力深化以及第二软件宿主仍是后续工作。
