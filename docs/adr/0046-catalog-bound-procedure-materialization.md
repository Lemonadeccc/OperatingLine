# ADR 0046：目录绑定的 ProcedureTree 确定性物化

- 状态：已接受
- 日期：2026-08-14

## 背景

供应商无关的 Procedure authoring packet 已把自然语言目标、精确 ActionCatalog/InteractionCatalog、tree
identity、来源证据和 candidate-only 输出契约绑定为一个可验证快照。模型生成的 leaf 只能包含语义
operation 和 Action 参数；菜单、快捷键与 MCP 轨迹必须保持 `unavailable`。现有通用 compile 只验证树形
结构与 ActionCatalog 边界，并明确返回 `interactionTracks: structural_only`，因此不能证明某条交互轨迹
来自已安装的版本化配方。

第一步 grounding 需要一个更窄的边界：只把目录明确授权的菜单配方确定性复制到候选树，同时保留候选
状态，不把尚未验证的快捷键、MCP 映射或真实宿主执行写成 available 或 verified。

## 决策

协议新增 `ProcedureAuthoringMaterializationRequest/Result 1.0.0`。MCP
`operatingline.procedure.authoring.materialize` 与 HTTP
`POST /api/v1/procedure/authoring/materialize` 接受完全相同的原始 authoring packet 和 candidate tree。
Orchestrator 先重新执行 packet canonical SHA-256、已安装目录快照、固定 identity/provenance、candidate-only
契约和既有 compile 校验，再从 packet 绑定的已安装 ActionCatalog 与 InteractionCatalog 进行物化。调用方
不能只提交 tree，也不能用单独的通用 compile 代替 packet-bound 校验。

InteractionCatalog 的 recipe 可选择携带封闭的 `procedureMaterialization` 声明。当前可用菜单声明只接受
`source: guidance.native_path`、`semanticBinding: all_leaf_operations` 和
`parameterBinding: accepted_action_arguments`；shortcut 与 MCP 在本版声明中只能明确 unavailable。Blender
InteractionCatalog `1.10.0` 仅为 `blender.mesh.create_uv_sphere` recipe 启用该声明。其菜单轨迹严格按目录
step 的连续 order 生成，每一步的 `path` 都是截至该步的累计 label；每个菜单 operation 引用 leaf 的全部
有序 semantic operation 和稳定去重后的全部 evidence。只有最后一个、绑定
`accepted_plan_action` 的 execution step 取得 leaf 中原样的 Action arguments，前置导航步骤的参数固定为
空对象。

物化后的 track ID 等于 InteractionCatalog recipe ID，operation ID 等于对应 recipe step ID。结合树顶层
固定的 `interactionCatalogVersion`，调用方可重建精确 recipe/step provenance，而无需新增一套易漂移的
自由文本来源字段。未声明物化的 recipe 保持 menu unavailable；没有已验证 shortcut recipe 或获批的
action-level MCP tool 时，这两类轨迹也确定性保持 unavailable。

结果返回 packet digest、输入/输出 ProcedureTree 的 canonical SHA-256、已安装 InteractionCatalog 的
content SHA-256、精确 catalog binding、逐 leaf 的 recipe/menu/shortcut/MCP coverage，以及重新编译的
GuidePlan。物化不会改变 leaf 的 `candidate` 状态或空的 `validatedHostVersions`，不会把目录绑定误写成
真实宿主版本验证。

目录 grounding 证明属于完整的 MaterializationResult 信封，而不属于单独抽出的 ProcedureTree。recipe/step
ID 与 `interactionCatalogVersion` 只提供可重建引用；脱离 packet/tree/catalog digest 与 coverage 后不能作为
目录来源证明。现有通用 tree store 只保存结构树并继续按 `interactionTracks: structural_only` 处理，因此把
输出 tree 单独交给该入口会丢失物化证明，后续检索、训练或执行不得据此宣称 catalog-grounded。未来如需
持久化物化结果，必须原子保存完整证明或针对已安装精确目录重新执行同等校验。

## 兼容性与后果

这是第一个菜单 grounding 切片，不是完整的确定性交互 materialization 里程碑。历史 Blender
InteractionCatalog `1.9.0` 继续逐字保存和精确回放；缺少新声明的历史或当前 recipe 会 fail closed 为
unavailable，而不是推断路径。通用 `operatingline.procedure.compile` 继续只报告
`interactionTracks: structural_only`。

该入口不调用模型或 Provider，不保存 ProcedureTree，不创建、发布或接受 Proposal，也不执行 Blender
或把 candidate 晋升为 verified。后续 ADR 0047 已在 InteractionCatalog `1.11.0` 增加有序控件参数 DSL，
并把本 ADR 的 `1.10.0` 行为逐字冻结；经过真实版本验证的 shortcut/MCP recipe、真实 Blender 逐叶回放与
验证状态写回仍待实现。完整的 Procedure Provider coordinator、向量/语义 RAG、教学
视频采集、可视化编辑器、训练数据治理与导出也不属于本切片。
