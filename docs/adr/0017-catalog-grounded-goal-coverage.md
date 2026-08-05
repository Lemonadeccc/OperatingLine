# ADR 0017：目录约束的目标需求覆盖证据

- 状态：已接受
- 日期：2026-08-05

## 背景

ActionCatalog、PlanningContext 和跨目标结构质量门已经能够证明候选 Plan 只使用宿主公开动作，
并满足阶段、树/DAG、资源依赖、锚点和观察约束。但是 `PlanningIntent` 此前只保存自然语言目标与
调用方声明的粗粒度阶段。一个结构完全合法的 Plan 仍可能遗漏目标中的具体要求，而证据链无法说明
“哪条要求准备由哪个宿主能力、哪些可执行步骤完成”。

Orchestrator 不能用关键词或模型输出为自己制造语义权威，也不能在没有人工标签时声称已经理解任意
目标。因此需要增加可重放的目标覆盖声明，同时明确它只证明目录约束下的可追溯关系，不证明自然语言
抽取正确、参数满足描述或最终结果具有审美质量。

## 决策

宿主适配器可在精确版本的 ActionCatalog 中发布 `semanticCapabilities`。每项能力拥有稳定 ID、标题、
说明、选择提示和一个或多个已知 action 名。能力词汇仍由适配器拥有；通用协议只定义信封并验证：

- capability ID 唯一；
- action 列表非空且内部无重复；
- 每个 action 都存在于同一目录版本。

Blender ActionCatalog `1.3.0` 首次发布七项能力，覆盖地面、基础体组合、Principled 材质、刚性骨架、
姿态关键帧、渲染场景和 PNG 预览。历史 `1.0.0`、`1.1.0`、`1.2.0` 保持不可变并继续安装。

能力目录存在时，Planner Packet 要求 `PlanningIntent.capabilityCoverage`：

```text
natural-language goal
        │ planner-declared concrete requirements
        ▼
requirementId + statement
        │ exact catalog capability ids
        ▼
capabilityId
        │ executable leaf ids in the complete Plan
        ▼
stepIds → catalog action
```

覆盖策略版本为 `catalog_capability_coverage_v1`。每条需求至少映射一项能力，每项映射至少包含一个
步骤。确定性质量门检查 requirement/capability/step ID 唯一性、能力是否存在、步骤是否存在且可执行，
以及该步骤的 action 是否由对应能力声明。局部重规划还要求覆盖步骤位于规范化引用子树内，避免把
未修改的树外步骤冒充为本轮需求的实现。

覆盖声明进入生成结果、planning-quality 事件和既有 Eval/replay 导出。它不加入 GuideProposal
信封，因此 Blender Proposal、Accept/Reject 和 Next/Back 协议保持不变；完整 Plan 树仍是用户在宿主
内审批的权威对象。

## 版本与兼容性

- Planning/Replanning Packet `1.1.0` 用于带 `semanticCapabilities` 的目录；历史目录继续生成并解析
  Packet `1.0.0`。
- Planning quality baseline `1.1.0` 增加能力覆盖检查；历史目录继续使用 baseline `1.0.0`。
- 通用 `PlanningIntent` 中的 coverage 保持可选，使历史事件、Proposal 和目录可继续解析；但选择能力
  目录后，生成或 Proposal 提交缺少 coverage 会产生确定性 error，不能进入 ready/Proposal。
- Provider SDK 方法签名、Provider 选择、凭据边界、超时和 at-most-once request ID 语义不变。
- 默认 standalone 仍不注册 provider，也不自动选择模型或调用远端。

## 失败语义

- 缺少覆盖、未知能力、不存在或 actionless 的步骤、能力与 action 不匹配：planning-quality error；
  provider 生成结果为 `needs_revision`，不会隐式创建 Proposal。
- 局部重规划把覆盖映射到引用范围外：本轮结果不能成为 ready，也不能 canonical propose。
- 历史目录携带新 coverage：显式拒绝，避免把不存在的能力画像写进旧版本证据。
- 目录错误地夸大 action 能力：确定性门无法发现，仍需目录审查、真实宿主测试和人工语义 Eval。
- Provider 抽取了错误或不完整的需求：覆盖图可能结构合法但语义错误，最终仍由宿主人工审批与后续
  人工标注数据集判断。

## 未选择的方案

- **在核心中按关键词自动抽取需求**：会把易变启发式伪装成宿主无关语义理解。
- **直接增加模型语义分数**：缺少人工标签、评分器治理和校准证据，无法解释或重放。
- **为语义规划建立第二套 endpoint/provider 生命周期**：会重复已有 packet → generate → evaluate →
  propose → host approval 边界。
- **把 coverage 放入 Blender Proposal**：会扩大跨语言宿主信封，而本里程碑的审批权威仍是完整 Plan；
  覆盖证据保留在生成和 Eval 层即可。

## 后果与后续

OperatingLine 现在可以确定性回答“模型声称哪条需求由哪些真实宿主能力和步骤覆盖”，并拒绝引用未知
能力或不相容 action 的声明。这提高了任意目标规划的可审计性，但不是语义正确性证明。

下一阶段仍需扩充人工标注的跨目标数据集，用真实 provider 输出验证 requirement 抽取、参数语义、
教学分组和视觉结果；评分、脱敏、同意、保留和训练授权仍属于独立治理里程碑。
