# OperatingLine Protocol

这里存放供所有语言和宿主软件消费的公开协议产物。TypeScript 绑定位于
`packages/protocol`，发布前由其生成 JSON Schema；Blender/Python 和未来的软件
适配器只依赖版本化 Schema 与 fixtures，不依赖 Orchestrator 的实现语言或任何客户端。

`protocol/fixtures` 是版本化公开 fixture 的编辑源。Blender 构建和测试脚本会把离线所需 Plan fixture
同步到 Extension resources，并通过集成测试校验内容一致，禁止手工维护两份不同计划；Human Eval
suite 留在 `fixtures/v1/eval/`，由 `@operatingline/eval-kit` 直接验证，不复制进 Extension。

`protocol/schemas/v1/companion-*` 定义通用 Companion 的计划/提案拉取与状态报告格式；
`guide-proposal-*` 定义 AI 提案、服务端信封和宿主决策。它们与 GuidePlan Schema 一样由
`packages/protocol` 生成；任何宿主不得自行增加未版本化字段。

`procedure-tree.schema.json` 定义 GuidePlan 之前的可编辑知识与规划中间表示。它可以来自教学视频、
自然语言或人工资料；group/leaf 树负责大步骤与小步骤，leaf 的 `semanticOperations[]` 通过
`semanticRefs` 对齐带具体参数和顺序的 `menuTracks[]`、`shortcutTracks[]`、`mcpTracks[]`。轨迹必须
显式声明 available/unavailable，来源证据、置信度、视频权利状态和宿主验证状态必须与操作一起保存；
不得把不存在的 MCP 函数或未验证的视频猜测伪装成可执行数据。示例位于
`fixtures/v1/snowman-eye.procedure.json`。
`materializeProcedureOperations` 只负责按依赖安全的叶子顺序选择并串联轨迹，遇到多别名必须显式指定
track ID；`compileProcedureTreeToGuidePlan` 把层级、Action、Anchor、Observation 和回退确定性编译到
现有人工审批 GuidePlan。两者都不提交 Proposal、接受计划或执行宿主动作。
`procedure-compilation-request.schema.json` 与 `procedure-compilation-result.schema.json` 定义
`operatingline.procedure.compile` 和 `/api/v1/procedure/compile` 的只读边界：Runtime 核对已安装的精确
ActionCatalog 及 host version range，返回 `interactionTracks: structural_only`、
`proposalCreated: false` 和 `hostExecutionStarted: false`；宿主 InteractionCatalog 与真实 UI 回放验证
仍是独立的后续门禁。
`procedure-tree-store-*`、`procedure-tree-get-request`、`stored-procedure-tree` 和
`procedure-tree-list-*` Schema 定义不可变资料库边界。Runtime 只在上述完整编译门禁通过后保存 revision；
相同内容幂等，冲突或旧 revision 拒绝。完整读取会重算规范内容哈希，列表用稳定 sequence 游标只返回摘要；
存取都不会发布 GuidePlan、创建 Proposal 或执行宿主。见
`docs/adr/0043-immutable-procedure-tree-library.md`。
`procedure-operation-search-request.schema.json` 与 `procedure-operation-search-result.schema.json` 定义
MCP `operatingline.procedure.search` 和 HTTP `POST /api/v1/procedure/search` 的精确操作检索。所有
selector 以 AND 组合；字符串和 `semanticAction` 使用完整值匹配，菜单路径与快捷键使用顺序敏感的完整
数组匹配。结果带树完整性、节点路径、leaf 验证状态、轨迹、operation 及其来源证据；unavailable 轨迹
不进入索引。`indexSequence` 只是稳定的存储分页游标，不是节点或 operation 顺序。响应固定声明
`matching: exact_structured_filters`、`similarityScoreProduced: false` 和
`hostExecutionStarted: false`；该接口没有 semantic embedding，也不执行宿主动作。见
`docs/adr/0044-exact-procedure-operation-index.md`。
`procedure-authoring-prompt-request.schema.json`、`procedure-authoring-prompt-context.schema.json`、
`procedure-authoring-prompt-packet.schema.json`、`procedure-authoring-candidate-tree.schema.json`、
`procedure-authoring-validation-request.schema.json` 和 `procedure-authoring-validation-result.schema.json` 定义
自然语言目标到候选 ProcedureTree 的供应商无关交接契约。MCP `operatingline.procedure.prompt.get` 与 HTTP
`POST /api/v1/procedure/prompt` 返回同一 `1.0.0` packet：它精确绑定 ActionCatalog/InteractionCatalog、
按 tree/revision 命名空间化的 goal provenance 和 tree identity，并要求每个生成 leaf 保持 `candidate`、
`validatedHostVersions` 为空，三类交互轨迹也必须为 `unavailable`。当前 MCP 宿主模型可按 packet 生成层级、
语义 operation 和 Action 参数；InteractionCatalog 与精确检索结果只作为后续确定性 grounding 的候选，
不能在当前响应中自行变成 available 轨迹。候选必须连同原 packet 交给
`operatingline.procedure.authoring.validate`：服务端验证 packet canonical SHA-256、已安装目录快照、固定 identity/
provenance 和 candidate-only 契约，再复用既有 compile。Packet 不含重复 rendered prompt，并以 256 KiB
canonical 大小为上限。该入口不调用模型、保存树、创建 Proposal 或执行宿主，也没有向量或语义 RAG。见
`docs/adr/0045-provider-neutral-procedure-authoring.md`。

