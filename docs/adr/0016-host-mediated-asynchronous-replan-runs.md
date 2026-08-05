# ADR 0016：宿主授权的异步 Replan Run

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0015 已建立类型化局部重规划：调用方显式选择 Provider，`replan.generate` 返回经过严格验证的
canonical draft，调用方再把完全相同的 draft 交给 `replan.propose`。这条 MCP/HTTP 路径适合能够等待
长 Promise 的模型客户端，但尚未把 Provider 调用安全地接入 Blender Revision Workspace。

Blender Companion 的网络边界刻意使用短 HTTP 请求，并由一个不导入 `bpy` 的后台线程承担 Guide、
Proposal、状态报告、决策、revision request 和历史轮询。Provider 调用默认可运行 60 秒、上限 120 秒。
若 Blender 直接等待同步 generate，要么沿用 0.75 秒超时而必然失败，要么扩大超时并让整条 Companion
I/O 在生成期间停摆。为 Blender 增加一套长请求线程还会把幂等、关闭、恢复和自动 propose 状态机复制到
每个未来宿主。

同时，Provider descriptor 只披露执行位置和数据处理方式，不构成用户同意。远端重规划可能发送用户
消息、完整 base Plan、节点引用、ActionCatalog 和最新 Companion 状态，也可能产生 Provider 费用。模型
调用成功仍不等于用户授权执行 Blender 场景动作。

## 决策

在 Orchestrator 增加版本化、宿主授权的异步 `CompanionReplanRun` 应用资源。它组合现有
Provider generation 与 canonical Proposal 服务，但不复制它们的验证权威：

```text
Blender Revision Workspace
  │ acknowledged request + explicit provider + native confirmation
  ▼
POST /api/v1/companion/replan-run ──► persist authorization ──► 202 queued
                                                    │
                                                    ▼ background
                                      existing replan.generate
                                         │             │
                                needs_revision       ready
                                         │             ▼
                                         │   existing canonical replan.propose
                                         │             │
GET short status polling ◄───────────────┴─────────────┘
  │
  └─ proposal_created ──► existing Companion delivery
                              └─ Blender Accept / Reject
                                   └─ Next is first scene mutation
```

现有 MCP 客户端继续使用分离的 `replan.generate` 与 `replan.propose`，不新增一个可伪装宿主授权的 MCP
组合 Tool。Run 只服务于已认证的宿主 Companion 交互。

## 版本化 wire contract

Run request 使用协议 `1.0.0`，包含：

- 独立 UUID `generationRequestId` 与已持久化的 `revisionRequestId`；二者不能相同；
- 明确的 `providerId` 与 `providerVersion`；
- `targetAdapterId` 与 `targetInstanceId`，服务端仍从 revision request 重新核对目标；
- `authorization.disclosureVersion: "1.0.0"`；
- `dataHandlingAcknowledged`、`possibleChargesAcknowledged` 和
  `proposalCreationAcknowledged` 三个必须为 `true` 的确认；
- RFC 3339 `authorizedAt` 审计时间。

请求不得携带 API Key、Provider endpoint、模型配置、原始响应或 reasoning。Provider 版本必须与用户所
查看的当前公开 descriptor 匹配；Provider 不可用、请求未 acknowledgement、已非 pending/thread head、
目标不符或授权不完整时，在调用 Provider 之前拒绝。

公共 HTTP 入口为：

- 复用 `GET /api/v1/replan/providers`；
- `POST /api/v1/companion/replan-run`，成功持久化后立即返回 `202`；
- `GET /api/v1/companion/replan-run?generationRequestId=...`，返回当前确定性状态。

状态为 `queued | generating | needs_revision | proposal_created | failed | interrupted`。响应始终包含 Run、
revision、Provider 和目标 identity、`terminal`、`sceneChanged: false` 与更新时间；终态可携带 nullable
`proposalId`、严格 quality/locality findings 或稳定、清洗后的错误及 `retryMode`。状态不返回 Provider
原始输出、原始 SDK 错误或私有推理。

## 后台组合与权限边界

POST 先写入 authorization/queued evidence，再把工作交给 Orchestrator 后台协调器。协调器调用现有
`PlannerReplanGenerationCoordinator`：

- `needs_revision` 成为终态，不创建 Proposal；
- `ready` 时只把生成结果按下列方式映射给现有 `ReplanningService.propose()`：

```text
generationRequestId = generationResult.requestId
requestId           = generationResult.revisionRequestId
catalogVersion      = generationResult.draft.catalogVersion
planning            = generationResult.draft.planning
plan                = generationResult.draft.plan
```

Proposal 服务继续核对 completed generation、canonical draft、adapter/instance、当前 target revision、
locality 和 planning quality。Run 没有权编辑 draft、接受 Proposal、安装 Plan 或执行 action。

一次宿主确认同时授权所选 Provider 调用，以及仅在 canonical result 为 ready 时创建一个待审 Proposal。
这是应用层组合授权，不改变 `replan.generate` 自身固定的 `proposalCreated: false`。Proposal 到达 Blender
后仍必须另行 Accept/Reject；Accept 只替换空闲的 active Session，`Next` 才是第一次场景 mutation。

## 并发、重试与恢复

每个 `targetAdapterId + targetInstanceId` 最多存在一个非终态 Run；该实例已有未决 Proposal 时也拒绝
新 Run。所有定向 Proposal 写入在 SQLite `BEGIN IMMEDIATE` 事务中再次取得同一实例的 unresolved slot，
因此 Provider 等待期间若另一条外部路径先创建 Proposal，Run 会安全失败而不会制造或隐藏第二个待审项。
现有 Provider/global/Plan 并发限制继续由共享 invocation manager 执行。

