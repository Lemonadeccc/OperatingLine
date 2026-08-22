# ADR 0105：授权 Human Eval 最终发布的原子登记

- 状态：Accepted
- 日期：2026-08-22

## 背景

`eval:release-check` 已能从 artifact-verified、达到 released readiness 的目录确定性构造发布候选，但候选
只证明“这组证据具备被授权的稳定身份”。它既不消费 `DatasetReleaseAuthorization`，也不是最终 released
manifest，更不能授权训练。若先单独记录授权消费、再写 manifest 或完成事件，任一步崩溃都会留下不可恢复
的半发布状态。

## 决策

新增自包含 `HumanEvalReleasedManifest 1.0.0`。它完整嵌入发布候选、已签名
`DatasetReleaseAuthorization` 和服务端 live verifier 产生的 `AuthorityValidationReceipt`，并绑定授权内容、
收据、release projection 与最终 manifest 的规范 SHA-256。候选 license 必须与授权一致，收据必须精确绑定
authorization id、signer、key、内容 hash、candidate target 和 `dataset_release` side effect，且验证时刻必须
位于授权有效期内。最终 manifest 始终保留 `trainingUse: not_authorized`。

正式 finalization 只通过配置了 operator-owned trust source 的 Orchestrator 入口完成。服务端先重新计算候选
legacy integrity，再即时验证签名、角色、时效、撤销状态、目标与完整 release binding；客户端不能提交历史
收据。验证成功后，专用 SQLite `BEGIN IMMEDIATE` 事务一次写入：

1. `dataset_release_authorization_consumed`；
2. 规范 manifest/receipt 原文与 operation、authorization、binding、semantic single-use 索引；
3. `dataset_release_completed`，其 `durableReceiptSha256` 等于最终 manifest hash。

同一 operation、candidate、authorization 内容与 release binding 的重试永久返回首次保存的 manifest，不重新
执行 live revocation check；这是已完成历史事实的幂等读取，不代表新的分发授权。相同 authority 的不同请求、
或不同 authority 对相同 audience/license/redaction/scope 的重复发布均冲突。事务失败则三项记录全部回滚。

## 后果与边界

- verifier 与 SQLite 无法共享一个事务；实现采用“即时 live verify 后立刻单事务登记”的最小窗口，且不配置
  独立 receipt sink，避免出现已持久化但没有 release 的孤立收据。
- 已完成后授权过期或被撤销不会改写历史 manifest。撤回、再次分发和远端发布需要未来独立协议。
- endpoint 只登记本地 durable release；不上传 artifact、不公开分发、不向收件人投递，也不持有签名私钥。
- `TrainingUseAuthorization` 必须另行签发，并精确指向最终 released manifest hash；candidate hash 不能作为
  training target。
- 当前默认 Human Eval fixture 仍没有真实 Provider Run 或真人盲审，因此不会因为此能力而自动产生正式数据集。

## 验证计划

- 协议：candidate/auth/receipt/release/hash equality chain、有效期、严格 request/response 与训练隔离。
- 持久化：故障注入三写回滚、两个连接并发、旧事件约束迁移、重启幂等与所有冲突类别。
- coordinator：candidate mutation 在 live verify 前拒绝、错误或撤销收据零写入、存储篡改检测、精确重试
  跳过再次验证，以及 candidate hash 无法通过 training gate。
- HTTP：Bearer 认证、未配置 503、无效请求 400、授权冲突 409、真实 Ed25519 created 与
  `already_completed` 重试。