`procedure-authoring-generate-request.schema.json` 与
`procedure-authoring-generation-result.schema.json` 定义显式 Provider authoring 调用。调用方先通过 MCP
`operatingline.procedure.authoring.providers.list` 或 HTTP
`GET /api/v1/procedure/authoring/providers` 查看传输/凭据披露，再以 provider ID 和 UUID request ID 调用 MCP
`operatingline.procedure.authoring.generate` 或 HTTP
`POST /api/v1/procedure/authoring/generate`。Provider 收到完整 packet 的规范 JSON 编码；返回 candidate 立即
执行上述 packet identity、installed catalog 与 compile 门。结果固定声明模型已调用，但 tree 未保存、Proposal
未创建、宿主未执行；requested/completed/failed evidence 支持重启幂等。见
`docs/adr/0070-explicit-procedure-authoring-provider.md`。

`procedure-authoring-materialization-request.schema.json` 与
`procedure-authoring-materialization-result.schema.json` 定义后续第一个目录绑定菜单 grounding 切片。MCP
`operatingline.procedure.authoring.materialize` 与 HTTP
`POST /api/v1/procedure/authoring/materialize` 复用完全相同的原 packet + candidate，并重新执行 packet
integrity、已安装目录、candidate-only 契约和 compile 校验。只有 InteractionCatalog recipe 的封闭
`procedureMaterialization` 声明可以把轨迹变为 available。Blender InteractionCatalog `1.18.0` 的 UV Sphere
同时声明七步 ordered menu 与六步 candidate shortcut；快捷键 operation 以 `keyMode` 区分 chord/sequence，
并用封闭 `vector3_x/y/z` 投影把 location 三个分量绑定到 `G → X/Y/Z`。顶层 Action 参数必须在每条替代轨迹
中分别恰好映射或带理由省略；`workspace`/`editor`/`mode`/`keymap` 前置条件各恰好一条，所有
`(kind, label)` 组合唯一；MCP 仍明确 unavailable。Track ID 等于 recipe ID 或其 modality 后缀，
operation ID 等于 recipe step/control/shortcut ID，再结合树顶层
`interactionCatalogVersion` 可重建 provenance。
结果返回已安装 InteractionCatalog digest、输入/输出 tree hash 和逐 leaf coverage，但 leaf 仍为 candidate，
`validatedHostVersions` 仍为空。通用 compile 继续是 `structural_only`。该入口不调用模型/Provider、不保存
树、不创建 Proposal、也不执行 Blender。完整 result 信封才是目录 grounding 证明；单独抽出或经通用 store
保存的 tree 会丢失 digest/coverage attestation，只能按 `structural_only` 使用。Blender InteractionCatalog
`1.18.0` 保留 Icosphere 的六步 ordered menu：四步 guidance 后依次绑定 Location 与 Object Name，
并在 operator step 精确保留 `subdivisions`/`radius`。内部 `resourceId` 被显式省略；Icosphere shortcut 和
所有 MCP 轨迹仍 unavailable，因为目录没有相应 shortcut 声明，且没有真实 action-level MCP tool。Cube
和 Plane 分别 opt in 六步 ordered menu：四步 guidance 的 operator step 以 identity 投影绑定 accepted action
的完整边长 `size`，随后依次绑定 Location 与 Object Name，并显式省略 `resourceId`。`size` 不是 transform
scale；Cube/Plane shortcut 与 MCP 均 unavailable。Torus 另行 opt in 六步 ordered menu，在 operator step
按顺序绑定 `majorSegments`、`minorSegments`，固定 literal `mode: MAJOR_MINOR`，再绑定 `majorRadius` 与
`minorRadius`，随后绑定 Location 与 Object Name，并省略 `resourceId`；Torus shortcut/MCP 均 unavailable。
Cone 以六步 ordered menu opt in：四步 guidance 的 operator step 严格按序输出
`vertices: 32`、`radius1 ← radiusStart`、`radius2 ← radiusEnd`、`depth ← distance`、
`end_fill_type: NGON`、`calc_uvs: false`、`enter_editmode: false`、`align: WORLD`、
`location: [0,0,0]`、canonical `rotation` 与 `scale: [1,1,1]`，然后绑定中点 Location 与 Object Name。
封闭 `derived_action_arguments`/`segment_frame` 派生以 `dx/dy/dz = end - start`、
`horizontal = hypot(dx,dy)`、`distance = hypot(horizontal,dz)`、`midpoint = (start+end)/2` 与
`rotation = [0,atan2(horizontal,dz),horizontal===0?0:atan2(dy,dx)]` 定义；`-0` 规范化为 `0`，
且 `distance`/`midpoint`/`rotation_euler_xyz_align_z` 必须各恰好映射一次。该 canonical zero-roll
XYZ Euler 不声称与 managed executor quaternion/roll 精确等价。`resourceId` 省略，Cone
shortcut/MCP 仍 unavailable。
Cylinder 同样以六步 ordered menu opt in：四步 guidance 的 operator step 严格按序输出
`vertices: 32`、`radius ← radius`、`depth ← distance`、`end_fill_type: NGON`、
`calc_uvs: false`、`enter_editmode: false`、`align: WORLD`、`location: [0,0,0]`、canonical
`rotation`、`scale: [1,1,1]`，然后绑定中点 Location 与 Object Name。它复用上述封闭
`segment_frame` 公式，且 `distance`/`midpoint`/`rotation_euler_xyz_align_z` 三个输出仍各恰好
映射一次。canonical zero-roll XYZ Euler 将本地 `+Z` 对齐 `end-start`；本地 `-Z` 端对应
`start`，本地 `+Z` 端对应 `end`，两端使用同一 `radius`。它不声称与 managed
executor quaternion/roll 精确等价。`resourceId` 省略，Cylinder shortcut/MCP 仍 unavailable。
UV Sphere shortcut 结果格式为 `1.2.0`，
Icosphere、Cube、Plane、Torus、Cone 与 Cylinder menu-only 结果格式为 `1.1.0`；历史 `1.13.0` 精确保留 Icosphere，
`1.14.0` 精确保留 Cube，`1.15.0` 精确保留 Plane，`1.11.0` ordered menu 返回 `1.1.0`，
`1.10.0` 四步算法与 `1.9.0` unavailable 回放继续返回 `1.0.0`；`1.17.0` 已冻结并精确回放。所有投影仍为 candidate，不证明宿主状态
等价；通用 compile 仍报告 `structural_only`。Icosphere/Cube/Plane/Torus/Cone/Cylinder 轨迹没有完整 UI operation 的真实 Blender replay；Cone/Cylinder 的 4.5/5.1 原生 operator 双版本探针也不等于六步 UI replay。原生菜单/operator 不复现
managed collection 归属、resource tag、receipt、幂等或补偿语义。Result 契约要求 `1.1.0` 至少含一条
materialized menu、`1.2.0` 至少含一条 materialized shortcut，
避免版本声明高于实际 coverage。见
`docs/adr/0046-catalog-bound-procedure-materialization.md` 与
`docs/adr/0047-ordered-procedure-parameter-operations.md` 与
`docs/adr/0048-candidate-shortcut-procedure-materialization.md` 与
`docs/adr/0049-icosphere-ordered-menu-materialization.md` 与
`docs/adr/0050-cube-ordered-menu-materialization.md` 与
`docs/adr/0051-plane-ordered-menu-materialization.md` 与
`docs/adr/0052-torus-ordered-menu-materialization.md` 与
`docs/adr/0053-cone-segment-frame-menu-materialization.md` 与
`docs/adr/0054-cylinder-segment-frame-menu-materialization.md`。

