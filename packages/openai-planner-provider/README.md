# `@operatingline/openai-planner-provider`

可选的 OpenAI Responses API Planner Provider。它同时实现初始 `generate()`、完整 candidate
ProcedureTree `authorProcedure()`、类型化局部 `replan()`、流式 `dialogue()`，以及 ProcedureTree
流式 refinement 对话与完整树 refinement，只依赖
`@operatingline/planner-provider-sdk` 的边缘接口，不是 Orchestrator 核心依赖，也不会被默认
`pnpm dev` 自动加载。

## 使用

```ts
import { createOpenAIResponsesPlannerProvider } from '@operatingline/openai-planner-provider';
import { startRuntime } from '@operatingline/orchestrator';

const provider = createOpenAIResponsesPlannerProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPERATINGLINE_OPENAI_MODEL!,
});

await startRuntime({
  // databasePath, accessToken, adapters and actionCatalogs omitted
  plannerProviders: [provider],
});
```

也可以显式调用 `createOpenAIResponsesPlannerProviderFromEnv`；API Key 环境变量只会在调用该工厂时
读取，模块导入本身不会访问凭据。生产 composition root 应像 `services/openai-runtime` 一样先验证配置。

## 边界

- `model` 必填且没有默认值。默认公开 provider ID 确定性包含模型 ID；也可为固定配置画像显式指定
  `id`。更换模型或生成画像时不要复用旧 identity。
- API Key 只传给官方 SDK，不出现在 descriptor、协议请求、公开错误或 Eval 证据中。
- 未显式传 `baseURL` 时固定使用 `https://api.openai.com/v1`；不会继承
  `OPENAI_BASE_URL`、`OPENAI_ORG_ID`、`OPENAI_PROJECT_ID` 或 `OPENAI_CUSTOM_HEADERS`。若调用方
  显式配置自定义 `baseURL`，它就是新的远端数据接收方：默认 provider ID 会加入稳定 endpoint
  identity，runtime treatment 会披露规范化 origin 和非敏感 path identity。即使调用方显式固定 `id`，
  不同 endpoint 的 treatment 也不会相同。带 userinfo、query、fragment 的 URL 会被拒绝；远端必须
  使用 HTTPS，仅显式 loopback endpoint 可使用 HTTP。
- `generate()` / `authorProcedure()` / `replan()` / `refineProcedure()` 固定为非流式 JSON Object 请求；
  `dialogue()` 与 `procedureRefinementDialogue()` 使用 Responses SSE stream，
  `parallel_tool_calls: false` 和唯一 strict `request_replan({ confidence })` tool。四者都固定
  `store: false`、最多 `32,768` 个输出 token，官方 SDK `maxRetries: 0`、`logLevel: off`；
  OperatingLine 的持久 request ID 才是防止重复费用的重试边界，Planner Packet 不会因环境中的
  `OPENAI_LOG=debug` 进入 SDK 日志。
- 当前使用 JSON Object 模式。Planner Packet 仍携带完整响应 Schema，但其中目录驱动的动态 action
  和 observation 参数不满足 OpenAI Strict Structured Outputs 的受限 Schema 子集。返回 JSON 必须
  再经过核心的严格 Schema、identity、ActionCatalog、capability coverage 与规划质量验证；局部重规划还要通过
  `referenced_subtrees_v1` locality 门禁。
- 初始 `generate()` 发送 `PlanningPromptPacket.renderedPrompt`；局部 `replan()` 发送独立的
  `ReplanningPromptPacket.renderedPrompt`。当前 Blender `1.22.0` 的 capability-aware packet 格式为 `1.1.0`，
  并要求模型返回 `requirement -> catalog capability -> executable leaf` 映射；历史目录继续使用
  packet `1.0.0`。两者使用相同 Responses 请求、取消和错误清洗边界。
- `authorProcedure()` 发送服务端规范编码的完整 `ProcedureAuthoringPromptPacket`，不另行拼接可变提示词；
  Runtime 对返回值重新执行 candidate-only Schema、packet identity、installed catalog 与 compile 门。成功
  结果也不会自动保存树、物化轨迹、创建 Proposal 或执行 Blender。
- `dialogue()` 只转发经过类型检查的 `response.output_text.delta`，并把完整流与最终 assistant 文本精确
  对账。无 tool call 为 answer；tool confidence 由 Runtime 再与固定 `0.8` 阈值比较。拒绝、不完整、重复
  tool、错误参数、超限输出或中断都 fail closed，不公开原始 Provider payload。一次 Blender 确认最多
  授权这次 dialogue 调用和一个随后发生的 typed replan；结果最多进入待审 Proposal。
- `procedureRefinementDialogue()` 使用独立 strict `request_procedure_refinement({ confidence })` tool，
  只返回有界 assistant delta 和类型化 answer/refine 决策；`refineProcedure()` 发送服务端构造的完整 packet，
  并把解析后的未知 JSON 值交还 Runtime 做完整 ProcedureTree、identity、scope 与 locality 校验。两种 operation
  分别披露真实 stream/tool 和非流式 JSON 设置；均不声称确定性，也不会自行保存或执行树。
- Provider 只返回未经信任的 JSON 值，不调用 `guide.propose` 或 `replan.propose`，不投递 Companion，
  也不操作 Blender。局部生成结果必须由调用方携带 canonical `generationRequestId` 另行送审。
- Provider 是进程内可信依赖，不是插件沙箱；目标、宿主状态和 ActionCatalog 会发送到远端。

默认运行入口保持 provider-free。需要直接运行时使用仓库根脚本 `pnpm dev:openai`，并先阅读
`services/openai-runtime/README.md` 的凭据、传输、调用顺序和权限说明。严格校验只能证明输出符合当前
机器约束且 coverage 可追溯。缺失、未知、action 不匹配或局部范围外的 coverage 会得到
`needs_revision`，不会创建 Proposal；它不能证明模型正确理解了任意目标或节点修改，也不会授权自动
provider 选择、宿主审批或 Blender 场景修改。完整决策见
[ADR 0017](../../docs/adr/0017-catalog-grounded-goal-coverage.md) 与
[ADR 0035](../../docs/adr/0035-streamed-dialogue-and-semantic-replanning.md) 与
[ADR 0070](../../docs/adr/0070-explicit-procedure-authoring-provider.md)。
