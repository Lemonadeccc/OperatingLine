# ADR 0044：不可变 ProcedureTree 精确操作索引

- 状态：已接受
- 日期：2026-08-14

## 背景

不可变 ProcedureTree 资料库可以按树 ID、revision 和 adapter 分页读取完整树或摘要，但客户端若要寻找
某个语义动作、ActionCatalog action、菜单路径、快捷键或 MCP 工具，仍需读取并扫描每棵树。把这种查询
称为语义检索或给结果附加相似度分数，会掩盖当前系统只拥有结构化事实、没有 embedding 或相关性模型的
边界；直接从检索结果执行宿主动作也会绕过既有编译、Proposal、人工审批和 Observation 门禁。

## 决策

Persistence schema 13 新增规范化的 `procedure_operations` 索引。数据库打开时为已有树补建索引，接受
新 revision 时在保存树和审计事件的同一事务内写入索引；索引记录继续绑定不可变的
`treeId + revision`、树存储 sequence、adapter、leaf、验证状态、ActionCatalog action、轨迹和 operation
身份。语义 operation 总是进入索引；menu、shortcut 和 MCP 只索引 `availability: available` 的轨迹，
不得把 unavailable 缺口作为可检索操作返回。

Runtime 新增 MCP `operatingline.procedure.search` 和 HTTP `POST /api/v1/procedure/search`。请求必须至少
提供一个精确 selector；`revision` 只能与 `treeId` 一起使用。支持的 selector 为 `treeId`、`revision`、
`adapterId`、`leafId`、`operationId`、`modality`、`validationStatus`、`actionName`、`semanticAction`、
`menuTargetHostId`、`menuPath`、`shortcutKeys`、`mcpServerName` 和 `mcpToolName`。多个 selector 以 AND
组合；字符串按完整值相等，`semanticAction` 按完整值成员关系匹配，`menuPath` 和 `shortcutKeys` 按
完整且顺序敏感的数组相等。该接口不做模糊、前缀、全文或向量匹配。

每个结果从原始不可变树重新物化并核对索引一致性，返回树摘要与 SHA-256 完整性、根到 leaf 的
`nodePath`、leaf intent/action/validation、对齐的 semantic actions、轨迹上下文、完整 operation，以及
该 operation 引用的 evidence 和对应 sources。响应固定声明
`matching: exact_structured_filters`、`similarityScoreProduced: false` 和
`hostExecutionStarted: false`。

分页默认 `limit: 50`，公开上限为 100；`afterSequence` 默认 0。只有仍有匹配记录时才返回非空
`nextAfterSequence`，下一页把它原样作为 `afterSequence`。结果中的 `indexSequence` 是
`procedure_operations` 的单调存储游标，只用于稳定分页；它不同于树摘要的存储 `sequence`，也不表示
ProcedureTree 的节点顺序、operation 的 `order` 或依赖安全的执行顺序。客户端展示结构时使用
`nodePath[].order` 和 `operation.order`，执行仍须走独立的轨迹物化、编译与宿主审批流程。

## 兼容性与后果

该索引是现有不可变树的派生读模型，不修改 ProcedureTree `1.0.0`、Guide protocol `1.5.0` 或既有
store/get/list 语义。candidate、verified 和 rejected leaf 均可被精确筛选；检索命中不代表内容已经验证、
适合训练或可以执行。接口不生成 similarity score、不创建 semantic embedding、不下载或解析来源、
不发布 GuidePlan、不创建或接受 Proposal，也不启动宿主执行。