Guide protocol `1.2.0` 为 action 叶节点增加可选 `observationPolicy`。缺省或 `telemetry` 保留只读
观察；`success_gate` 要求至少一条 expected observation，并显式选择 `rollback_step` 或
`retain_for_repair`。`1.0.0`/`1.1.0` 不得携带该字段。Companion report `1.2.0` 必须显式携带
`observationGate`（无门状态为 `null`），并用 `blocked`、`step_observation_failed` 与
`observation_recovered` 区分可修复门失败和宿主 error。旧版 report 不得携带此字段。

`action-catalog.schema.json` 定义宿主发布的版本化允许动作目录，包括可选的适配器自有
`semanticCapabilities`；`planning-context.schema.json`
定义 Orchestrator 交给模型客户端的目录、目标、revision 提示、Companion 状态和计划约束组合。
目录规范数据由适配器拥有，例如 Blender 位于
`adapters/blender/catalog/v1/action-catalog.json`，不放进通用协议包硬编码。

`planning-quality-evaluation-request.schema.json` 与 `planning-quality-report.schema.json` 定义
模型无关的候选计划质量门。报告验证 catalog 阶段分组/顺序、调用方声明的目标所需阶段、资源
创建与依赖、语义锚点和观察。对带能力画像的目录，它还验证 provider 声明的
`requirement -> capability -> executable leaf` 覆盖链：能力与步骤必须存在，步骤必须可执行且 action
属于该能力；局部重规划的步骤还必须位于允许范围内。报告只返回确定性 finding 与通过状态，不定义
语义或审美分数。
`planning-benchmark-case.schema.json` 把自然语言目标、精确目录版本、所需阶段与一个完整参考 Plan
绑定为可重放案例；当前非雪人案例位于
`fixtures/v1/planning/robot-preview.benchmark.json`。

