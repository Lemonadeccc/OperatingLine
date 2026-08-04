# ADR 0010：可分页的修订消息历史

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0009 已让每轮修订拥有线性来源和确定性 Plan diff，但请求、Proposal 与人工决策仍分散保存在
不同表和事件中。Blender 只能看到当前待审 Proposal，用户重新连接后无法在同一位置回顾“我提出了
什么、规划器返回了什么、我接受还是拒绝了什么”。把这些事实复制成一份可变聊天日志会产生新的
一致性来源，也会错误暗示 OperatingLine 内置了实时模型会话。

## 决策

协议增加 `GuideRevisionThreadHistory` 与查询请求：

- scope 固定为 `threadId + targetAdapterId + instanceId`；
- 每个 turn 原样包含不可变 RevisionRequest、关联 Proposal、Plan diff 和宿主决策；
- 派生状态只有 `awaiting_proposal`、`awaiting_decision`、`accepted`、`rejected`；
- 默认返回最新一页，页内按 turn 正序阅读；`beforeTurn` 向前分页，单页最多 100 轮；
- JSON Schema 与 TypeScript/Python 两侧都验证 thread、Plan、宿主实例、父请求、Proposal 和决策关联。

Orchestrator 从现有规范化表联结生成历史，不新增可被单独修改的“聊天记录”表。MCP 暴露
`operatingline.replan.thread.get`，Companion 使用经鉴权的
`GET /api/v1/replan/thread`。Blender 后台线程拉取当前 thread，主线程验证并合并页面；Sidebar 默认
显示最近三轮，可展开全部已加载轮次，并用 `Load Older Turns` 获取前一页。

连续 turn 的门禁同时收紧：父请求不仅要有关联 Proposal，该 Proposal 还必须已在同一
`adapterId + instanceId` 中被明确接受。拒绝或尚未决定的 Proposal 不能成为下一轮 base。

## 未选择的方案

- **复制事件为一份聊天表**：会制造第二个事实来源，并需要额外事务和修复逻辑。
- **只在 Blender 内保存本次会话历史**：重连、Orchestrator 重启和其他宿主无法得到相同结果。
- **一次返回无限历史**：长 thread 会放大响应、UI 和内存成本；使用稳定 turn 游标分页。
- **把 Proposal 当作自然语言助手回复**：Proposal 是完整可执行计划及审查差异，不代表模型推理或
  流式聊天内容。

## 后果与后续

- 用户可以在宿主内审阅完整的结构化修订对话事实，MCP 客户端也能用同一协议分页回放。
- 历史查询只读且不执行 action；接受/拒绝仍是唯一计划状态门禁。
- 消息、动作参数和差异可能包含敏感内容；该查询与 Eval 导出一样要求鉴权和调用方数据治理。
- 显式分支/合并、用户可编辑参数表单、实时模型对话与自动评分仍是独立里程碑。
