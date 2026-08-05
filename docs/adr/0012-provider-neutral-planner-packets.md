# ADR 0012：供应商无关 Planner Packet 与 MCP Prompt

- 状态：已接受
- 日期：2026-08-05

## 背景

ActionCatalog、PlanningContext 和确定性质量门已经给 Codex、Claude 或其他客户端提供规划事实，
但不同客户端仍可能使用各自临时编写的提示词，遗漏 Plan identity、阶段选择、资源依赖或
`evaluate → propose` 顺序。把某一家模型 SDK 直接嵌入 Orchestrator 又会引入 API Key、供应商选择、
数据发送和成本策略，超出当前本地协议服务的职责。

MCP 曾提供 server-to-client Sampling，但该能力从 2026-07-28 协议起已弃用；OperatingLine 不把新的
核心规划链路建立在待移除能力上。MCP Prompt 仍是标准的用户控制模板：客户端决定何时调用、使用
哪个模型，并保留发送前审查权。

官方背景：

- [MCP Prompts](https://modelcontextprotocol.io/specification/draft/server/prompts)
- [SEP-2577：弃用 Roots、Sampling 与 Logging](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging)

## 决策

定义三个版本化公共协议：

- `PlanningPromptRequest 1.0.0`：精确 `targetAdapterId`、可选 catalog 版本、自然语言目标与稳定
  `planId`。
- `PlanningProposalDraft`：要求模型输出可直接提交的
  `targetAdapterId + catalogVersion + planning + complete GuidePlan`，禁止额外字段。
- `PlanningPromptPacket 1.0.0`：包含完整 PlanningContext、上述响应 JSON Schema、固定工作流规则和
  一段确定性渲染后的模型提示。

同一构建器通过三种入口暴露：

```text
MCP Prompt: operatingline.plan_and_propose    ─┐
MCP Tool:   operatingline.planning.prompt.get ─┼─> one deterministic packet builder
HTTP POST:  /api/v1/planning/prompt            ─┘
                                                      │ external client model
                                                      ▼
                                           PlanningProposalDraft JSON
                                                      │
                                    operatingline.planning.evaluate
                                                      │ no errors
                                                      ▼
                                       operatingline.guide.propose
                                                      │
                                                      ▼
                                            in-host human approval
```

MCP Prompt 服务支持在 UI 中显式选择模板的客户端，并呈现 packet 的 `renderedPrompt`；Tool 服务让
模型控制型客户端取得完整 packet；HTTP 服务供 CLI、测试或非 MCP 集成使用。三条路径复用同一
构建器，都不调用模型、不读取供应商密钥，也不绕过宿主内人工审批。

构建器只接受带 `planningPhases` 和 `qualityGate` 的 catalog。历史目录仍可通过原始
PlanningContext/Proposal 流程精确回放，但不能生成一个假装具备完整质量工作流的 Planner Packet。
提示要求模型：

1. 原样使用目标、adapter、catalog、Plan ID 和推荐 revision。
2. 按 catalog 顺序选择目标相关阶段，并建立根级阶段树。
3. 只绑定目录动作，满足资源创建/依赖、语义锚点、观察和回退边界。
4. 把不支持的工作保留为 actionless/manual 节点。
5. 只输出严格 JSON，先评估、修复全部 error，再提交完整 Proposal。

目标、catalog 和 Companion 文本会用明确的起止标记隔离为不受信任任务数据。该标记只能减少模型把
任务数据误当规则的风险，不能保证模型不受提示注入影响。真正的授权边界是严格 Proposal Schema、
ActionCatalog 允许列表、确定性质量门、Proposal 校验和宿主内人工审批；MCP 客户端还必须自行限制
模型可调用的其他工具。Prompt 生成会追加 `planning.prompt.generated` 事件；按 Plan 导出的 Eval bundle
会包含 packet、上下文和后续质量/审批事实，但不会保存模型私有推理。

## 边界与后果

- 这是统一的规划输入与输出契约，不是内置自动模型，也不保证客户端一定支持 MCP Prompt。
- Tool/HTTP fallback 保证没有 Prompt UI 的客户端仍可消费完全相同的 packet。
- Packet 可能包含用户目标、宿主状态和完整 catalog，继续受本地 Bearer Token 与 Eval 未脱敏警告
  约束；客户端决定是否把内容发送给外部模型。
- 结构质量仍由 `planning.evaluate` 和 Proposal 门禁证明；自然语言语义完整性与审美质量仍需模型、
  人工审核和更大的标注数据集。
- 后续可在独立 planner provider/plugin 中接入具体模型，但不能把供应商凭据或数据发送策略偷偷塞进
  通用协议层。