`planning-prompt-request.schema.json`、`planning-prompt-context.schema.json`、
`planning-prompt-packet.schema.json` 和
`planning-proposal-draft.schema.json` 定义供应商无关的模型交接契约。Packet 包含完整
PlanningContext、严格 Proposal 草案 JSON Schema、固定工作流规则和确定性渲染提示；带
`semanticCapabilities` 的目录使用格式 `1.1.0` 并要求 `planning.capabilityCoverage`，历史目录使用
格式 `1.0.0` 生成和回放。同一 packet
构建器服务 MCP Prompt、MCP Tool 和 HTTP；Prompt 呈现渲染文本，Tool/HTTP 返回完整 packet。
它不调用模型，也不改变宿主内人工接受门禁。

`guide-goal-request.schema.json`、`guide-goal-request-acknowledgement.schema.json`、
`guide-goal-request-list.schema.json` 与 `guide-goal-prompt-request.schema.json` 定义宿主发起的初始
Goal-to-Guidance 边界。请求把用户目标绑定到精确 `adapterId + instanceId + catalogVersion + planId`，
列表的 `limit` 是可选线字段，Runtime 缺省使用 20；请求不携带模型、Provider、凭据或费用授权。
MCP 客户端列出 pending 请求、按 ID 取得上述同一
PlanningPromptPacket，再把完整 draft 连同 `goalRequestId` 交给既有 `guide.propose`。服务端核对请求
路由和规划证据，生成只投递给原实例、仍须宿主内 Accept/Reject 的 Proposal；它不会自动调用模型或
执行宿主动作。

