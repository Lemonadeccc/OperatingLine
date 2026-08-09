# ADR 0020：宿主发起的 Goal-to-Guidance 请求

- 状态：已接受
- 日期：2026-08-09

## 背景

OperatingLine 已经提供版本化 ActionCatalog、PlanningContext、Planner Packet、规划质量门、
GuideProposal 宿主内审批和节点引用重规划。不过初始规划仍由 MCP 客户端先提供
`targetAdapterId + goal + planId`。Blender 用户只能在已有计划上提交 revision request，不能从宿主内
用一句自然语言目标开启新的引导会话。

直接让 Blender 调用某个模型 Provider 会把三件不同的事混在一起：宿主表达目标、调用方选择模型并承担
数据传输/费用，以及创建一个可供审批的 Proposal。这也会把通用协议绑定到 Blender、Codex、Claude 或
某个模型 SDK，并迫使每个宿主保存 Provider 凭据和长请求状态。

## 决策

增加供应商无关、宿主发起的 `GuideGoalRequest`。宿主只提交不可变目标；Codex、Claude 或其他 MCP
客户端显式发现请求、取得现有精确 `PlanningPromptPacket`、生成并评估候选计划，然后通过既有
`operatingline.guide.propose` 创建只投递给原宿主实例的 Proposal。

```text
Blender Goal to Guidance
  │ POST /api/v1/companion/goal-request
  ▼
immutable GuideGoalRequest ── persisted pending request
  │
  ├─ operatingline.goal.requests.list
  └─ operatingline.goal.prompt.get ── exact PlanningPromptPacket
                                           │
                          caller-chosen AI/MCP client
                                           │
                          planning.evaluate + explicit guide.propose
                                           │ goalRequestId
                                           ▼
                         instance-scoped read-only GuideProposal
                                           │
                              Blender Accept / Reject
                                           │ Accept installs only
                                           ▼
                                  Start / Next may execute
```

默认 standalone Orchestrator 不选择或调用 Provider。`goal.prompt.get` 只是确定性 packet 构建；
`guide.propose` 只是严格验证、持久化和投递。模型调用、网络传输和可能费用仍由 MCP 客户端或显式注入的
Provider 边界负责。

## 版本化请求契约

`GuideGoalRequest` 使用协议 `1.1.0`，包含：

- UUID `requestId`；
- 宿主的 `adapterId + instanceId + catalogVersion`；
- 用户原始 `goal`；
- 该请求预留的稳定 `planId`；
- 带时区的 `occurredAt`。

请求不携带 Provider、模型、API Key、endpoint、费用授权、生成结果或私有推理。完全相同的重试返回
`duplicate`；相同 ID 的不同内容返回 `conflict`。同一宿主实例同一时间只允许一个未完成目标请求，且
不能与非终态 Replan Run 并存；存在未决 Proposal 时也不能再创建目标请求，避免多个规划器争用同一
实例工作槽或在已付费生成后才发现无法投递。

## MCP 与 Proposal 关联

新增两个 MCP 读取入口：

- `operatingline.goal.requests.list`：按可选 adapter 列出尚未关联 Proposal 的请求；
- `operatingline.goal.prompt.get`：按 `requestId` 取得从持久请求和精确目录构造的现有
  `PlanningPromptPacket`。

Packet 的工作流仍真实指向 `operatingline.planning.evaluate` 和
`operatingline.guide.propose`。调用方把 packet 约束的完整 draft 原样提交，并额外携带
`goalRequestId`；Orchestrator 从持久请求解析实例，并把 draft 的 adapter、catalog、Plan ID 与 planning
goal 逐项核对请求，不信任调用者重新指定路由。ActionCatalog 参数和确定性质量门也必须通过，未知或
不支持的 action 不会被持久化。

