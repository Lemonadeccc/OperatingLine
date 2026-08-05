# ADR 0013：显式 Planner Provider 进程内插件边界

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0012 已把精确 PlanningContext、ActionCatalog、严格输出 Schema 和
`evaluate → propose` 规则组合成供应商无关 Planner Packet。Codex、Claude 或其他 MCP 客户端可在
自己的模型与授权边界中消费 packet，但某些嵌入场景也需要由 OperatingLine runtime 调用一个可选
规划器。

直接把模型 SDK、API Key、默认供应商或自动发送策略写进核心，会混淆以下责任：谁选择模型、谁授权
传输用户目标和宿主状态、谁承担费用、谁保存凭据，以及模型生成是否已经获得宿主执行授权。动态扫描
任意本地模块还会扩大默认 standalone 的供应链与秘密读取面。生成调用也可能超时、重启或只完成远端
副作用；盲目重试会造成重复费用。

## 决策

定义版本化 Planner Provider 公共协议和一个独立最小 SDK。Provider 只能由嵌入
`startRuntime` 的 composition root 通过 `plannerProviders` 显式传入。默认 standalone 不读取 provider
配置、API Key、endpoint 或任意模块，因此保持 provider-free。

```text
MCP/HTTP caller
  │ explicit providerId + UUID requestId + PlanningPromptRequest fields
  ▼
PlannerGenerationCoordinator
  ├─ build exact PlanningPromptPacket
  ├─ persist requested evidence
  └─ provider.generate({ requestId, packet, signal })
                │
                ▼
       untrusted unknown output
                │
                ▼
strict draft schema + immutable identity + recursive ActionCatalog + quality gate
                │
                ▼
PlannerGenerationResult { status, draft, planningQuality, proposalCreated: false }
                │ separate explicit operatingline.guide.propose
                ▼
GuideProposal → in-host Accept/Reject → possible execution
```

公共入口为：

- MCP `operatingline.planner.providers.list` 与 HTTP `GET /api/v1/planner/providers`；
- MCP `operatingline.planner.generate` 与 HTTP `POST /api/v1/planner/generate`。

核心从不自动选择 provider。每次 generate 必须明确给出 `providerId` 与 UUID `requestId`。公开 descriptor
使用契约 `1.0.0`，披露 identity、版本、可用性、最大并发、执行位置、是否由 provider 管理数据传输，
并固定声明凭据由 provider 管理；`local` 只能配 `dataTransmission: none`，`remote` 只能配
`provider_managed`，避免远端执行被误报为不传输。Descriptor 和 wire request 不允许携带秘密、厂商
endpoint 或模型参数。具体插件拥有供应商客户端、凭据读取、网络、费用策略和准确的数据处理说明。

SDK 只定义：

- 一个严格公开 descriptor；
- `generate({ requestId, packet, signal }): Promise<unknown>`；
- 可选 `close()` 生命周期。

返回类型为 `unknown`，防止 TypeScript 类型被误当信任边界。核心保留严格解析的 canonical packet，
只把结构化克隆交给插件，避免同进程插件修改后续 identity/catalog 校验基线；它先限制 JSON 输出为
2 MiB，再解析
严格 `PlanningProposalDraft`，核对 target adapter、catalog、goal、Plan protocol/id/revision 等 packet
identity，递归验证 ActionCatalog 参数，并运行与 Proposal 路径相同的确定性规划质量门。无质量 error
时状态为 `ready`，否则为 `needs_revision`；两者都携带 `proposalCreated: false`。Generate 不调用
`guide.propose`、不投递 Companion、不修改 Blender。调用方必须另行显式提交 Proposal，后者仍经过
最新 revision、完整校验和宿主内人工接受门禁。

## 调用、并发与重试语义

运行时默认 provider 超时为 60 秒，配置上限为 120 秒；全局最多 4 个生成，同一 provider 还受其
1–8 的 descriptor 并发上限约束，同一 `adapter + planId` 同时只运行一个生成。Provider 收到
`AbortSignal`；关闭 runtime 会停止接收新调用、触发所有 signal、等待协调器调用收敛，再并行调用每个
插件的 `close()`。Close Promise 默认最多等待 5 秒，超时和异常都只返回不含插件原始错误的清洗信息，
并继续关闭其他插件。