`planner-provider-descriptor.schema.json`、`planner-provider-list.schema.json`、
`planner-generate-request.schema.json`、`planner-generation-result.schema.json` 与
`planner-generation-error.schema.json` 定义显式 Planner Provider 的公开边界。Descriptor 只披露
provider identity、可用性、并发、执行位置、数据传输和凭据管理责任，不携带凭据；本地执行固定为
`dataTransmission: none`，远端执行固定为 `provider_managed`。Generate 请求必须
明确指定 `providerId` 与 UUID `requestId`；结果包含严格草案、对应质量报告和原样 coverage 证据，且
`proposalCreated` 固定为 `false`。生成不是 Proposal 提交或宿主执行授权。

ActionCatalog 的 `argumentsSchema` 使用受限、可移植的 JSON Schema 子集：object/array/string/
number/integer/boolean/null、`required`、`properties`、`additionalProperties: false`、数组长度与唯一性、
字符串长度/正则、数值范围、`enum`、`const`、`oneOf`、`anyOf`，以及目录中已有的资源 ID、对象名、
骨骼名、目标 ID、父级无环和关键帧递增自定义约束。目录注册时拒绝未知或畸形 schema 关键字；
Proposal 验证会递归检查嵌套参数。自由文本 description 仍只是说明，不能代替机器可执行约束，
Companion 仍负责真实宿主状态和最终执行验证。

`guide-revision-request.schema.json` 定义宿主创建的不可变节点修订请求；
`guide-replan-submission.schema.json` 定义 MCP 客户端针对该请求提交的完整新版计划。请求保存精确
ActionCatalog 版本、完整 base Plan、稳定节点 ID 和当时的显示编号，而不是只保存易漂移的自由文本。
协议 `1.1.0` 还增加 thread 内线性 `revisionThread`；`guide-plan-diff.schema.json` 定义服务端计算并随请求关联
Proposal 投递的精确 Plan/节点/字段前后值。协议 `1.3.0` 增加可选 `parameterEdits`，把直接引用 action
叶节点的顶层参数绑定为精确 `before/after`；请求可使用消息、结构化 edits 或两者，但 Provider 必须在
完整新版 Plan 中逐项精确应用。`1.0.0`–`1.2.0` payload 仍可读取且保持 message-only，新 Companion
产生 `1.4.0`。协议 `1.4.0` 要求显式 `revisionOperation`：普通 `revise`、从已接受 head 创建新 thread
的 `fork`，或把另一条已接受 branch head 合入当前 thread 的 `merge`。Fork/merge source 必须是同一
adapter、instance、catalog 和 Plan ID 的当前 head；merge 请求只引用目标 Plan root 且不能混入参数 edit。
`guide-revision-thread-history-request.schema.json` 与
`guide-revision-thread-history.schema.json` 定义按宿主实例隔离、以 `beforeTurn` 向前分页的完整修订
记录；每轮原样关联请求、操作、Proposal、diff 和人工决策。
`guide-revision-branch-list-request.schema.json` 与 `guide-revision-branch-list.schema.json` 返回每个 thread
的 durable head。只有已接受 head 暴露可安装的完整 Plan 与内容 SHA-256；awaiting/rejected head 不得
伪装成可切换分支。

`eval-export-request.schema.json` 与 `eval-export-bundle.schema.json` 定义按 adapter、Plan 和可选
Companion 实例分页导出的 replay/eval 证据。Bundle 包含精确目录版本、相关完整计划与提案、人工
决定、provider coverage 声明及 planning-quality 事件、步骤 observation/rollback、稳定事件序列、
汇总和内容 SHA-256；它不定义或暗示质量分数。Format `1.1.0` 的第一页冻结
`snapshotUpperSequence` 并返回内容寻址的 `snapshotId`，后续页必须复用两者，因此导出期间新追加的
事件不会改变同一快照的关系、汇总或页面内容。读取 schema 同时保留 format `1.0.0` 历史 Bundle；
Orchestrator 只生成带冻结快照字段的 `1.1.0`，Human Eval live Run 也只接受 `1.1.0` 原始证据。

