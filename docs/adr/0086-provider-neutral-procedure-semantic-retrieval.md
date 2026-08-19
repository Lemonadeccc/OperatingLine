# ADR 0086：Provider-neutral ProcedureTree 语义检索与 RAG 上下文

- 状态：已接受
- 日期：2026-08-19

## 背景

ProcedureTree 资料库已经把 semantic、菜单、快捷键和 MCP operation 建成精确结构索引，但该索引只接受
AND 组合的已知字段，不会把自然语言目标与相近操作做语义匹配。直接把 Provider 返回的相似度或一个不透明
向量库当作事实，又会丢失精确树 revision、目录、叶节点验证状态和实际发送给 Provider 的语料证据。

## 决策

新增独立的 `ProcedureSemanticRetrieval 1.0.0`，保留原有 `operatingline.procedure.search` 的精确语义，
另提供：

- MCP `operatingline.procedure.semantic.providers.list` 与
  `operatingline.procedure.semantic.search`；
- HTTP `GET /api/v1/procedure/semantic/providers` 与
  `POST /api/v1/procedure/semantic/search`。

调用方必须先读取可用 Provider 的完整 disclosure，其中结构化包含 descriptor、embedding model、API/runtime
settings、数据处理和 cost policy；再在一个新 request UUID 中原样提交该快照、自然语言 query、过滤器、
`topK`、最低 cosine 分数，并逐项确认已审阅这些披露。Runtime 在任何可能计费的调用前重新生成 live
disclosure，任一模型、端点、参数、费用策略或 descriptor 漂移都会 fail closed。默认只检索 `verified` 叶节点；
调用方可显式选择其他 validation 状态，但结果始终保留真实状态，不把 candidate 或 rejected 命中升级为
训练真值。

Runtime 只选择每棵已存树的 latest immutable revision，按 adapter、ActionCatalog、InteractionCatalog 和
validation 过滤后，稳定投影最多 256 个叶节点文档。文档包含 tree identity、节点路径、leaf intent、Action、
semantic operations 和 available 菜单/快捷键/MCP 轨迹；不包含 source 或 evidence 原文。任一文档超过固定
上限或过滤后的语料超过 256 个叶节点时 fail closed，不静默截断语料。

一次显式调用把 query 与有界文档批量交给所选 embedding Provider。Provider SDK 的可选
`embedProcedure()` 与 runtime treatment 必须同时存在；OpenAI composition root 只有在额外设置明确的
`OPERATINGLINE_OPENAI_EMBEDDING_MODEL` 时才公布该能力，并使用 Embeddings API 的 float 编码、关闭 SDK
重试并传递 `AbortSignal`。用于规划的 Responses model 与 embedding model 相互独立。

核心 Runtime 严格校验向量数量、统一维度、有限数值和非零范数，自行计算 cosine，相同分数按稳定
tree/revision/path/leaf identity 排序。Provider 不决定排名。公开结果不含向量，而是返回 rank、cosine、
document SHA-256、完整 tree summary、节点路径、leaf，以及 query、语料、批次、Provider descriptor、模型、
generation settings 和原始向量输出的内容摘要。只有至少一个命中时 `ragContextProduced=true`。

## 证据、幂等与恢复

在任何可能计费的 embedding 调用前，Runtime 先持久化 requested evidence，绑定 request fingerprint、query
SHA-256、语料 SHA-256、实际输入批次 SHA-256、完整 Provider descriptor/treatment/cost policy、过滤器和授权摘要；事件不保存 query
原文或向量。完成事件保存无向量结果及其内容摘要，失败事件只保存清洗后的错误。

同 request ID 和同 fingerprint 在进程内或重启后返回同一 completed result；不同输入冲突。只存在 requested
或 failed evidence 表示外部调用已经发生或结果不确定，Runtime 不自动重放。恢复时严格检查事件 ID、唯一
requested/terminal 顺序和全部内容摘要，损坏证据 fail closed。

## 后果与边界

- 这是实际 embedding cosine 检索，不把关键词筛选伪装为语义召回；原精确搜索仍不产生 similarity score。
- 返回命中可作为后续 RAG context，但本入口不调用 Procedure authoring/refinement Provider，不保存新树、
  创建 Proposal、执行 Blender 或发布训练数据。
- 第一版执行 bounded live batch embedding，不提供持久向量缓存、ANN、自动 scope 选择、跨模型向量复用、
  多语言召回保证或 Human Eval 校准。大型资料库必须增加过滤器；持久索引需要另行版本化迁移与失效协议。
- 流式 ProcedureTree 对话和局部 revision 重规划将在独立协议中消费此处的精确 retrieval evidence；GuidePlan
  的既有 dialogue/replan 不能冒充 ProcedureTree 编辑。

## 验证

- 协议与公开 JSON Schema 覆盖授权、默认 verified、Provider/model treatment、语料/批次摘要、排名、零命中
  RAG 状态和无向量结果；
- Provider 单测覆盖显式 embedding model、乱序 OpenAI index、缺失/重复 index、取消、失败和输入上限；
- 协调器单测覆盖 latest revision、过滤、跨 locale 稳定 cosine 排名、语料/文档即时上限、完整 disclosure drift、事件摘要及顺序损坏、
  failed/uncertain at-most-once 和 completed restart；
- HTTP/MCP 集成覆盖 provider discovery、真实 semantic result、默认 verified、无向量输出、查询脱敏和重启
  不重复调用。
