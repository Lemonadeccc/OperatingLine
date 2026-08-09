# ADR 0021：宿主授权的异步 Initial Plan Run

- 状态：已接受
- 日期：2026-08-09

## 背景

ADR 0020 已让 Blender 用户从原生 `Goal to Guidance` 提交不可变目标。默认流程保持供应商无关：
Codex、Claude 或其他 MCP 客户端发现 Goal、取得精确 Planner Packet，再显式提交 Proposal。这条路径可审计，
但不会主动唤醒 MCP 客户端；用户若已经在可选 Runtime 中配置 Planner Provider，仍需离开 Blender 手工执行
`goal.prompt.get → planner.generate → guide.propose`。

已有异步 Replan Run 证明了宿主内长模型调用必须满足另外几项约束：Provider 默认不选择，每次调用前显示
数据传输与可能费用，长调用不能阻塞 Companion 短轮询，生成成功也不能自动 Accept 或执行。初始规划还需
解决两个额外来源问题：普通 MCP `planner.generate` 的历史结果不能冒充本次宿主授权；Goal Proposal 也必须
能证明由哪一个 generation 创建，才能在进程中断后安全恢复。

## 决策

增加宿主中立的 `CompanionInitialPlanRun` 应用资源。它只服务于已认证 Companion 的逐次确认，组合既有的
Planner generation、ActionCatalog/质量校验和 Goal Proposal 权威；不新增可由 MCP 调用方伪装成人工确认的
一键 Tool。

```text
Blender Goal to Guidance
  │ immutable Goal accepted by Runtime
  │ explicit Provider selection + native confirmation
  ▼
POST /api/v1/companion/initial-plan-run ── persist authorization ── 202 queued
                                                    │
                                                    ▼ background
                                      existing strict planner.generate
                                         │                    │
                                  needs_revision             ready
                                         │                    ▼
                                         │        canonical Goal Proposal
                                         │                    │
GET short status polling ◄───────────────┴────────────────────┘
  │
  └─ proposal_created ── existing instance-scoped delivery
                              └─ Blender Accept / Reject
                                   └─ Start / Next may execute
```

默认 `pnpm dev` 仍不注入任何 Provider，不读取模型凭据、不选择模型，也不会因收到 Goal 自动发起调用。外部
MCP planner 路径继续可用。只有用户在宿主内选择一个公开 descriptor，并对当次 Run 完成原生确认后，
Runtime 才能调用该 Provider。

## Wire contract 与权限边界

创建请求使用 contract `1.0.0`，包含：

- 独立 UUID `generationRequestId` 与已经持久化的 `goalRequestId`；
- 明确的 `providerId + providerVersion`；
- `targetAdapterId + targetInstanceId`，服务端必须再次与不可变 Goal 核对；
- `authorization.disclosureVersion: "1.0.0"`；
- 必须为 `true` 的 data handling、possible charges 与 proposal creation 三项确认；
- 带时区的 `authorizedAt`。

请求不携带 API Key、endpoint、模型参数、原始 Provider 输出或 reasoning。公共 HTTP 入口为：

- 复用 `GET /api/v1/planner/providers`；
- `POST /api/v1/companion/initial-plan-run`，授权持久化后立即返回 `202`；
- `GET /api/v1/companion/initial-plan-run?generationRequestId=...`。

状态为 `queued | generating | needs_revision | proposal_created | failed | interrupted`。响应始终带精确 Goal、
Provider 与宿主目标 identity、`sceneChanged: false`、终态标志和更新时间。`needs_revision` 只返回确定性
planning findings，不伪造局部性或 Plan diff；失败只返回稳定、清洗后的错误和 retry mode。

一次确认授权“一次 Provider 调用，以及仅在严格结果 ready 时创建一个待审 Proposal”。它不授权编辑
Provider draft、不授权 Accept、不安装 Plan，也不执行 action。Proposal 仍必须在 Blender 中单独
Accept/Reject；Accept 只安装，`Start` / `Next` 才可能第一次修改场景。

## 精确 generation provenance

Goal Run 不能只按 `generationRequestId` 读取普通初始生成结果。Runtime 将
`goalRequestId + targetInstanceId` 作为内部 provenance 与完整 `PlannerGenerateRequest` 一起进入 request
fingerprint，并写入 requested/completed/failed 事件。普通 MCP generate 不带这两个字段；相同 UUID 即使
拥有相同 goal/plan/provider，也会因 fingerprint 不同而冲突，不能被重放成宿主授权结果。