`human-eval-suite.schema.json`、`provider-eval-run.schema.json`、
`human-eval-annotation.schema.json`、`human-eval-adjudication.schema.json` 与
`human-eval-comparison-report.schema.json` 定义独立 Human Eval format `1.0.0`。Suite 保存版本化 rubric、
initial/local-replan 案例、精确 ActionCatalog 内容哈希、需求、数据处理和盲审政策；Run 保存精确
packet/request/result、Provider 与模型/API profile、宿主环境、generation settings、区分 Provider/宿主
关联的事件摘要和内容哈希 artifact；local replan 还绑定完整 immutable base Plan。Annotation 与
adjudication 保存逐 criterion 人工判断和内容寻址分歧。Comparison 只按相同 condition 并列原始判断和
缺失状态，自身也带 source-record hashes 与 integrity，不计算数值分数、胜率或 Provider 排名。

首个 `fixtures/v1/eval/blender-core/suite.json` 是 `collecting` 状态的
`blender.core_planning@1.0.0`：7 个案例组成 6 条 lineage，覆盖常规 initial plan、adversarial 能力
边界和 local replan。当前没有真实 Provider Run、人工 annotation 或 adjudication；reference Plan 只是
示例，不是唯一 ground truth。Synthetic Run 只用于测试，协议禁止它进入 published comparison。

## 版本规则

- `protocolVersion` 使用语义化版本。
- 当前 Guide/Companion 生产版本为 `1.4.0`；读端保留 `1.0.0`/`1.1.0`/`1.2.0`/`1.3.0`。旧版 observation 只能是
  telemetry，不得由新宿主静默升级为 success gate。
- Major 不兼容时必须拒绝连接，不能静默降级。
- 屏幕像素坐标不是持久协议字段；适配器在运行时解析语义锚点。
- 树形父子关系用于呈现和引用，`dependsOn` 用于执行调度。
- 带 `planningPhases` 的目录必须把每个 action 恰好分配到一个阶段；旧目录没有阶段画像时，质量
  评估显式降级并产生 warning，不能伪装成完整检查。
- 带 `semanticCapabilities` 的目录必须保证 capability ID 唯一、每项能力至少声明一个同目录 action，
  且 capability 内 action 不重复。Blender `1.3.0` 当前发布七项能力；`1.0.0`–`1.2.0` 保持历史版本。
- Planner Packet 只为带阶段画像与质量门的目录生成；客户端必须把草案先交给质量门，再提交完整
  Proposal，不能把 prompt 输出本身视为执行授权。
- Planning/Replanning Packet 对 capability-aware 目录使用 `1.1.0`，对历史目录使用 `1.0.0`；对应
  planning-quality baseline 分别为 `1.1.0` 与 `1.0.0`。历史目录不得携带新 coverage。
- Planner Provider 必须由嵌入方显式注入并由调用方按 `providerId` 选择；核心不定义默认 provider、
  API Key、endpoint 或模型参数。默认 standalone 的 provider 列表为空。
- Generate 可能按 provider 声明传输完整 packet 并产生费用。返回草案是不受信任输入；只有严格
  Schema、packet identity、ActionCatalog、coverage 和质量校验都完成后才形成 generation result。
  缺少 coverage、未知 capability、不存在/actionless 的步骤、action 不匹配或局部范围外映射都会使
  结果为 `needs_revision`；不会自动创建 Proposal。结果仍需
  单独调用 `guide.propose`。Generation runtime error 使用 `retryMode` 明确区分可复用同一 ID、必须
  使用新 ID 和不可重试；provider 已开始后的失败或中断不会用同一 `requestId` 自动重试。MCP 在进入
  handler 前拒绝的畸形 tool 参数仍使用 MCP 自身的 `InvalidParams` 错误，而不是 generation runtime
  error。
- 步骤 ID 使用 `[A-Za-z0-9][A-Za-z0-9._:-]*`；ASCII 序关系保证不同语言的稳定排序一致。
- 同一 Plan ID 的 `revision` 必须严格递增；切换到其他计划后也不能重新发布旧 revision。
- AI 计划使用 `GuideProposal` 信封投递；接收和校验不等于接受，只有宿主内显式
  `accepted` 决策才能把它安装为活动计划。`rejected` 不得修改宿主场景或活动计划。
