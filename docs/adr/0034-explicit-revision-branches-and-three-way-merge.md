# ADR 0034：显式修订分支与确定性三方合并

- 状态：已接受
- 日期：2026-08-12

## 背景

Revision thread 原先只有唯一 `parentRequestId`，适合连续修改，却无法表达“保留当前方案并尝试另一版”或
把两个已审批方案的独立改动合并。直接让 Provider 根据自由文本猜测分支关系会丢失共同祖先，也无法区分
同字段冲突、删除与编辑并发或 source 已前移。把任意 Plan 放进分支选择器还会绕过人工决策与内容身份。

## 决策

Guide/Companion protocol 升级为 `1.4.0`。当前版本的每个 `GuideRevisionRequest` 必须携带显式操作：

- `revise` 继续既有 thread；
- `fork` 引用另一条已接受 branch 的当前 head，并以新请求 ID 建立 turn 1；
- `merge` 继续活动目标 thread，同时引用另一条已接受 branch 的当前 head。Merge 只允许引用目标 Plan root，
  不接受 `parameterEdits`。

Fork/merge source 必须与请求共享 adapter、instance、catalog 和 Plan ID，且 source Proposal 已由同一宿主
接受。请求入库前再次读取 source head；merge 在生成 prompt 和提交 Proposal 时也重新检查 source，防止
长时间运行把已前移分支静默合入。

Runtime 从 thread 的唯一 parent 边以及 fork/merge source 边构建 revision DAG。Merge base 是同时可达且
不再是其他共同祖先之祖先的唯一最低共同祖先；不存在或有多个时拒绝。三方合并保留目标 revision，按
Plan/step 字段比较 ancestor、target、source：

- 只有 source 改动时采用 source，只有 target 改动时保留 target，两边相同则采用该值；
- JSON object 递归到键，因此同一 action 的不同参数可独立合并；数组作为原子值；
- 同一路径两边不同、delete-vs-edit、Plan identity/title 变化产生带路径冲突；
- source 对目标没有可合入贡献时拒绝，不创建空 merge。

服务端把 ancestor Plan、source Plan 和权威 `expectedMergedPlan` 放入 Replanning context。Provider 的完整
Plan 必须与期望值深度相等，否则 locality gate 产生 `merge_result_mismatch`。Merge Proposal 保存
`revisionOperation` 和 `mergeBaseRequestId`，继续计算 target-base Plan diff，并经过既有宿主 Accept/Reject。

`replan.branches.list` MCP Tool 与 `/api/v1/replan/branches` HTTP 端点从现有请求、Proposal、Decision 表
派生每条 thread 的 durable head，不新增可漂移的 branch 状态表。只有 `accepted` head 返回完整 Plan 与
内容 SHA-256；其他状态返回 `null` Plan。

Blender Revision Workspace 显示活动 branch 和所有 heads。Fork 只选择操作模式；Merge 自动建立 root-only
请求；Switch 只安装另一个已接受 head 的 Plan。三者在 receipt、待审 Proposal、Goal 或活动 Provider Run
存在时按相应边界 fail closed，且都不执行 action 或修改场景。

## 验证

- 协议与生成 Schema 覆盖操作拓扑、branch head 可安装性、唯一 thread 和 merge base 字段；
- SQLite/Orchestrator 测试覆盖 fork head 派生、共同祖先、独立字段与同 action 不同参数合并、同字段冲突、
  delete-vs-edit、可选字段缺失语义、空 source 和精确 merge locality gate；
- MCP/HTTP 集成覆盖 fork 请求持久化、branch list 与当前协议投递；
- Blender 纯 Python 测试覆盖 branch list/操作严格验证，Blender 4.5.3/5.1.1 集成覆盖 fork/merge payload、
  branch switch、Session 身份与场景零变化。

## 后果与边界

- Thread 内仍是线性日志；只有显式 fork/merge 才建立跨 thread DAG 边，既有唯一键无需迁移。
- 当前冲突策略是拒绝并返回路径，不提供手工逐字段解决器或 revision rebase。
- Branch Plan revision 仍使用同一 Plan ID 的全局严格递增水位；切换可查看较旧的已接受 head，但不能把
  旧 revision 重新发布成新内容。
- Branch 列表是持久事实而非在线状态；Companion 心跳、租约和多人实时协作仍属后续能力。
- 本 ADR 落地时异步请求、Provider Run 和 Proposal 仍不是流式聊天；后续 ADR 0035 增加了逐轮授权、
  最多两次调用且固定阈值的 dialogue/replan 路径，但仍没有自动 Provider 选择、后台调用或自动接受。
