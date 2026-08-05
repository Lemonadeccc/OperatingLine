# OperatingLine 路线图

本文记录产品能力，而不是 OMX 的临时运行状态。每个里程碑只有在实现、测试和文档证据齐全后
才能标记完成。

## 已完成

- [x] Headless Orchestrator、版本化 GuidePlan 和宿主能力画像。
- [x] Blender 原生任务树、彩色数字/引导线、Show/Hide、Next/Back。
- [x] 可执行并逐步补偿回退的雪人建模、材质、灯光、相机与预览渲染垂直切片。
- [x] AI GuideProposal 的宿主内只读预览、接受/拒绝和幂等决策。
- [x] Blender 刚性骨骼动画：版本化 rig/pose action、三段关键帧、指定帧渲染和可补偿回退。

## 已完成的规划基础

- [x] 版本化 ActionCatalog：让 AI 查询真实允许动作、参数、资源读写、观察和回退能力。
- [x] `operatingline.planning.context`：把目录、协议约束和宿主状态组合成供应商无关的规划上下文。
- [x] 节点引用与异步修订请求：在活动树或待审树选择 `Ref`，绑定完整 base Plan、稳定节点 ID、
      显示编号和精确目录版本。
- [x] 请求关联重规划：MCP 客户端读取待处理请求并提交完整的新 Plan revision；Proposal 只投递给
      发起实例，仍需 Blender 内接受或拒绝。
- [x] 线性多轮修订与差异审查：请求保存 `threadId + turn + parentRequestId`，后续请求必须以父
      Proposal 的完整计划为基线；每个重规划 Proposal 携带确定性 Plan/节点/字段/参数 diff，
      Blender 在接受前展示摘要。
- [x] 可分页修订消息历史：从规范化请求、Proposal 与同实例人工决策派生完整 turn 记录；MCP/HTTP
      可按 `beforeTurn` 向前查询，Blender 可查看最近轮次、展开已加载内容并继续加载更早页面。
- [x] Eval/replay 证据导出：按 adapter、Plan 和可选实例导出目标、精确目录、完整提案、人工决策、
      步骤观察与回退；使用稳定事件序列、分页和内容哈希，且不虚构质量评分。
- [x] 跨目标结构规划质量基线：catalog `1.2.0` 发布有序阶段画像；MCP/HTTP 可对完整候选 Plan
      检查阶段树、资源依赖、锚点和观察，Proposal 自动执行同一门禁；雪人和机器人两个目标均通过，
      机器人参考计划已在 Blender 4.5/5.1 中完成建模、材质、渲染与全量回退。
- [x] 供应商无关 Planner Packet：MCP Prompt、MCP Tool 与 HTTP 复用同一版本化构建器，提供一致的
      PlanningContext、Proposal 草案 Schema 和 evaluate→propose 规则；生成事件进入 Eval，不依赖
      已弃用的 MCP Sampling，也不在 Orchestrator 保存模型密钥。
- [x] 显式 Planner Provider 契约与运行时边界：嵌入方可注入进程内插件，MCP/HTTP 可列出并明确选择
      provider；核心只发送严格 Planner Packet，验证返回草案、identity、嵌套 ActionCatalog 参数和
      结构质量，固定返回 `proposalCreated: false`，并记录可重放 requested/completed/failed 证据。
      默认 standalone 保持 provider-free，核心不读取凭据或自动选择模型。
- [x] 首个具体厂商插件：可选 `@operatingline/openai-planner-provider` 通过官方 OpenAI SDK 调用
      Responses API，要求明确模型与凭据，固定 `store: false`、32,768 输出 token 上限、
      `maxRetries: 0` 并传递
      `AbortSignal`。当前动态 action/observation records 使用 JSON Object mode，核心继续执行权威
      严格验证。独立 `services/openai-runtime` 与 `pnpm dev:openai` 显式装配该远端、provider-managed
      插件，不改变默认 standalone。
- [x] 类型化 Provider 节点局部重规划：独立 `ReplanningPromptPacket 1.0.0` 绑定 immutable request、
      精确目录、实例状态与 `referenced_subtrees_v1` scope；Provider 可选实现 `replan()`，MCP/HTTP 提供
      list/prompt/generate/propose 顺序。初始与局部生成共享调用、并发、超时和持久 request ID 管理；
      `generate` 固定不建 Proposal，只有携带 canonical `generationRequestId` 的显式 `replan.propose` 才在
      同一事务记录 Proposal、请求关联与 provenance。相关事件已进入 Eval 路由；OpenAI opt-in provider
      同时支持初始规划和局部重规划，默认 standalone 仍 provider-free。

## 后续里程碑

- [ ] 更大的人工 Eval：扩展当前雪人和机器人基线，建立人工标注的跨目标数据集、语义验收 rubric 与
      真实 provider 对照评测。确定性 packet、JSON 输出、严格 Schema、locality 和质量门都不能写成
      “模型已经理解任意目标”；同进程插件也不是强安全隔离。
- [ ] 节点聊天引用 UI、自然语言聊天与自动语义重规划：当前已完成原生 `Ref` + Revision request、
      类型化 provider local replan 和完整 Proposal 审批，但仍是显式异步工具链；尚无新的对话式引用 UI、
      流式聊天、provider 自动选择/调用或基于语义置信度的自动重规划。
- [ ] 修订工作区增强：在完整线性消息历史和 Plan diff 基础上增加明确的分支/合并策略与参数表单
      编辑，不把异步请求伪装成实时聊天。
- [ ] 骨骼与动画深化：在当前四骨骼刚性绑定和三段姿态关键帧之外，扩展可审查 rig、蒙皮/权重、动画
      编辑、观察与安全回退能力。
- [ ] Eval 评分与训练治理：在原始证据导出之上增加显式评分器、脱敏/同意/保留策略、数据集切分、
      训练授权与可追溯训练流水线。
- [ ] 第二软件宿主：以真实原生插件验证协议、能力降级和视觉引导的跨宿主语义。
- [ ] 补做 OMX 正式双通道审查：执行说明见
      [OMX 正式双通道代码审查待办](quality/omx-code-review.md)。

## 设计约束

- 宿主内视觉由原生 Companion 提供，不使用独立桌面窗口冒充精确宿主引导。
- AI 计划先成为 Proposal，只有宿主内明确接受后才可执行。
- action 必须来自目标宿主发布的版本化目录；未知动作、参数或能力不得猜测。
- 树负责呈现和引用，DAG 负责执行；自动 action 只能位于叶子节点。
- 所有局部修改都产生新的不可变 revision，保留旧计划、决策和执行证据。
