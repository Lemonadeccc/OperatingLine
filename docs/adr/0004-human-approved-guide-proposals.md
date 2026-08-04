# ADR 0004：宿主内人工审批 GuideProposal

- 状态：已接受
- 日期：2026-08-04

## 背景

`operatingline.guide.publish` 是确定性垂直切片已有的受信任直接发布路径。若让 Codex、Claude
或其他 MCP 客户端复用它，AI 生成的完整计划会在 Companion 拉取后直接替换空闲会话，用户无法
在宿主内先检查任务分解、动作数量和顺序。这既不符合可教学目标，也把“协议校验通过”错误地
等同于“用户同意执行”。

## 决策

新增与模型供应商无关的两阶段 GuideProposal 生命周期，同时保留直接发布兼容路径：

```text
MCP client
    │ operatingline.guide.propose({ targetAdapterId, plan })
    ▼
Orchestrator ── persist immutable proposal ── SQLite
    │ authenticated companion poll
    ▼
Blender network thread ── queue ── main-thread validate + read-only preview
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  Accept Plan                 Reject Plan
                         │                         │
             replace idle session only       preserve session/scene
                         └────────────┬────────────┘
                                      ▼
                         persisted per-instance decision
```

协议使用独立的 `GuideProposalSubmission`、`GuideProposal` 与 `GuideProposalDecision` Schema。
服务端生成 `proposalId` 和 `proposedAt`；提交者必须显式给出 `targetAdapterId`，且非空 action 的
唯一 adapter 必须与目标一致。每个 Plan ID 的 proposal revision 严格递增，并在重启后从数据库
恢复水位。

Companion 拉取请求可以带 `knownProposalId`，防止尚未决定的草案重复进入主线程队列。决策以
`proposalId + adapterId + instanceId` 唯一；完全相同的重试是 duplicate，同一实例的相反决策
是 conflict，不同实例可以独立决定。

## 宿主不变量

- 网络线程只传输 JSON；提案校验、预览构建、接受和拒绝都在宿主主线程完成。
- Stage 只能创建内存中的只读预览，不能替换活动 Session、执行 action 或改变场景。
- Proposal 存在时禁止 Start/Next；Back 保留给已有 receipt 的安全补偿。
- Accept 只允许替换 receipt 为空的活动 Session，并停在第一个可执行步骤之前。
- Reject 不修改活动 Session、receipt、场景、Overlay 或执行进度。
- 非法提案按 rejected 决策回传，不能部分安装。

## 未选择的方案

- **把 `guide.publish` 改成审批语义**：会破坏已有确定性调用方和测试，且无法区分受信任部署与
  AI 草案。
- **在 Orchestrator 桌面窗口审批**：审批脱离实际宿主上下文，用户看不到 Blender 当前场景、
  receipt 和真实任务树，也违背宿主内呈现原则。
- **收到提案后自动接受**：消除了两阶段协议的信任边界，不能满足教学和可控性目标。
- **每个宿主使用不同的草案格式**：会把模型工具绑定到宿主实现，阻碍第二软件适配。

## 后果与后续

Proposal/Decision 事件已经为后续 replay 和 eval 提供审计输入，但当前还没有训练/Eval 导出器。
MCP 客户端目前必须自己构造 GuidePlan；下一阶段需要版本化 action catalog 与 planner context，
之后才能可靠地支持任意自然语言目标。ActionCatalog/PlanningContext 已由 ADR 0005 落地；节点
引用与请求关联重规划已按 ADR 0006 生成新的不可变 Plan revision 和 Proposal，而不是原地修改
已审查内容。
