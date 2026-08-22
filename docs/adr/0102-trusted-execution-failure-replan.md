# ADR 0102：可信执行失败后的确定性重规划候选

- 状态：Accepted
- 日期：2026-08-21

## 背景

Runtime 已能持久化 managed action 的终态失败、强 Observation 报告和失败恢复 attestation，也已有一个
只接受 `requestId` 的失败重规划推导内核。但该内核此前没有生产接线，测试 resolver 可以直接提供目录、
候选参数和策略轨迹，因此不能证明候选来自真实不可变回放证据，也不能安全地用于自动流程。

action 失败本身也不足以授权重规划。报告仍可能处于保留修复状态、原生回退失败或恢复未完成；在这些状态
下生成甚至执行另一条操作会混合两个未决宿主状态。

## 决策

Runtime 只在 `procedure.replay.failure-recovery.finalize` 已持久化或识别出完全相同的
`automatically_rolled_back` attestation 后尝试自动派生候选。生产 resolver 从本地持久层重新读取全部权威
输入，并要求以下身份唯一一致：

- terminal `blender.action-execution.completed` 必须为 `failed`，且唯一匹配 replay、execution、Plan
  id/revision/content hash、step、Action、Proposal 和 failure report id/sequence；
- replay binding 与 attestation 的完整性 hash 必须一致；
- binding 内嵌 ActionCatalog/InteractionCatalog 必须与当前安装的精确版本和完整内容一致；
- failure report 必须是同一 action result 引用的强失败报告，attestation 必须证明原步骤已自动回退。

参数候选不读取公开请求或 Companion 提议。服务端固定策略只处理目录中可验证的标量数值和 enum 参数，排除
id/name，并将完整参数重新通过 ActionCatalog schema；数值候选只生成受上下界约束的 `0.5x/1.5x`，enum
只生成目录声明的其它值。策略切换只读取同一 materialized leaf：当前轨迹必须是唯一可用 MCP track，备用
menu/shortcut 还必须携带 `proofExecution`。证据需要 UUID 的旧内核字段使用权威内容 hash 确定性派生，禁止
随机或调用方提供的 receipt identity。

候选通过 `procedure.execution-failure-replan.completed` 追加一次并可在重启时恢复。启动时 Runtime 扫描完整
的、当前可解析的终态失败和自动回滚证明，幂等补齐可能在 attestation 落盘后、候选事件落盘前中断的记录。
公开面只有只读的 `operatingline.procedure.failure-replan.get` 和
`GET /api/v1/procedure/failure-replan?requestId=...`；不存在公开 derive 操作，也不接受 evidence、目录、参数或
策略。

## 安全边界

- 自动阶段只保存 `pending` 候选或无候选结果，不创建或接受 GuideProposal，不排队 Blender action。
- 自动阶段不调用 Provider；`semanticCandidate` 固定为 `null`。
- `recovered_after_repair`、缺失/歧义终态、目录漂移、身份不一致及未完成恢复都不生成记录。
- 参数调整和策略轨迹只是待审候选，不证明其语义正确、已被采用或已执行。
- 后续若要把候选转为 GuideProposal，必须增加绑定候选 hash、基线、过期时间和人工身份的一次性审查事务；
  语义重规划必须复用签名、单次消费的 Provider authority，并继续经过 locality、质量和人工接受门。

## 结果

真实 action Observation 失败并成功自动回退后，Runtime 能在不接收调用方策略、不调用外部 Provider、
不改变 Blender 场景的前提下，确定性给出一个参数修复或 proof-backed 同叶策略候选。旧式仅报告的 failure
attestation 仍可持久化，但不会被误当成 action execution，也不会产生伪造候选。