Goal 来源的 PlanningContext 只包含发起 Goal 的精确 Companion 实例状态，不发送同 adapter 的其他实例
状态。普通、没有实例 provenance 的通用 PlanningContext 保持原有 adapter 级查询语义。

ready 结果创建 Proposal 时，SQLite 在同一个 `BEGIN IMMEDIATE` 事务中写入：

- Proposal 与 `GuideGoalRequest` 的既有关联；
- 唯一的 `generationRequestId → proposalId` 关联；
- `planning.provider.generation.proposed` 追加式来源事件。

如果外部 MCP Proposal 在 Provider 等待期间先取得同实例未决槽，Run 安全失败；它不得在重启时把外部
Proposal 冒充为自己的 `proposal_created`。

## 并发、重试与恢复

每个 `targetAdapterId + targetInstanceId` 同时最多有一个非终态 Initial Plan Run 或 Replan Run；已有未决
Proposal 时也不能创建 Run。Initial Plan Run 可与它所绑定的 pending Goal 共存，但不能绑定其他实例、
已完成 Goal 或不同 Provider descriptor 版本。完全相同的重复 POST 幂等返回当前 Run；同 generation UUID
的不同授权返回 conflict。

`generationRequestId` 保持 at-most-once。`needs_revision`、`failed` 或 `interrupted` 后的 Retry 继续绑定同一
Goal，但必须重新披露、重新确认并使用新 UUID；失败或进程中断不会自动重试一次可能已经调用或计费的
Provider。

Runtime 恢复只读取持久证据：

- completed `needs_revision` 恢复精确 findings；
- completed ready 且已有精确 generation→proposal 来源时恢复原 proposal ID；
- completed ready 且尚未 propose 时只补完已经授权的 canonical propose；
- 没有精确 completed 证据的 queued/requested Run 转为 `interrupted`。

以上恢复均不得再次调用 Provider。

## Blender 交互

Goal 获得 Runtime acknowledgement 后，原生 Goal Workspace 显示可选 Provider：

1. Provider 默认不选择，即使只有一个可用项；
2. 选择后显示 display name、version、description、local/remote 传输方式和可能费用提示；
3. 远端披露明确说明会发送目标、精确 ActionCatalog 和当前 Blender 实例状态；
4. `Confirm Initial Planner Run` 通过 Blender 原生 dialog 取得当次授权；Retry 使用新 Run ID 和新确认；
5. Companion 只发送短 POST 和短 GET 轮询，并显示 queued、generating 与终态；
6. Proposal delivery 与 Run terminal status 可独立到达，但只能按精确 Goal、generation、proposal 和实例绑定；
7. Provider 选择、调用、轮询、失败、预览和 Reject 均不改变 active Session、receipt 或场景对象。

Blender 不保存 Provider API Key、模型或 endpoint；凭据继续属于显式注入的 Runtime Provider。

## 未选择的方案

- **收到 Goal 后自动选第一个 Provider**：descriptor 或历史 consent 不能代替本次数据传输与费用决定。
- **把组合能力暴露为 MCP 一键 Tool**：Bearer token 证明本地调用权限，不证明宿主中的人工确认。
- **只按 generation UUID 恢复**：无法区分普通 MCP 生成与宿主 Goal 授权。
- **从任意 Goal-linked Proposal 推断 Run 成功**：无法证明 Proposal 是该 generation 的输出。
- **让 Blender 同步等待 Provider**：会阻塞既有 Guide、history、decision 与 state I/O。
- **成功后自动 Accept 或执行**：把模型生成、计划审批和场景修改混为一个权限。

## 后果与后续

- Blender 用户可以留在宿主内完成“表达目标 → 明确调用 Provider → 审查任务树”的闭环。
- Codex、Claude 等外部 MCP 客户端仍可使用供应商无关的 pending Goal 流程，两条路径共享同一严格 Proposal
  与执行门禁。
- Initial Plan Run 与 Replan Run 保持两个公开资源，只复用 Provider descriptor、调用管理、校验和小型 UI
  primitives，避免把不同 findings 和请求语义塞进巨型状态机。
- 实时流式助手、Provider 自动选择、无需确认的自动调用、语义置信度自动重规划、第二真实软件宿主和发布级
  Human Eval 数据集仍属于后续里程碑。