- 初始目标请求以 `requestId` 幂等；同一实例最多有一个未关联 Proposal 的请求，已有未决 Proposal 时
  也不能创建新请求。请求关联提交必须使用 packet 规定的完整 draft，并令 adapter、catalog、Plan ID
  和 planning goal 精确匹配持久请求；成功 Proposal 只路由到请求的原 `instanceId`。
- Proposal 决策以 `proposalId + adapterId + instanceId` 唯一；同一实例的同值重试幂等，
  相反决策是 conflict。其他实例仍可独立审查同一提案。
- 修订请求以 `requestId` 幂等；相同 ID 的不同 payload 是 conflict。引用的 `nodeId + nodeNumber`
  必须与请求携带的完整 base Plan 一致。
- `parameterEdits` 只允许出现在 `1.3.0`/`1.4.0` 请求中，必须指向直接引用的 action 叶节点。`before` 必须匹配
  base Plan，合并后的完整 action arguments 必须通过精确目录，Provider 输出必须逐项等于 `after`。
- `revisionThread` 的首轮使用 `threadId = requestId`；后续 turn 必须指向当前 thread head，并以该父
  请求关联且已在同一宿主实例接受的 Proposal 完整计划作为精确 base。Thread 内保持线性；协议
  `1.4.0` 只能通过显式 `fork`/`merge` 跨 thread 建立 DAG 边，不静默分支。
- 三方 merge 使用目标 head、source head 与唯一最低共同祖先。不同字段的独立改动确定性组合；同字段
  分歧、delete-vs-edit、无唯一 merge base 或 source 已前移都会拒绝。Provider 必须原样返回服务端计算的
  `expectedMergedPlan`；Proposal 保存 `mergeBaseRequestId`，且仍需宿主 Accept。
- 修订历史默认返回最新一页、页内按 turn 正序排列；`nextBeforeTurn` 只在仍有更早记录时出现，
  调用方将它作为下一次 `beforeTurn`，单页最多 100 轮。
- 请求关联重规划必须使用同一 Plan ID、请求绑定的精确 `catalogVersion` 和严格更高 revision；返回的
  Proposal 带 `targetInstanceId`、`revisionThread` 与确定性 `planDiff`，只投递给发起请求的 Companion。
- AI 在生成可执行步骤前应读取目标宿主的精确 ActionCatalog/PlanningContext。Proposal 的动作名、
  嵌套参数、anchor、observation 和 rollback 必须属于该目录；宿主仍对实际资源和执行时状态进行
  最终校验。
- Companion protocol v1 的单个 GuidePlan 中，所有非空 action 必须使用同一 `adapterId`；
  混合宿主计划必须拒绝，不能通过删减步骤破坏树、依赖、编号或 revision 语义。
- 没有 action 的计划缺少宿主路由信息，当前可发布和查询，但不会投递给 Companion。
- Companion 身份使用 `adapterId + instanceId`；同一身份的 `sequence` 必须严格递增。
- 同 `reportId` 只有完整 payload 一致时才是幂等重试；内容变化是 conflict，不是 stale。
- 同一 Plan `id + revision` 只有 `planContentSha256` 也一致时才是幂等重投；相同版本携带不同内容时，
  Companion 必须拒绝，不能确认、安装或接受对应 Proposal。Companion 拉取水位必须同时携带
  `knownPlanId + knownRevision + knownPlanContentSha256`；Orchestrator 只在版本与内容身份都匹配时抑制
  同 revision 重投。
- Eval 分页使用追加式事件 `sequence`，而不是可能重复的时间戳。第一页必须使用
  `afterSequence: 0`，且不能伪造 snapshot 字段；响应冻结 `snapshotUpperSequence` 并返回
  `snapshotId`。后续页必须同时提交这两个值，并令 `afterSequence` 不超过冻结上界。
  `nextAfterSequence` 是当前页最后一条匹配事件；`matchedEventCount` 是冻结 scope 的数量，不是当前页
  数量。冻结之后追加的事件只属于新的第一页导出。
- Eval 内容哈希排除随机 `exportId`、`exportedAt` 和 `integrity`，其余顶层内容按
  `operatingline-json-sort-v1` 递归排序对象键后计算 SHA-256。