取消是协作式的。插件或上游 SDK 忽略 signal 时，远端工作可能在核心已经返回超时或停止错误后继续；
当前进程内契约无法强制终止第三方网络调用。

`requestId` 提供持久化 at-most-once 调用边界：

- 相同 ID、相同内容的并发请求共享一个进行中 Promise；不同内容是 conflict。
- 已完成请求写入完整 validated result，重启后相同请求可直接重放，不再次调用 provider。
- 已经失败、超时，或重启时只有 requested 证据的 ID 视为已尝试/状态不确定，不自动调用 provider。
  调用方确认后使用新 UUID 显式重试。

这会牺牲“同一个 ID 自动恢复”的便利，换取不静默重复费用或供应商侧副作用。

公开错误不用含糊的布尔重试标志，而使用 `retryMode`：`same_request_id` 表示尚未调用 provider、可在
条件改变后复用原请求；`new_request_id` 表示 provider 已开始或旧 ID 已进入确定/不确定终态；`never`
表示修正输入或配置前不应重试。MCP 在 tool handler 之前发现的畸形参数仍由 MCP transport 作为
`InvalidParams` 拒绝；一旦严格请求进入 generation handler，MCP 与 HTTP 使用同一稳定错误对象。

## 数据与安全边界

Generate 可能把自然语言目标、Companion 状态、完整 ActionCatalog 和计划约束发送到远端并产生费用。
Provider descriptor 只披露行为，不构成用户同意；调用方在选择 provider 和发起 generate 前负责授权。

进程内插件与 Orchestrator 共享进程权限和内存，因此不是凭据或恶意代码的强隔离边界。核心不读取、
记录或返回 provider 凭据，不持久化原始 provider 响应、原始错误或私有模型推理，并把公开失败映射为
稳定的清洗后错误码。未来如需处理不受信任插件或更强秘密隔离，可在保持公共 descriptor/request/result
契约的前提下增加独立进程或 IPC transport。

协调器会把 `planning.provider.generation.requested`、`.completed` 和 `.failed` 写入追加式事件账本。
Completed 证据包含经过严格解析的草案与质量报告，以支持重放和 Eval；因此即使不保存原始响应，成功
草案仍可能包含敏感目标与参数。Eval 继续标记 `redaction: none`，分享、上传或训练前必须审核并取得
授权。

Runtime 启动时通过 `(event_type, sequence)` 索引只读取上述三类 generation 证据来恢复 request-id
状态；不会为了 provider 幂等恢复而物化全部 Eval 历史。完整事件账本仅在调用方显式请求 Eval 导出时
分页读取。

## 未选择的方案

- **核心直接集成某一家模型 SDK**：会把供应商、凭据和发布周期绑定到通用协议服务。
- **自动选择“第一个可用”provider**：会在没有明确调用方决定时改变数据传输、费用和模型行为。
- **从环境变量动态导入插件**：使默认 standalone 隐式执行任意模块并读取凭据，难以审计。
- **生成后自动调用 `guide.propose`**：会把模型调用成功混同为已创建可审批 Proposal，并绕过调用方对
  质量报告与草案的明确检查。
- **失败后用同一 request ID 自动重试**：无法证明远端是否已经计费或产生副作用。
- **把进程内 interface 宣称为沙箱**：接口边界不能限制同进程代码的权限。
- **保存原始响应和 chain-of-thought**：不是执行、审查或确定性 Eval 所需事实，并扩大敏感数据面。

## 后果与后续

- 嵌入方现在可以在不修改核心协议的情况下接入显式 provider；MCP/HTTP 消费者获得一致的列举、生成、
  错误和证据语义。
- 严格验证只能证明草案符合当前机器可表达的结构、目录与 identity 约束，不能证明自然语言语义完整、
  结果美观或 provider 本身可信。
- 仓库当前没有任何具体厂商插件；provider 配置、秘密存储、外部 SDK 选择和发布仍需独立实现与审查。
- 节点聊天引用接入 provider、局部重规划、人工语义数据集/评分治理和第二软件宿主仍是后续里程碑。
