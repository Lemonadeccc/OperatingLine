# ADR 0033：目录派生的修订参数表单

- 状态：已接受
- 日期：2026-08-12

## 背景

Revision Workspace 原先只能把稳定节点引用与自由文本消息交给重规划器。用户即使只想把球体半径从
`0.85` 改为 `1.05`，Provider 也必须重新解释自然语言；请求本身无法证明原值、目标值或最终 Plan 是否
精确采用该值。直接修改活动 Plan 又会绕过 Proposal、diff 与宿主审批门。

## 决策

Guide/Companion protocol 升级为 `1.3.0`。`GuideRevisionRequest` 可携带
`parameterEdits[] = { nodeId, argumentName, before, after }`：

- 每个 edit 只能指向请求中直接引用的 action 叶节点，同一 `nodeId + argumentName` 不得重复；
- `before` 必须与 immutable base Plan 的顶层 action argument 深度相等，`after` 必须不同；
- Orchestrator 把同一节点的 edits 合并后，用请求绑定的精确 ActionCatalog 验证完整 arguments；
- `1.3.0` 请求可以只含结构化 edit 而消息为空；没有 edit 时仍必须提供非空消息；
- `1.0.0`–`1.2.0` 继续是 message-only，不能静默读取新字段。

Blender 从打包的精确 ActionCatalog 派生当前节点的顶层字段。表单允许编辑 boolean、integer、number、
string enum 和长度 1–4 的定长数值向量；资源 ID、对象名等普通 string，以及嵌套 object/array 保持只读，
复杂修改继续使用文本请求。编辑值先应用到 base Plan 的隔离副本并经过同一 action allowlist/参数验证，
不会修改活动 Session、Plan 或场景。移除引用同时移除其 edits，Reset 和 Clear 只修改本地草稿。

Replanning Packet 原样携带结构化 edits，并明确要求 Provider 精确应用。Locality gate 对目标完整 Plan
逐项检查 `action.arguments[argumentName] === after`；缺失或重新解释产生
`parameter_edit_not_applied`，generation 不能进入 ready/propose。最终仍必须形成更高 revision 的完整
Proposal，并经过 Blender 内 Accept/Reject；参数表单不是直接执行入口。

## 验证

- 协议测试覆盖 form-only 请求、旧版拒绝、重复 edit、非直接引用和 no-op edit，并校验生成 Schema；
- Orchestrator 测试覆盖 exact-before、目录参数验证和 Provider 未应用/精确应用两条 locality 路径；
- Blender 纯 Python 测试覆盖目录顺序、标量、enum、数值向量与嵌套只读字段；
- Blender 4.5.3/5.1.1 集成测试从真实 Revision Workspace 创建、清理、提交 edit，并证明活动 Session 与
  场景对象在请求阶段保持不变。

## 后果与边界

- 简单参数修改成为可审查、可验证的精确意图，不再依赖 Provider 猜测数值。
- 当前只编辑已存在的顶层参数，不提供嵌套权重、关键帧记录或任意 JSON 编辑器，也不新增 action 参数。
- 当前 revision history 仍是线性 thread；显式 fork、三方 merge 与冲突处理属于后续独立协议决策。
