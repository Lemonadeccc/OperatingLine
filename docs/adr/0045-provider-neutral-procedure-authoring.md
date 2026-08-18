# ADR 0045：供应商无关的 ProcedureTree 编写 Packet

- 状态：已接受
- 日期：2026-08-14

## 背景

ProcedureTree 已能表达来源、分层步骤、精确参数和对齐的语义、菜单、快捷键与 MCP 轨迹，也已有不可变
资料库、精确操作检索和只读编译入口。但自然语言目标尚无统一的模型交接契约：若 MCP 客户端自行拼接
ActionCatalog、InteractionCatalog、历史操作和输出格式，不同客户端容易丢失目录版本、让不同树的来源 ID
冲突、把未验证轨迹写成 available，或把生成候选误认为已验证、已保存或可执行内容。

这一边界不能被描述为完整的 Provider/RAG 流程。当前检索只有精确结构 selector，没有 embedding、相似度
评分或语义召回；Runtime 也不应因生成一个 prompt 而选择模型、传输数据、持久化 ProcedureTree、创建
Proposal 或启动宿主动作。

## 决策

协议新增 `ProcedureAuthoringPromptPacket 1.0.0`。请求绑定目标 adapter、自然语言 goal、稳定 tree ID、
正整数 revision，以及可选的精确 ActionCatalog、InteractionCatalog 版本和 locale。Runtime 先选择精确
ActionCatalog，再选择与该 action 版本精确绑定的 InteractionCatalog；调用方未指定版本时，各注册表选择
可用的最新版本。目录未安装、身份不一致，或 InteractionCatalog 的宿主/adapter 范围超出 ActionCatalog
时失败。Packet 使用无重复身份字段的规范化 catalog binding，使公开 Zod 与 JSON Schema 不依赖 sibling
字段相等这类 JSON Schema 无法表达的关系。

MCP `operatingline.procedure.prompt.get` 与 HTTP `POST /api/v1/procedure/prompt` 返回同一个版本化 packet。
Packet 包含可无损还原且精确绑定的两份目录、按 tree ID/revision 命名空间化的自然语言 goal provenance、
候选响应 JSON Schema 和确定性工作流规则；不再把这些字段复制进第二份 rendered prompt。响应契约固定
tree ID、revision、adapter、目录版本、宿主范围及 goal source/evidence；每个生成 leaf 必须为
`candidate`，`validatedHostVersions` 必须为空，菜单、快捷键和 MCP 轨迹必须全部为 `unavailable`。
Packet content 使用 `operatingline-json-value-v1` canonicalization 和 SHA-256 封装，并对整个 packet 设置
256 KiB canonical 大小上限，超过时 fail closed。

当前 MCP 客户端的宿主模型消费 packet。它可以先用 `operatingline.procedure.search` 的精确结构 selector
查找带来源的 grounding 候选，但本阶段只生成层级、语义 operation 和 Action 参数；目录配方或检索结果
不能由模型直接晋升成 available 交互轨迹。具体名称、位置、缩放等值保留在实际应用它们的语义 operation
和 Action arguments 上。候选随后必须连同原 packet 提交给 MCP
`operatingline.procedure.authoring.validate` 或 HTTP `POST /api/v1/procedure/authoring/validate`。服务端重算
packet digest，再按 packet 中的精确版本从已安装 registry 重建 expected packet；即使客户端篡改内容后重新
计算了自洽 digest，也会因目录/工作流/响应契约快照不同而失败。验证器还固定 candidate identity 与 goal
provenance，并复用既有 compile 做结构与 ActionCatalog 校验。单独调用通用 compile 不构成 authoring 验证。

## 兼容性与后果

该入口是只读交接协议，不调用模型或 Provider，不自动保存 ProcedureTree，不创建、发布或接受 Proposal，
也不启动宿主执行。保存仍要求用户审阅后显式调用 `operatingline.procedure.store`；packet-bound validation
不把 candidate 自动晋升为 verified，也不把 unavailable 轨迹物化成 available。通用 compile 仍只验证
现有 ProcedureTree 和 ActionCatalog 边界，以保留手工或未来确定性物化流程的兼容性。

该决策不实现完整的 `provider.generateProcedure` coordinator、向量或语义 RAG、教学视频下载/识别、
ProcedureTree 可视化编辑器、确定性交互 grounding/materialization、真实 Blender 逐叶回放、验证状态写回，
或训练/RAG 数据集导出。它只统一当前 MCP 宿主模型从一句自然语言目标开始编写候选树时使用的上下文、
目录身份、输出契约和安全工作流。

Packet 当前仍是自包含目录快照，虽已消除 rendered prompt 副本并设置硬上限，体积仍会随 Blender 覆盖面
线性增长。后续 coordinator 应以目录 version + digest 锁定快照，并只把确定性选择的 action/recipe 子集
物化进模型上下文，同时保留显式获取完整目录的接口；该变更需要新的 packet 版本，不能静默改变 v1 digest。

后续 [ADR 0075](0075-evidence-bound-tutorial-transcript-authoring.md) 保留本决策的目标专用 `1.0.0`，并用
`1.1.0` 单独增加权利状态明确、调用方提供字幕分段的教程 provenance；它仍不下载或自动识别视频。
