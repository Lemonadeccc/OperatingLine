# ADR 0043：不可变 ProcedureTree 资料库

- 状态：已接受
- 日期：2026-08-14

## 背景

ProcedureTree 1.0 已能保存来源证据、分层步骤及参数化的语义、菜单、快捷键和 MCP 轨迹，并可只读编译为
GuidePlan。但只接受一次性请求不能形成可积累、可检索、可用于后续人工验证和 RAG 的知识库；若只把完整树
写进通用事件流，精确版本读取、最新版本查询、分页和并发写入约束都需要反复扫描历史，也无法由数据库唯一键
保护不可变性。

## 决策

Persistence schema 12 新增专用 `procedure_trees` 表。每条记录以 `(tree_id, revision)` 唯一标识，保存
树的规范 JSON、宿主与目录身份、全局存储 sequence、时间和内容 SHA-256。内容哈希使用
`operatingline-json-value-v1` 规范编码，读取完整记录时重新解析 ProcedureTree、核对冗余元数据并重算哈希；
列表只返回经过严格 Schema 校验的摘要，不复制完整树。

同一 ID 和 revision 的完全相同内容为幂等 duplicate；内容不同为 conflict。新 revision 必须大于该 ID
当前最大 revision，历史空档中的迟到写入为 stale；revision 不要求连续，以允许导入已有版本历史。同一 tree
ID 的 adapter 身份不得改变，但 ActionCatalog、InteractionCatalog 和 host range 可在更新的 revision 中
随真实宿主验证升级。写入和 `procedure.tree.stored` 审计事件位于同一 `BEGIN IMMEDIATE` 事务，并发相同
写入只能得到一次 accepted 和其余 duplicate；审计写入失败会回滚资料记录。

Runtime 在存储前执行与 `operatingline.procedure.compile` 相同的完整门禁：ProcedureTree 图与轨迹结构、
精确已安装 ActionCatalog、host range 包含关系、编译后的 GuidePlan 结构和 action 参数均须通过。新增 MCP
`operatingline.procedure.store/get/list`，以及 HTTP `POST /api/v1/procedure/store`、
`GET /api/v1/procedure`、`GET /api/v1/procedures`。列表采用单调 sequence 游标和上限 100 的分页；get 未指定
revision 时返回最新版本。

## 兼容性与后果

存储只建立本地知识资料，不发布 GuidePlan、不创建 Proposal、不接受计划，也不执行 Blender；返回值继续
显式声明 `interactionTracks: structural_only`、`proposalCreated: false` 和
`hostExecutionStarted: false`。读取历史记录不要求对应旧 Catalog 当前仍安装，因此目录升级不会让已保存的
来源知识消失；只有新增 revision 的写入必须通过当前运行时门禁。

资料可能包含用户文本、视频 URI、操作参数和来源权利信息，不能因为进入资料库就自动成为训练数据。
candidate、unavailable、权利不明确或未经双人盲审的数据仍须由后续数据集发布流程排除。该决策也不实现
视频下载/识别、可视化编辑、revision 分支合并、InteractionCatalog 真机验证或 Blender 逐轨迹回放。
