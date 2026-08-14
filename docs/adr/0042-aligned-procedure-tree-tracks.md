# ADR 0042：参数化多轨迹 ProcedureTree

- 状态：已接受
- 日期：2026-08-14

## 背景

GuidePlan 已能表达分层任务、宿主 Action 参数、观察与回退，InteractionCatalog 已能为部分 Action
提供原生菜单路径。但它们不能保存从教学视频或自然语言中提取的逐步操作轨迹：具体参数只存在于
Action 末端，无法知道某个位置、缩放或名称是在菜单、快捷键或 MCP 序列的哪一步输入；不同执行方式
也无法按共同语义对齐。直接把鼠标坐标或按键数组塞进 GuidePlan 会把不稳定的 UI 细节混入现有审批
与签名边界。

## 决策

新增独立、宿主无关的 `ProcedureTree 1.0.0` 公开契约。它不是新的视频专用计划，而是 GuidePlan 之前
的可编辑知识与规划中间表示，可由教学视频、自然语言或人工资料产生。树节点区分 group 与 leaf；每个
leaf 保存标准化 `semanticOperations[]`，以及一个或多个版本/上下文明确的 `menuTracks[]`、
`shortcutTracks[]` 和 `mcpTracks[]`。每条可用轨迹都包含有序原子操作，具体参数必须放在实际输入或
调用发生的数组元素上，并通过 `semanticRefs` 对齐一个或多个语义操作。因此一次 MCP 调用可以合法地
覆盖多次 UI 操作，不要求不同轨迹等长。

每个轨迹必须显式标记 `available` 或 `unavailable`。不存在的 MCP 函数、无法诚实表示的菜单操作或
尚未验证的快捷键不得伪造；缺口保留原因，供后续目录扩展。来源与证据独立保存，支持视频时间段、
文本区间或整份来源，并记录置信度和视频权利状态。leaf 还保存 ActionCatalog 绑定、预期 Observation
和 `candidate/verified/rejected` 状态，避免把未回放的视频候选轨迹直接混入训练集。

协议运行时校验以下不变量：单根、无断连或层级/依赖环、group 不可执行、同级及轨迹顺序从 1 连续、
证据来源有效、每条可用执行轨迹完整覆盖该 leaf 的语义操作、`verified` 数据必须声明验证过的宿主版本。
公开 JSON Schema 校验结构；`parseProcedureTree` 继续执行图和跨数组引用校验。

## 兼容性与后果

ProcedureTree 使用自己的 `formatVersion`，不提升 Guide protocol `1.5.0`，现有 Orchestrator、Blender
Companion、Proposal 签名与执行审批语义保持不变。首个 fixture 展示“制作头部 → 创建眼睛 → 创建并
调整左眼球体”，在菜单和快捷键的确切步骤保存位置、缩放与名称；动作级 MCP 轨迹因为当前项目只公开
计划级、需人工审批的 MCP 工具而标记为 unavailable。

后续需要独立实现：教学视频分段与证据提取、ProcedureTree 可视化编辑器、Action/InteractionCatalog
检索与轨迹物化器、ProcedureTree → GuidePlan 编译器、真实 Blender 逐轨迹验证，以及经授权和双人盲审
的数据集导出。任何未来动作级 MCP 工具仍须保留宿主审批、安全目录、Observation 和 Undo 边界。