Blender 在 `queued/generating` 期间保留 immutable revision/generation identity，并在 Controller 与状态层
同时阻止第二次修订提交、Provider 刷新和并发 Proposal 决策。普通 Plan 或 Proposal 投递可以继续建立
宿主状态，但不能清除或冒充活动 Run；Proposal delivery 早于 Run status 时必须等 terminal status 后再
开放决策。首次 acknowledgement 必须精确匹配 pending request，重复 ACK 只是幂等 no-op。非活动状态下
安装新 Plan 会使旧 request context 失效，之后晚到的 ACK 不得重新开放 Provider 授权。

Proposal delivery 与 terminal Run status 是两个独立轮询结果。Blender 因此在主线程维护最多 8 个、以
`revisionRequestId + proposalId` 为复合身份的候选，只把 terminal status 指定的精确 Provider Proposal
提升到审查槽；同 ID 错 request、无关 Proposal 和不同到达顺序都不能覆盖它。容量错误只报告本地队列
已满，不会替用户发送 Reject。Request-linked Proposal 在 Accept 前还必须让 `planDiff.basePlan` 精确等于
当前 active Session；Plan 已漂移时保留 Proposal、Session、场景和 Run evidence，用户仍可显式 Reject。
Protocol 1.0 request-linked Proposal 若没有 `planDiff`，仍可只读审查与 Reject，但因无法证明 base identity，
Accept 必须 fail closed，不得抛出未处理异常或发送远端 decision。

`generationRequestId` 保持 at-most-once 含义。`needs_revision`、`failed` 或 `interrupted` 后，Retry 保留原
`revisionRequestId`，但必须重新展示披露、重新确认并创建新的 generation UUID；不得自动再次调用一个
可能已经计费或处于不确定状态的请求 ID。没有独立 Retry endpoint，重试是一个新的合法 Run POST。

Run 生命周期进入追加式证据。Runtime 启动或关闭时先读取底层 generation completed 与 proposal
provenance：completed `needs_revision` 恢复严格 findings；ready 且 Proposal 已存在时恢复原 proposal ID；
ready 但尚未创建 Proposal 时只用持久化 canonical result 完成已经授权的 propose，三者都不得再次调用
Provider。只有 authorized/queued 或 requested、却没有可信 completed evidence 的 Run 才转为
`interrupted`。底层 generation requested/completed/failed 和 proposal provenance 仍是模型调用与
Proposal 的权威证据。

## Blender 交互

Revision request 被 Runtime acknowledgement 后才显示可运行的 Provider handoff：

1. Provider 选择默认空；即使只有一个可用 Provider，也不自动选择。
2. 不可用 Provider 可显示原因，但不可运行。
3. 选择后显示 display name、version、description 和 `local + no transmission` 或
   `remote + provider-managed transmission`。
4. 所有 Provider 都说明可能存在 Provider 使用费用且 OperatingLine 无法估价；远端文案还明确列出发送
   的数据范围。本地/no-transmission 只描述数据传输，不被误写成免费。
5. `Confirm Provider Run` 打开 Blender 原生确认 dialog；重试显示 `Confirm New Provider Run`，确认只对本次调用有效。
6. Provider/request 改变、断开、终态或 Retry 都使确认失效。
7. Blender 只执行短 POST 与短 GET 轮询；Run 不阻塞既有 Guide、history、decision 和 report I/O。

Blender 不存 Provider API Key、模型或 endpoint。Loopback Bearer token 继续只存在当前 Blender 进程。
Provider-free standalone 显示无可用 Provider，但外部 MCP planner 路径保持可用。

## 场景与 Session 不变量

Provider list、授权、queued、generating、needs_revision、failed、interrupted、proposal creation 和 Proposal
delivery 都不得调用 Blender scene mutation API。Proposal delivery 只建立只读 preview session，活动
Session identity、receipts 和场景对象保持不变。Reject 清除 preview；Accept 才可替换一个空闲活动
Session，但仍不执行 action；Next 才按计划修改场景。

## 未选择的方案

- **在现有 Companion 线程等待同步 generate**：会超时或暂停所有其他 Companion I/O。
- **Blender 增加专用长请求线程**：把幂等、关闭、恢复和 propose 编排复制到每个宿主。
- **generate 完成后再要求用户点击 Propose**：Blender 没有比现有 Proposal preview 更有意义的 raw draft
  审查面；一次确认可以明确覆盖“生成并在 ready 时创建待审 Proposal”，执行审批仍独立。
- **把 Run 塞进 `/companion/guide`**：会污染只传递 Plan/Proposal 的严格 delivery contract。
- **自动选择第一个 Provider 或保存长期 consent**：descriptor 或既往授权都不能替代本次数据传输决定。
- **失败后自动重试**：无法证明远端是否已调用、计费或继续运行。
- **把 Run 暴露为 MCP 一键工具**：本地 token 调用不是不可伪造的人类身份，不应宣称为宿主确认。

## 后果与后续

- Blender 获得可见、可审计、不会冻结短轮询的 Provider 局部重规划入口。
- 异步 Run 是宿主中立的应用协议，第二软件 Companion 可以复用相同状态机和安全边界。
- 默认 standalone 仍无 Provider、无凭据读取、无自动调用；OpenAI 仍只由 opt-in composition root 提供。
- Run 授权是 UX 与审计事实，不是强身份凭证；进程内 Provider 仍不是安全沙箱。
- Descriptor 当前不能证明实际价格、接收方或保留期；若需要合规级披露，应版本化扩展 Provider policy
  identity，而不是由宿主 UI 猜测。
- 通用任意目标自动拆解、参数表单编辑、语义质量评分/训练治理、第二软件宿主仍属于后续里程碑。
