# ADR 0095：零基线 ProcedureTree 身份分配与候选生成

- 状态：Accepted
- 日期：2026-08-20

## 背景

现有 Procedure authoring Provider 已能从自然语言生成严格 candidate，但公开请求要求调用方预先给出
`treeId` 和 revision。已有 semantic retrieval 又只能检索已存 immutable tree 的 verified leaves。因此一个只会
描述目标、尚无任何树身份的调用方，不能安全地启动真正的 revision 1 工作流；把随机 id 留给客户端也无法在
Runtime 崩溃后证明同一请求恢复了同一棵树。

## 决策

新增零基线生成协议和 coordinator。请求必须包含 UUID `requestId`、目标、locale、精确 ActionCatalog 与
InteractionCatalog 版本，以及从当前 Procedure author Provider 列表原样复制的 available descriptor。调用方还
必须明确确认 Provider 输入传输和可能费用。Runtime 在写任何事件或调用 Provider 前，将该 descriptor 与当前
注册 Provider 的完整披露逐字节规范化比对；未配置、不可用或任一 data-handling/limit/description 字段漂移均
失败关闭。

树身份由完整授权请求的 SHA-256 fingerprint 通过固定 domain separator 派生为 RFC variant 的 UUIDv8，revision
固定为 1。该策略是项目自定义的确定性 UUIDv8，不冒充 UUIDv5 namespace。相同 request id 与相同输入恢复同一
tree id；相同 request id 的不同输入冲突。

coordinator 先持久化 `procedure.zero-baseline.generation.requested`，再复用既有 Procedure authoring generation
coordinator。底层继续负责 Provider 调用、输出清洗、candidate Schema、目录身份与 compile 门禁。成功后外层
持久化 `procedure.zero-baseline.generation.completed`。若 Runtime 在底层 generation 已完成、外层 completion 尚未
写入之间崩溃，恢复会先读取底层完成结果，重新验证全部身份并只补写外层 completion；即使 Provider 已下线也不
会再次调用。只有已有可信 zero-baseline requested evidence 时才允许接管底层结果。

公开入口为 MCP `operatingline.procedure.authoring.zero-baseline.generate` 与 HTTP
`POST /api/v1/procedure/authoring/zero-baseline/generate`。结果明确记录 `retrieval.status=not_used`，因为零基线没有
可绑定的 existing-tree retrieval receipt。它只返回 revision-1 candidate，不存树、不创建或接受 Proposal，也不
执行宿主。

## 结果

自然语言调用方不再需要自行发明 tree identity，并获得跨并发、重放和崩溃恢复稳定的第一版候选树。该能力不是
semantic RAG，也不把 candidate 提升为 verified knowledge；后续仍需人工审阅、目录 materialization 和显式
store。
