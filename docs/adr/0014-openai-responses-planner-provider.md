# ADR 0014：可选 OpenAI Responses Planner Provider

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0013 已把模型调用隔离为显式注入的进程内 Planner Provider：通用 Orchestrator 只构建确定性
Planner Packet、协调调用并权威校验未知返回。为了验证该边界能承载真实厂商 SDK，仓库需要首个具体
provider，但不能把 OpenAI、默认模型、API Key 读取或远端发送变成默认 standalone 的隐式行为。

当前 `PlanningProposalDraft` 的 JSON Schema 还包含两类动态 records：action 的 `arguments` 和
observation 的 `parameters`。它们的键和值由每个版本化 ActionCatalog 在 OperatingLine 核心中递归
约束，而不是在顶层草案 Schema 中枚举固定属性。OpenAI 的严格 Structured Outputs 只支持 JSON
Schema 的一个子集，因此当前动态结构不能直接作为厂商 strict schema，同时保持既有跨 adapter 合约。

相关官方文档：

- [OpenAI Responses API 指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [OpenAI Structured Outputs 指南](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API 数据控制与保留](https://developers.openai.com/api/docs/guides/your-data)

## 决策

新增可选 workspace package `@operatingline/openai-planner-provider`。它实现 ADR 0013 的最小
`PlannerProvider` interface，并使用官方 `openai` JavaScript/TypeScript SDK 调用 Responses API。
创建 provider 时必须显式给出非空 `model`；调用方直接给出 API Key，或使用明确读取环境变量的工厂。
插件不内置默认模型，也不让通用 generate wire request 携带模型或凭据。

Provider descriptor 使用独立 identity（默认包含显式模型），并固定披露：

- `executionLocation: remote`；
- `dataTransmission: provider_managed`；
- `credentialManagement: provider_managed`；
- 单 provider 最大并发为 1。

Descriptor 不包含 API Key。缺少凭据时 provider 可被构造为 `not_configured`，但不能执行生成。

每次 `generate` 把 packet 的确定性 `renderedPrompt` 作为 Responses input，并固定请求策略：

```text
model: explicitly configured model
input: packet.renderedPrompt
baseURL: https://api.openai.com/v1 unless explicitly overridden in provider options
store: false
stream: false
max_output_tokens: 32768
text.format.type: json_object
SDK maxRetries: 0
SDK logLevel: off
SDK request signal: coordinator AbortSignal
```

固定输出上限避免让一个计划请求使用模型的全部输出窗口。`maxRetries: 0` 保留 ADR 0013 的显式
at-most-once request ID 与重试语义，避免厂商 SDK 在核心不知情时重发可能计费的请求。
`AbortSignal` 允许 runtime 超时或关闭时协作取消 SDK 请求；它仍不是远端强制终止保证。插件拒绝
refusal、incomplete、非 completed 状态和不可解析 JSON，并只向核心返回解析后的未知值或清洗后的
稳定插件错误，不暴露厂商原始错误。

Provider 必须显式传入 SDK 的 endpoint、organization、project、日志级别和默认 header 边界，不能让
`OPENAI_BASE_URL`、`OPENAI_ORG_ID`、`OPENAI_PROJECT_ID`、`OPENAI_CUSTOM_HEADERS` 或 `OPENAI_LOG`
静默改变数据接收方、请求 header 或日志内容。默认 endpoint 固定为官方
`https://api.openai.com/v1`；只有调用方代码明确给出 `baseURL` 才允许改写，且该调用方负责把新的远端
接收方反映到 provider identity、授权和用户披露中。

## JSON Object mode 与验证权威

插件选择 JSON Object mode，而不是把当前草案 Schema 声称为 OpenAI strict Structured Outputs schema。
原因不是放宽 OperatingLine 的信任边界，而是保持 action/observation records 由目标 ActionCatalog
动态约束的现有协议。JSON Object mode 只提供“厂商输出一个 JSON object”的格式约束，不证明字段、
identity、action 参数或规划质量正确。

返回值继续完整经过 Orchestrator 的权威边界：

1. 输出大小限制与严格 `PlanningProposalDraft` 解析；
2. packet 的 adapter、catalog、goal、Plan ID、revision 等不可变 identity 核对；
3. 目标 ActionCatalog 对嵌套 action arguments 的递归校验；
4. 确定性规划质量门；
5. 固定 `proposalCreated: false` 的 generation result。

因此即使 provider 返回 `status: ready`，也不会创建 GuideProposal、投递 Companion、修改 Blender 或
执行节点。调用方必须检查草案与质量报告，另行显式调用 `operatingline.guide.propose`，并等待宿主内
用户接受。

## Opt-in composition root

新增独立 `services/openai-runtime`，通过根脚本 `pnpm dev:openai` 启动。它要求：

- `OPERATINGLINE_ACCESS_TOKEN`；
- `OPENAI_API_KEY`；
- `OPERATINGLINE_OPENAI_MODEL`。

该入口把 Blender ActionCatalog 和一个 OpenAI provider 显式传给 `startRuntime`。默认 `pnpm dev` 继续
使用原 standalone composition root：provider registry 为空，不导入厂商 SDK、不读取
`OPENAI_API_KEY`，也不自动调用模型。两条入口共享同一个通用 MCP/HTTP provider list/generate 契约与
核心验证路径。

## 数据与凭据边界

显式 generate 会把 Planner Packet 的自然语言目标、Companion 状态、完整 ActionCatalog 和规划约束
发送给 OpenAI，并可能产生费用。`store: false` 关闭该 Responses 请求的应用状态存储，但不能单独写成
“零保留”或“不会记录”：OpenAI 的 abuse-monitoring retention、组织级 Zero Data Retention/Modified
Abuse Monitoring 和适用例外仍以其数据控制文档与账户配置为准。

OperatingLine 核心不记录 API Key、OpenAI 原始响应或原始错误。成功后经过严格解析的草案、确定性质量
报告和 generation 事件仍会进入未自动脱敏的 Eval 证据；分享、上传或训练前必须审查并取得授权。

## 未选择的方案

- **把 OpenAI SDK 加入默认 Orchestrator standalone**：会扩大默认供应链与秘密读取面，并把远端发送
  变成容易误触的默认能力。
- **隐式选择一个模型或第一个可用 provider**：会在没有调用方明确决定时改变费用、数据传输和行为。
- **启用 SDK 自动重试**：会绕过核心 request ID 的显式重试和不确定终态处理。
- **把动态 record Schema 强塞进 strict Structured Outputs**：会误报厂商保证，或迫使通用协议复制
  adapter-specific 动态参数结构。
- **相信 JSON Object mode 已完成验证**：JSON 可解析不等于符合 GuideProposal、catalog 或质量要求。
- **生成后自动调用 `guide.propose`**：会混淆厂商调用成功、核心验证和人工审批三个独立状态转换。

## 后果与后续

- 仓库现在有一个真实厂商 provider，可验证 ADR 0013 的显式选择、数据披露、取消、错误清洗和核心
  严格校验边界；其他厂商仍可独立实现同一 SDK contract。
- Provider 使用远端 OpenAI 服务并由 provider 管理凭据与传输；进程内插件边界仍不是安全沙箱。
- 现有单元和 mock-client 测试验证请求形状、`store: false`、`maxRetries: 0`、signal、响应提取、错误清洗
  与 runtime 配置；没有真实 API Key 的自动化测试不得宣称验证了 live 模型可用性、质量或账户数据控制。
- 首个厂商插件完成不等于任意自然语言目标已可靠。更大的人工标注目标数据集、节点聊天/本地 replan
  接线、Proposal 自动化和语义评分治理都不属于本决策。
