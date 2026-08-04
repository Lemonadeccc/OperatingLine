# ADR 0009：线性修订线程与确定性 Plan diff

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0006 已允许用户引用节点并返回完整、更高 revision 的待审 Proposal，但每次请求彼此独立，
Blender 只能展示完整新树。用户无法确认“这一轮到底改了什么”，第二次反馈也没有可验证的父子关系。
把自由文本堆成伪聊天记录不能证明新版计划以哪一版为基线，也不足以用于回放或 Eval。

## 决策

Guide protocol `1.1.0` 在 `GuideRevisionRequest` 与请求关联 `GuideProposal` 上增加：

- `revisionThread.threadId`：首轮等于首个 `requestId`；
- `revisionThread.turn`：从 1 开始严格递增；
- `revisionThread.parentRequestId`：首轮为 `null`，后续指向当前 thread head；
- `planDiff`：由 Orchestrator 对请求的完整 `basePlan` 和候选完整 Plan 计算。

当前 thread 是线性的。新 turn 必须保持 adapter、Companion instance 与 ActionCatalog 版本不变，
并把父请求关联 Proposal 的完整 Plan 作为逐字段相等的 base。数据库对 `threadId + turn` 和非空
`parentRequestId` 建立唯一索引；Orchestrator 在写入前验证 head、父 Proposal 和精确基线。

Plan diff 按目标树 DFS 顺序列出新增与更新节点，再按旧树 DFS 顺序列出删除节点。它包含：

- base/target Plan ID 与 revision；
- Plan 级 `title`、`rootStepId` 前后值；
- 节点新增、删除、更新和移动汇总；
- 每个节点的稳定 ID、当时编号、父节点、顺序与标题；
- 每个变化步骤字段的 JSON 前后值，包括完整 action binding 与参数。

Blender 对收到的 thread/diff 再做语言独立的结构与计数校验，在待审区显示差异摘要、变化节点和可
紧凑呈现的参数值。Proposal 仍是完整 Plan；diff 只用于审查和证据，不能作为可执行 patch。

## 兼容性

`1.1.0` 是向后可读的协议小版本。通用 Schema 和 Blender Companion 仍接受既有 `1.0.0` payload；
新 Orchestrator/Companion 产生 `1.1.0`。旧请求没有 thread，因此不能进入新的多轮重规划路径，
但历史事件和 `1.0.0` ActionCatalog 仍可精确回放。

## 未选择的方案

- **仅在 UI 比较两棵树**：其他宿主、Eval 和 MCP 客户端会得到不同差异，无法形成协议证据。
- **JSON Patch 直接执行**：会绕过完整计划校验、ActionCatalog 与宿主内审批。
- **只保存父 request ID**：无法验证 turn、thread 身份或防止同一父节点静默分支。
- **允许任意分支**：需要显式的分支选择、合并和冲突 UI；当前产品尚未定义这些语义。
- **把异步输入命名为聊天**：没有内置模型、流式回复和完整消息历史，会误导用户。

## 后果与后续

- 两轮及以上修订现在拥有可验证的线性来源，Plan diff 可进入现有 Eval/replay 事件包。
- 用户在 Blender 接受前可看到计划级、节点级和简单参数级变化；接收 Proposal 仍不修改场景。
- 后续参数表单必须生成新的完整 Plan revision 和 diff，不能原地修改已签收 Proposal。
- 完整消息历史、分支/合并策略、自动评分与训练数据治理仍是独立里程碑。