成功的 `GuideProposal` 保存 `goalRequestId + targetInstanceId + catalogVersion`，且不能同时保存
`revisionRequestId`。请求到 Proposal 的关联与 Proposal 事件在一个 SQLite 事务中写入；请求随后不再
出现在 pending 列表。Proposal 仍通过既有 Companion 拉取、只读树、Accept/Reject 和幂等决策路径投递。

## Blender 交互

Blender Sidebar 增加可折叠的 `Goal to Guidance` 区域：

1. 用户输入目标并点击 `Create Guidance`；
2. 后台 Companion 线程以短 HTTP 请求提交，并显示 local、delivering、awaiting planner、proposal
   received 或 error 状态；
3. Runtime acknowledgement 只代表请求已持久化，不代表模型已经运行或结果正确；
4. Proposal 到达后复用完整只读任务树和 `Accept Plan` / `Reject Plan`；
5. Accept 只替换一个没有未回退 receipt 的活动 Session，仍不执行 action；`Start` / `Next` 才进入执行。

目标提交、重试、packet 获取、规划、Proposal 创建、预览和 Reject 都不得修改场景。断线重连可复用同一
不可变请求 payload；不能因网络重试生成新 request ID 或重复目标。Runtime 的永久 4xx 会终止该 payload
在当前连接中的自动重试并显示可操作错误，但不会停止 Proposal 轮询；暂时网络错误只做有上限的退避。
Proposal 决策由 Blender 主线程生成一次稳定的 `decisionId + value`，重连和响应丢失都重放同一 payload，
直到 `accepted/duplicate` acknowledgement 回到主线程。校验失败或过期的 Proposal 只隔离并报告，绝不
替用户合成 Reject。普通 UI Disconnect 仅暂停网络并保留待审 Goal/Proposal 与活动修订草稿；Extension
unregister 才清理这些进程内状态。

## 证据与通用性

目标请求和请求到 Proposal 的关联进入追加式事件账本与 Eval 导出，使未来评测可区分用户原始意图、
规划候选、宿主审批和真实执行。Goal 来源的 context、prompt 与 quality 事件在 packet 外层记录不可变的
`goalRequestId + targetInstanceId`；Planner Packet 本身保持原契约。带实例范围的导出只接收精确来源事件，
不会混入同一 adapter/Plan ID 下另一个实例或无实例来源的目标文本。协议字段、MCP 工具和持久化表不包含
Blender 或模型厂商语义；Blender 只是第一个原生 Companion。Synthetic Canvas contract test 用来证明
同一流程可绑定另一 adapter 和实例，但在真实第二宿主落地前仍不宣称已经完成跨软件产品验证。

## 未选择的方案

- **Blender 直接调用 OpenAI、Claude 或其他 Provider**：会复制凭据、披露、费用确认、超时和重试状态，
  并破坏默认 provider-free 边界。
- **目标提交后自动生成、自动 propose 或自动 Accept**：会把目标表达、模型调用、可审批计划和执行授权
  混为一个不可审计动作。
- **把目标只放在 Blender 本地内存**：MCP 客户端无法供应商无关地发现，Runtime 重启也无法审计或恢复。
- **为目标请求发明另一套 Plan/Proposal 格式**：会重复现有 packet、质量门和宿主审批权威。
- **把任意自然语言写成任意 Blender 自动化能力**：ActionCatalog 之外的动作仍必须明确 unsupported 或
  保留为人工步骤。

## 后果与后续

- Blender 用户可以从宿主内开启初始 AI 引导请求，同时保留模型客户端选择权和人工审批门禁。
- Codex、Claude 和其他 MCP 客户端消费同一 pending-request/packet/propose 协议，不需要专用 Blender
  提示词或桌面外壳。
- 当前仍是异步操作日志，不是流式聊天；也不自动选择 Provider、判断审美质量或保证任意目标可表达。
- 请求取消/租约、跨 Blender 进程崩溃的本地决策日志、实时助手回复、参数表单、Runtime artifact
  attestation、第二宿主和发布级 Human Eval 数据集继续属于后续里程碑。