- `planContentSha256` 单独使用跨 TypeScript/Python 一致的 `operatingline-json-value-v1`：值带显式
  类型与长度，字符串和对象键按 UTF-8 编码，对象键按 UTF-8 字节排序，数字按有限 IEEE-754 binary64
  大端字节编码且 `-0` 归一为 `0`。它不与 Eval/Human Eval 记录完整性哈希混用。
- `redaction: none` 表示原始证据可能含用户目标、provider 生成草案、修订消息、动作参数、观察和
  错误；分享或训练前必须由调用方审核和授权。
- Human Eval Suite、Run、annotation、adjudication 与派生 comparison 使用内容 SHA-256；Run 必须绑定
  精确 case/catalog/base Plan、packet、结果、condition、treatment 和冻结 Eval-export pages，annotation
  必须绑定精确 Run 与 rubric。更正 annotation 创建 superseding 记录，不覆盖历史；adjudication 通过
  `annotationId + annotationContentSha256` 只处理同一 Run 上至少两名独立 reviewer 的当前记录。
- 可判断的 Human Eval execution/artifact judgment 必须在冻结账本中证明严格因果顺序：匹配 Run 且
  `result.status: ready` 的 Provider completed 终态之后，发布与 outcome 完全相同 `planContentSha256`
  的 Plan，或创建同一精确
  Plan 的 Proposal 并记录匹配 adapter/instance 的 `accepted` 决策；只有该授权之后的宿主终态才能作为
  证据。宿主报告必须匹配精确 Plan ID/revision/hash、instance、环境和非空 `executionId`，不同 released
  Run 不得复用同一 execution。
- Rendered image 必须以 `planContentSha256 + executionId + terminalHostReportId +
terminalHostEventSequence` 绑定同一宿主终态报告/事件和已声明的 host project。目录验证必须读取实际
  `image/png` 字节、核对内容 SHA-256、完成 PNG chunk/CRC/scanline 解码，验证 palette 顺序、容量和
  indexed pixel 引用，并核对解码尺寸与声明的 `width/height`；文件名、media type 或 PNG signature
  不能单独充当视觉证据。
- Human Eval policy 禁止数值评分和 Provider 排名，要求 reviewer 看不到 Provider identity，并把缺失
  Run/annotation 与分歧原样报告。Published comparison 排除 `synthetic_test_fixture`，且只能由完成
  artifact 字节验证的目录数据集生成。`released` 状态额外要求 live treatments、最低独立 reviewer 数、
  分歧裁决、逐记录公开审核，以及每个声明 execution/artifact criterion 的 case-level 精确宿主终态/
  环境绑定渲染覆盖；Provider failed、`needs_revision` 或缺少授权/下游证据的 treatment 以
  `unable_to_judge` 留在 comparison 中，具备精确授权链的宿主 error 则可保留 `not_met` 或
  `partially_met`。
- 所有 Human Eval 记录固定 `trainingUse: not_authorized`。`local_eval`、`research` 或 reviewed public
  release 都不能解释为训练授权；真实 Run 和人工 annotation 还需各自的数据审核。

目录约束覆盖的完整兼容、失败与非评分决策见
[ADR 0017](../docs/adr/0017-catalog-grounded-goal-coverage.md)。它不授予 provider 自动选择、场景修改、
Proposal 接受或执行权限，也不证明 provider 正确理解了任意目标。

重新生成协议：

```bash
pnpm schema:generate
pnpm schema:check
pnpm eval:check
pnpm eval:report
```

`eval:check` 和 `eval:report` 默认读取 `protocol/fixtures/v1/eval/blender-core`，也接受一个显式数据集
目录。当前默认 suite 的已验证计数为 7 个案例、0 个 Run、0 个 annotation 和 0 个 adjudication；
report 会诚实标记所有案例缺少 live Run，不代表任何 Provider 已通过评测。

公开 JSON Schema 负责单记录形状和可静态表达的同记录约束；内容哈希重算、跨记录引用、受控 artifact
root/字节、Eval-export page chain、base Plan 文件内容与发布就绪性必须通过 `@operatingline/eval-kit`
验证，不能只运行通用 JSON Schema validator。
