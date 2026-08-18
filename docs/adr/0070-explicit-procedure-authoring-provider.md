# ADR 0070：显式 ProcedureTree Provider 编写闭环

- 状态：Accepted
- 日期：2026-08-18

## 背景

ProcedureAuthoringPromptPacket 已把自然语言目标、固定来源证据、tree identity、精确
ActionCatalog/InteractionCatalog 和 candidate-only 响应合同绑定在一个不可变 packet 中，但此前只有 MCP
宿主模型或人工调用方能消费它。Runtime 没有可选 Provider coordinator，因此配置在同一 composition root
中的 Provider 只能生成 GuidePlan 或 local replan，不能直接生成完整 ProcedureTree。

把 Procedure 生成伪装成初始 Plan `generate()` 会混淆输出合同、幂等 operation、运行证据和 Eval 语义；把
Provider 输出直接保存或物化则会绕过 candidate-only、packet identity 和人工治理边界。

## 决策

Planner Provider SDK 增加可选 `authorProcedure()` 能力。内置 OpenAI Responses、Codex CLI 与 Claude Code
CLI composition provider 都将服务端生成的完整 packet 规范编码为唯一输入，并继续使用各自已有的非流式
JSON、取消、输出上限、凭据隔离和错误清洗边界。

Runtime 新增：

- MCP `operatingline.procedure.authoring.providers.list`；
- MCP `operatingline.procedure.authoring.generate`；
- HTTP `GET /api/v1/procedure/authoring/providers`；
- HTTP `POST /api/v1/procedure/authoring/generate`。

调用必须显式给出 `providerId` 与 UUID `requestId`。Coordinator 先按请求构建精确 packet，再持久化
requested evidence，之后才标记外部调用已发生。返回值先经过输出大小/JSON 清洗和严格 candidate Schema，
再核对 packet-bound identity、来源、目录快照并执行完整 ProcedureTree compile。任一环节失败都不会返回局部
树。

结果包含完整 packet、candidate tree、确定性 validation/compilation、Provider identity 与 side-effect 声明。
`modelCalled` 固定为 true；`procedureStored`、`proposalCreated` 和 `hostExecutionStarted` 固定为 false。

## 幂等、恢复与证据

Procedure authoring 复用统一 Provider invocation manager 的超时、全局/单 Provider 并发、同 tree key 冲突、
关闭取消和 request fingerprint 规则。Runtime 持久化
`procedure.authoring.provider.generation.requested/completed/failed`；重启时从 completed evidence 恢复同一结果，
从 requested/failed evidence 恢复“已尝试”状态，避免未知外部结果被自动重试和重复计费。

若 Provider 暴露 runtime treatment，requested/completed 事件同时保存 treatment/output attestation。Procedure
使用独立的 `procedure_authoring` attestation Schema，不扩宽只接受 `initial_plan/local_replan` 的既有 Provider
Eval 合同。

## 安全与信任边界

- Provider 列表公开传输位置、凭据管理和并发披露，但不包含凭据。
- 只有显式 generate 调用模型；prompt.get、validate、materialize 和 compile 继续不调用模型。
- Provider 输出始终是不可信 candidate，不能声明 verified host version 或 available menu/shortcut/MCP track。
- 成功生成不保存树。调用方审阅后必须显式调用 store；物化、Proposal、审批与 Blender 执行仍是后续独立动作。
- 完整 packet 可能包含用户目标和目录内容；远端调用可能产生费用，必须由调用方依据 Provider disclosure 授权。

## 未选择方案

- **复用 initial-plan `generate()` operation**：会把 ProcedureTree 输出冒充 PlanningProposalDraft，并污染恢复与
  Eval 证据。
- **生成后自动 store/materialize/propose**：会把模型输出越级提升为知识、grounding 或可执行计划。
- **把精确结构检索写成 RAG**：当前仍没有 embedding、相似度评分或语义召回。

## 后续

该闭环完成“一句话 → 经严格验证的完整 candidate ProcedureTree”的显式 Provider 路径，但不包含语义 RAG、
流式 Procedure 对话、自动局部树重规划、教学视频抽取、可视化编辑、训练集发布或 Blender 轨迹执行。
