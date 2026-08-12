# ADR 0035：流式模型对话与置信度门控语义重规划

- 状态：已接受
- 日期：2026-08-12

## 背景

Revision Workspace 已支持结构化引用、显式 Provider Replan Run 和 Proposal 审批，但每轮修改仍要求用户
先判断“这是问题还是改动”，再选择不同工具。直接把聊天流接进 Blender 或允许模型自行重试/执行会破坏
现有三个边界：Blender 只做短请求、每次远端费用必须有明确授权、任何模型结果都必须停在 Proposal。

## 决策

增加版本化 `CompanionDialogueRun 1.0.0`。每轮由 Blender 明确选择支持 `dialogue() + replan()` 的
Provider，并在原生确认框一次性同意数据处理、可能费用、最多两次 Provider 调用、自动语义重规划和
Proposal creation。Provider 不自动选择，也不保存长期 consent。

一次授权包含三个互不相同的 UUID：dialogue request、候选 revision request 和可选 replan generation。
候选 revision request 绑定完整 base Plan、最多八个节点引用、目录、实例和 `revise` 操作，但只有模型
请求重规划且置信度达到固定阈值 `0.8` 时才原子入库。所有 user/assistant 消息统一限制为 4000 字符且
必须包含非空白文本；最近历史最多保留 12 条严格交替的完整消息，失败或中断的未分类部分流不进入下一轮
Provider history。

```text
Blender confirmation
  │ explicit provider + candidate revision + history + two-call limit
  ▼
POST /api/v1/companion/dialogue-run ──► durable queued ──► 202
  │
  └─ short GET polling ◄── streamed assistant text persisted as append-only revisions
                                      │
                         answer / confidence < 0.8
                                      └─ answered; no revision request
                                      │
                         request_replan confidence >= 0.8
                                      └─ atomically record revision request
                                           └─ existing typed replan generation
                                                ├─ needs_revision
                                                └─ review-only Proposal
                                                       └─ manual Accept/Reject
```

公共状态为 `queued | streaming | replanning | answered | needs_revision | proposal_created | failed |
interrupted`。所有响应固定 `sceneChanged: false`，只携带追加式 assistant 文本、公开语义决定、严格门禁
findings 或清洗后的错误，不返回原始 Provider payload、私有推理或凭据。Blender 不直接消费 SSE；
Orchestrator 把文本按有界批次写入 durable Run，Blender 继续通过现有后台线程短轮询。

## Provider 与语义门

Provider SDK 增加可选 `dialogue()`，通过 callback 只发出 `assistant_text_delta`。OpenAI 实现使用 Responses
API `stream: true`、`store: false`、`maxRetries: 0`、`parallel_tool_calls: false` 和一个 strict
`request_replan({ confidence })` function tool。初始 `generate()` 与局部 `replan()` 仍使用非流式 JSON
Object mode；流式聊天不改变它们的 canonical draft 边界。

Orchestrator 而不是 Provider 决定阈值：没有 tool call 得到 `answer`；低于 `0.8` 的 replan 请求也降为
`answer` 并记录公开 confidence；只有 `>= 0.8` 才能调用既有 `PlannerReplanGenerationCoordinator`。
Prompt 把 Plan、目录、历史和用户文本全部标为不可信任务数据，要求解释、状态、能力或歧义问题只回答或
澄清，禁止声称 Plan/场景已经改变。

一次授权最多执行一个 dialogue 调用和一个 replan 调用。共享 invocation manager 继续实施 timeout、
concurrency、AbortSignal 和 request fingerprint；SDK 不隐式重试。运行时重启时，`queued/streaming` 以及
没有 durable generation result 的 `replanning` 转为 `interrupted`，不会重复可能已计费的调用；只有已有
canonical generation evidence 才能恢复 needs-revision 或补完 Proposal。

## 宿主审批与乱序交付

Blender 将活动 dialogue identity 保留到终态；`proposal_created` 在精确 Proposal 到达前仍占用审查槽。
Proposal 和 status 可以乱序到达，但只能按候选 `revisionRequestId + proposalId` 绑定。若同 request 的外部
Proposal 先占用唯一审查槽并使 Dialogue generation 失败，Blender 会在终态后提升已缓存 Proposal，避免
transport 去重后永久隐藏。任意其他 Proposal 不能冒充本轮结果；Accept 前仍核对 Plan diff base，Accept
只安装 Plan，`Next` 才执行动作。Reject 不改变活动 Plan 或场景，下一次明确授权会从当前 accepted Plan
开启新的 revision thread；有 accepted lineage 时也可显式 Fork。对话期间禁止并发 Goal、普通 revision
Provider Run、branch switch/merge/fork 和 Proposal decision。

一旦阈值通过，候选 revision request ID 在 Dialogue 表中永久保留，普通 revision API 不能在 answer、失败或
中断后重新写入它。若 request 已入库但 generation 得到 `needs_revision`、失败或中断，Blender 不会用旧
lineage 发起下一轮 Dialogue，而是把同一 durable request 交给普通 Replan Run，要求用户重新选择 Provider
并显式授权恢复；这会使用新的 generation request ID，但不会伪造新的 revision turn。

## 验证

- 协议 Schema 覆盖三 UUID、双调用授权、历史交替、固定阈值、终态与 revision/Proposal 不变量；
- OpenAI 单元测试覆盖增量文本、strict tool call、拒绝、不完整、重复 tool、错误参数、取消和输出上限；
- SQLite 测试覆盖活动 Run 唯一性、append-only revision、immutable 授权 payload、候选 request 永久保留、
  原子记录和冲突回滚；
- Orchestrator 集成覆盖 answer、低 confidence、threshold replan、quality/locality failure、Proposal、重启和
  at-most-once；
- Blender 纯 Python 与 4.5/5.1 集成覆盖显式授权、短轮询、追加文本、失败后同请求恢复、Reject 后新 thread、
  proposal-first 失败竞态对账，以及 Accept 后仍不修改场景。

## 后果与边界

- 默认 standalone 仍 provider-free；没有 Provider 自动选择、长期授权、自动 Accept 或自动执行。
- `0.8` 是版本化工作流阈值，不是经过 Human Eval 校准的通用语义准确率，也不证明模型理解任意请求。
- 自动化只发生在一次明确授权内部，并只把通过确定性门禁的结果推进到待审 Proposal。
- 对话文本和严格生成证据会进入本地持久状态，可能包含敏感项目信息；当前没有跨设备同步或多人聊天。
- 运行时 treatment/artifact attestation 已由 ADR 0036 完成；真实 Provider Human Eval、双人盲审和
  released dataset 仍未完成。
