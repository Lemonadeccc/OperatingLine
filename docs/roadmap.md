# OperatingLine 路线图

本文记录产品能力，而不是 OMX 的临时运行状态。每个里程碑只有在实现、测试和文档证据齐全后
才能标记完成。

## 已完成

- [x] Headless Orchestrator、版本化 GuidePlan 和宿主能力画像。
- [x] Blender 原生任务树、彩色数字/引导线、Show/Hide、Next/Back。
- [x] 可执行并逐步补偿回退的雪人建模、材质、灯光、相机与预览渲染垂直切片。
- [x] AI GuideProposal 的宿主内只读预览、接受/拒绝和幂等决策。
- [x] Blender 骨骼动画：刚性 rig/pose 基线加上显式归一化蒙皮权重、Armature Modifier、
      location/rotation/scale 关键帧、插值/外推、指定帧渲染和可补偿回退。
- [x] 本地 AI 客户端分发：Codex/Claude CLI 一键 MCP 配置、跨客户端 connection instructions、
      Claude Desktop MCPB stdio→loopback HTTP 连接器，以及真实跨传输 Tool/Prompt 集成验证。见
      [ADR 0022](adr/0022-local-ai-client-distribution.md)。
- [x] 本机 AI CLI Provider 注册：独立 `pnpm dev:clients` composition root 注册 Codex CLI 与
      Claude Code CLI，供外部 Bearer-authenticated operator 显式执行 generate → propose；默认 runtime
      继续 provider-free，Companion Initial/Dialogue 固定禁用，Replan 另需默认未提供的签名 authority。HTTP 与 stdio bridge 自动协商 MCP
      `2026-07-28` 并回退旧版；MCPB 已有临时自签名 CI 验证和外部凭据驱动的生产签名流程。见
      [ADR 0023](adr/0023-local-cli-planners-and-modern-mcp.md)。

## 已完成的规划基础

- [x] 版本化 ActionCatalog：让 AI 查询真实允许动作、参数、资源读写、观察和回退能力。
- [x] 版本化 InteractionCatalog：通用协议定义 action 到有序宿主交互步骤的严格配方；Blender
      `1.44.0` 与 ActionCatalog `1.22.0` 一一覆盖 27 个动作，历史 `1.9.0` 至已冻结的 `1.43.0` 保持逐字可回放。Plane/Cube/UV Sphere/Ico Sphere/Cone/Cylinder/Torus 使用经过
      4.5/5.1 验证的 `native_path`，其他二十个动作使用明确的灰色 `semantic_path` 与 `UI target unavailable`，
      其中 Subdivide、Edit Mode Bevel、Individual Inset Faces、Poke Faces 与 Subdivision Surface 另有 candidate shortcut，但 menu 仍 unavailable；只有 Subdivision Surface 与 Edit Mode Subdivide 的精确
      factory-Cube accepted-replay/F9 轨迹各带独立 `proofExecution`，不会把其它 candidate 轨迹升级为可执行。活动叶节点不再依赖 Python
      硬编码或不可信 Plan anchor 选择可点击目标。见
      [ADR 0024](adr/0024-versioned-interaction-catalog.md) 与
      [ADR 0025](adr/0025-granular-primitive-teaching-steps.md)、
      [ADR 0026](adr/0026-native-cube-action-slice.md)、
      [ADR 0027](adr/0027-native-icosphere-action-slice.md)、
      [ADR 0028](adr/0028-native-torus-action-slice.md)、
      [ADR 0029](adr/0029-bounded-edit-modifier-geometry-nodes.md)、
      [ADR 0059](adr/0059-edit-mode-subdivide-f9-shortcut-materialization.md) 与
      [ADR 0060](adr/0060-bounded-subdivision-surface-modifier.md) 与
      [ADR 0061](adr/0061-bounded-edit-mode-bevel-edges.md) 与
      [ADR 0062](adr/0062-bounded-individual-inset-faces.md) 与
      [ADR 0063](adr/0063-bounded-edit-mode-poke-faces.md) 与
      [ADR 0064](adr/0064-bounded-mirror-modifier.md)。
- [x] 雪人教学粒度：revision 5 把眼睛、鼻子、五个嘴点、三个纽扣和两条手臂拆成一部件一叶节点；
      ActionCatalog `1.4.0` 新增直接 Cone/Cylinder action，25 个叶节点均可独立观察与补偿。
      Batch 继续保留给机器人和明确需要原子成组创建的计划；历史 revision 4 与 catalog `1.3.0`
      仍可精确回放。见 [ADR 0025](adr/0025-granular-primitive-teaching-steps.md)。
      当前 revision 6 只在同一 25 步结构上增加版本化 observation success gate；见 ADR 0030。
- [x] Blender Cube 原生纵向切片：ActionCatalog `1.5.0` 新增严格的单 Cube action，InteractionCatalog
      `1.2.0` 绑定真实 `Add → Mesh → Cube`；数据层创建、resource observation、receipt、`Back`、
      原生菜单入口与自动 `Next` 的同一结果均在 Blender 4.5.3/5.1.1 验证。历史 catalog `1.4.0` 与
      InteractionCatalog `1.1.0` 保持可回放。见 [ADR 0026](adr/0026-native-cube-action-slice.md)。
- [x] Blender Icosphere 原生纵向切片：ActionCatalog `1.6.0` 新增带 `1..5` subdivision 安全上限的
      单 Icosphere action，InteractionCatalog `1.3.0` 绑定真实 `Add → Mesh → Ico Sphere`；level 2
      数据层网格、resource observation、receipt、`Back`、原生菜单入口与自动 `Next` 的同一结果均在
      Blender 4.5.3/5.1.1 验证。历史 catalog `1.5.0` 与 InteractionCatalog `1.2.0` 保持可回放。
      见 [ADR 0027](adr/0027-native-icosphere-action-slice.md)。
- [x] Blender Torus 原生纵向切片：ActionCatalog `1.7.0` 新增主环 `3..128`、截面 `3..64` 的有界
      Torus action，InteractionCatalog `1.4.0` 绑定真实 `Add → Mesh → Torus`；确定性构网、8192
      顶点/四边面边界、resource observation、receipt、`Back`、原生菜单入口与自动 `Next` 的同一结果均在
      Blender 4.5.3/5.1.1 验证。历史 catalog `1.6.0` 与 InteractionCatalog `1.3.0` 保持可回放。
      见 [ADR 0028](adr/0028-native-torus-action-slice.md)。
- [x] Blender Edit Mode、Modifier 与 Geometry Nodes 首个有界切片：ActionCatalog `1.8.0` 新增整网格
      Subdivide、非应用 Bevel Modifier 与 Transform Geometry Nodes 三个严格 action；InteractionCatalog
      `1.5.0` 为三者提供不伪装原生控件的 `semantic_path`。复制后换链的 mesh、modifier 状态和 node
      group 图签名都进入 receipt；外部修改会阻止 `Back` 覆盖。执行、观察、冲突恢复和完整回退均在
      Blender 4.5.3/5.1.1 验证。历史 ActionCatalog `1.7.0` 与 InteractionCatalog `1.4.0` 保持可回放。
      见 [ADR 0029](adr/0029-bounded-edit-modifier-geometry-nodes.md)。
- [x] Blender 蒙皮、权重与 pose transform 动画：ActionCatalog `1.9.0` 新增
      `blender.rig.bind_skin_weights`，要求最多 8192 顶点完整覆盖、每点 1–8 个唯一骨骼影响且权重和为
      1；Vertex Group、Armature Modifier 和骨骼 deform 标志均进入 receipt。pose action 可选写入
      location/scale 并声明统一 interpolation/extrapolation。Blender 4.5.3/5.1.1 测试覆盖中途失败、
      18 条 transform FCurve、真实网格变形、observation、外部权重冲突与完整回退。见
      [ADR 0032](adr/0032-bounded-skin-weights-and-pose-transforms.md)。
- [x] Blender 有界 Solidify Modifier：ActionCatalog `1.10.0` 新增
      `blender.modifier.add_solidify`，仅开放 `thickness` (`0.0001..100`) 与 `offset` (`-1..1`)；目标
      只接受 receipt-tracked 前置 Modifier，源与求值 topology 上限均为 8192 vertices、16384 edges、8192 polygons，模式固定 `EXTRUDE`，并固定
      `use_even_offset=true`、`use_rim=true`、`use_rim_only=false`。InteractionCatalog `1.7.0` 提供独立
      `semantic_path`，历史 ActionCatalog `1.9.0` 与 InteractionCatalog `1.6.0` 保持可回放。见
      [ADR 0037](adr/0037-bounded-solidify-modifier.md)。
- [x] Blender 有界整网格 Triangulate：ActionCatalog `1.11.0` 新增
      `blender.mesh.edit_triangulate`，只接收 `targetId`、`resultMeshId`、`resultMeshName`；目标必须处于
      Object Mode、无 Modifier/Shape Key、至少包含一个非三角面，并限制在 8192 vertices、16384 edges、
      8192 polygons。动作固定 `quad_method=FIXED`、`ngon_method=EAR_CLIP`，复制源 Mesh 后换链，使用
      `resource_exists + mesh_triangulated` 观察与补偿回退。InteractionCatalog `1.8.0` 提供独立
      `semantic_path`，历史 ActionCatalog `1.10.0` 与 InteractionCatalog `1.7.0` 保持可回放。见
      [ADR 0038](adr/0038-bounded-edit-triangulate.md)。
- [x] Blender 有界连通面区域 Extrude：ActionCatalog `1.12.0` 新增
      `blender.mesh.edit_extrude_region`，只接受 1–256 个唯一 polygon index 与固定局部空间 translation；
      面必须构成一个有边界的 edge-connected region，目标必须处于 Object Mode、无 Modifier/Shape Key，
      源和结果均限制在 8192 vertices、16384 edges、8192 polygons。动作复制源 Mesh 后换链，使用
      来源 vertex provenance 规范化结果 vertex/edge/polygon 顺序，验证源内容与 Object→Mesh receipt 链，
      并提供连续 Extrude 的跨 4.5/5.1 回归。它使用 `resource_exists + mesh_region_extruded` 观察门、补偿回退和 Blender 原生 Undo/Redo；
      InteractionCatalog `1.9.0` 提供独立 `semantic_path`，历史 ActionCatalog `1.11.0` 与
      InteractionCatalog `1.8.0` 保持逐字可回放。见
      [ADR 0041](adr/0041-bounded-edit-extrude-region.md)。
- [x] Blender 有界 Subdivision Surface Modifier：ActionCatalog `1.13.0` 新增
      `blender.modifier.add_subdivision_surface`，只开放 `viewportLevel: 1..3`，固定 Catmull-Clark、
      render level 2、quality 3 和完整可观察属性；拒绝未跟踪前置 Modifier 与已有 `SUBSURF`，并对源、
      求值输入和最高实际 level 的投影输出应用 8192/16384/8192 topology 上限。receipt 补偿、
      `modifier_ready` Observation 与 Blender 原生 Undo/Redo 均在 4.5.3/5.1.1 验证。InteractionCatalog
      `1.23.0` 冻结 `1.22.0`，声明 `Ctrl+1 → F9 → Level → ENTER` 的 candidate shortcut；menu/MCP
      unavailable，`targetId`、`modifierId`、`modifierName` 显式省略，且不声称 UI 与 managed path
      等价。见 [ADR 0060](adr/0060-bounded-subdivision-surface-modifier.md)。
- [x] Blender 有界整网格 Edit Mode Bevel：ActionCatalog `1.14.0` 冻结 `1.13.0`，新增
      `blender.mesh.edit_bevel_edges`；目标必须是 Object Mode、无 Modifier/Shape Key 的 receipt-owned
      closed manifold Mesh，源与结果均受 8192/16384/8192 topology 上限约束。动作固定 BMesh
      `OFFSET`/`EDGES` 及其余非开放属性，复制、标记并换链 replacement Mesh，使用
      `mesh_edges_beveled` Observation、fail-closed 补偿和 Blender 原生 Undo/Redo。InteractionCatalog
      `1.24.0` 冻结 `1.23.0`，声明 `TAB → 2 → A → Ctrl+B → F9 → Width → Segments → Profile → ENTER → TAB`
      十步 candidate shortcut；menu/MCP unavailable，且原生 in-place mutation 不等价于 managed
      replacement transaction。见 [ADR 0061](adr/0061-bounded-edit-mode-bevel-edges.md)。
- [x] Blender 有界整网格 Individual Inset Faces：ActionCatalog `1.15.0` 冻结 `1.14.0`，新增
      `blender.mesh.edit_inset_faces`；只接受 IDs/受管名称、`thickness: 0.0001..100` 和
      `depth: -100..100`。目标必须是 Object Mode、无 Modifier/Shape Key 的 receipt-owned 非空
      closed manifold Mesh，且所有面面积有限为正。动作固定 BMesh individual inset 的
      even/interpolate 为 true、relative 为 false，复制、标记并换链 replacement Mesh。若面环总数为
      `L`，结果精确为 `V+L / E+2L / F+L`；closed manifold 下等价于 `V+2E / 5E / F+2E`，
      源/结果均受 8192/16384/8192 上限约束。它使用专用 `mesh_faces_inset` Observation、
      fail-closed 补偿和独立 Blender 原生 Undo/Redo。InteractionCatalog `1.25.0` 冻结 `1.24.0`，
      声明 `TAB → 3 → A → I → F9 → Thickness → Depth → Individual true → ENTER → TAB` 十步
      candidate shortcut；menu/MCP unavailable，且原生 in-place mutation 不等价于 managed
      replacement transaction。见 [ADR 0062](adr/0062-bounded-individual-inset-faces.md)。
- [x] Blender 有界整网格 Poke Faces：ActionCatalog `1.16.0` 冻结 `1.15.0`，新增
      `blender.mesh.edit_poke_faces`；只接受 IDs/受管名称和 `offset: -100..100`。目标必须是 Object Mode、
      无 Modifier/Shape Key 的 receipt-owned 非空 closed manifold Mesh；每个顶点必须形成单一 manifold
      face fan，且所有面面积有限为正。动作固定
      BMesh `center_mode=MEAN_WEIGHTED` 与 `use_relative_offset=false`，复制、标记并换链 replacement Mesh。
      若面环总数为 `L`，结果精确为 `V+F / E+L / L` 且全部为 triangle；closed manifold 下等价于
      `V+F / 3E / 2E`，源/结果均受 8192/16384/8192 上限约束。它使用专用
      `mesh_faces_poked` Observation、source/result `mesh_content` guard、fail-closed 补偿和独立 Blender
      原生 Undo/Redo。InteractionCatalog `1.26.0` 冻结 `1.25.0`，声明
      `TAB → 3 → A → F3(query="poke faces") → ENTER → F9 → Offset → ENTER → TAB` 九步 candidate
      shortcut；menu/MCP unavailable，且原生 in-place mutation 不等价于 managed replacement
      transaction。见 [ADR 0063](adr/0063-bounded-edit-mode-poke-faces.md)。
- [x] Blender 有界单轴 Mirror Modifier：ActionCatalog `1.17.0` 冻结 `1.16.0`，新增
      `blender.modifier.add_mirror` 与 `geometry.mirror_modifier`。动作只接受 `targetId`、`modifierId`、
      受管名称和单一 `X/Y/Z` 本地轴；要求 Object Mode、无 Shape Key、全部前置 Modifier 均 receipt-tracked、
      不存在既有 MIRROR，并限制源、evaluated input、两倍投影和真实 evaluated output 为
      8192/16384/8192。merge 固定为 true 且 threshold 0.001，bisect/flip/clip/UV/UDIM 关闭，offsets 归零，
      Mirror Object 为空、vertex-group mirroring 开启。receipt 同时保护完整 ModifierState、Object→Mesh
      绑定与源 Mesh 内容；严格 `modifier_ready` Observation、fail-closed Back 和原生 Undo/Redo 已在
      Blender 4.5.3/5.1.1 验证。InteractionCatalog `1.27.0` 冻结 `1.26.0`，保存
      `Layout → Owned Mesh → Modifiers → Add Modifier → Generate → Mirror → Managed Mirror Contract`
      七步语义路径；真实 Properties/Shift+A 前台回放只证明原生菜单别名，menu/shortcut/MCP materialization
      均 unavailable。见 [ADR 0064](adr/0064-bounded-mirror-modifier.md)。
- [x] `operatingline.planning.context`：把目录、协议约束和宿主状态组合成供应商无关的规划上下文。
- [x] 节点引用与异步修订请求：在活动树或待审树选择 `Ref`，绑定完整 base Plan、稳定节点 ID、
      显示编号和精确目录版本。
- [x] 请求关联重规划：MCP 客户端读取待处理请求并提交完整的新 Plan revision；Proposal 只投递给
      发起实例，仍需 Blender 内接受或拒绝。
- [x] 线性多轮修订与差异审查：请求保存 `threadId + turn + parentRequestId`，后续请求必须以父
      Proposal 的完整计划为基线；每个重规划 Proposal 携带确定性 Plan/节点/字段/参数 diff，
      Blender 在接受前展示摘要。
- [x] 可分页修订消息历史：从规范化请求、Proposal 与同实例人工决策派生完整 turn 记录；MCP/HTTP
      可按 `beforeTurn` 向前查询，Blender 可查看最近轮次、展开已加载内容并继续加载更早页面。
- [x] Eval/replay 证据导出：按 adapter、Plan 和可选实例导出目标、精确目录、完整提案、人工决策、
      步骤观察与回退；format `1.1.0` 在第一页冻结 `snapshotUpperSequence`，后续页必须复用
      `snapshotId + snapshotUpperSequence`，因此新追加事件不会改变同一次导出的关系、汇总或分页内容。
      Bundle 继续使用内容哈希，且不虚构质量评分。
- [x] 跨目标结构规划质量基线：历史 catalog `1.2.0` 发布有序阶段画像；MCP/HTTP 可对完整候选 Plan
      检查阶段树、资源依赖、锚点和观察，Proposal 自动执行同一门禁；雪人和机器人两个目标均通过，
      机器人参考计划已在 Blender 4.5/5.1 中完成建模、材质、渲染与全量回退。
- [x] 目录约束的目标需求覆盖证据：Blender catalog `1.22.0` 提供十九项 `semanticCapabilities`；
      capability-aware Planning/Replanning Packet `1.1.0` 要求 provider 声明
      `requirement -> capability -> executable leaf`，quality baseline `1.1.0` 确定性拒绝缺失、未知、
      action 不匹配或局部范围外的映射。无能力的历史目录仍使用 packet/baseline `1.0.0` 精确回放；
      coverage 随 quality 事件进入 Eval，但不产生语义分数或自动创建 Proposal。见
      [ADR 0017](adr/0017-catalog-grounded-goal-coverage.md)。
- [x] 供应商无关 Planner Packet：MCP Prompt、MCP Tool 与 HTTP 复用同一版本化构建器，提供一致的
      PlanningContext、Proposal 草案 Schema 和 evaluate→propose 规则；生成事件进入 Eval，不依赖
      已弃用的 MCP Sampling，也不在 Orchestrator 保存模型密钥。
- [x] 宿主发起 Goal-to-Guidance：Blender 可从 Sidebar 提交不可变自然语言目标；MCP 客户端通过
      `goal.requests.list` 与 `goal.prompt.get` 取得精确 packet，再把完整 draft 与 `goalRequestId` 交给
      既有 `guide.propose`。请求和 Proposal 只绑定原宿主实例，默认不自动调用 Provider；Accept 前不
      替换 Session 或修改场景。Synthetic Canvas contract 与真实 Blender 跨进程闭环均已验证。见
      [ADR 0020](adr/0020-host-initiated-goal-to-guidance.md)。
- [ ] 宿主授权的异步 Initial Plan Run（暂停，等待签署 packet-bound authority）：未来恢复时必须由可信
      operator 签发与 Goal packet、Provider、披露数据、调用上限和有效期精确绑定的单次 authority；Blender
      不得自签或用 boolean confirmation 代替。
      Runtime 快速返回 `202`，只在严格结果 ready 时创建待审 Goal Proposal；generation fingerprint、事件和
      原子 `generation -> proposal` 关联证明精确授权来源，重启不重复 Provider 调用。默认 standalone 仍
      provider-free，外部 Codex/Claude MCP 路径保持可用。见
      [ADR 0021](adr/0021-host-authorized-asynchronous-initial-plan-runs.md)。
- [x] 显式 Planner Provider 契约与运行时边界：嵌入方可注入进程内插件，MCP/HTTP 可列出并明确选择
      provider；核心只发送严格 Planner Packet，验证返回草案、identity、嵌套 ActionCatalog 参数和
      结构质量，固定返回 `proposalCreated: false`，并记录可重放 requested/completed/failed 证据。
      默认 standalone 保持 provider-free，核心不读取凭据或自动选择模型。
- [x] 首个具体厂商插件：可选 `@operatingline/openai-planner-provider` 通过官方 OpenAI SDK 调用
      Responses API，要求明确模型与凭据，固定 `store: false`、32,768 输出 token 上限、
      `maxRetries: 0` 并传递
      `AbortSignal`。当前动态 action/observation records 使用 JSON Object mode，核心继续执行权威
      严格验证。独立 `services/openai-runtime` 与 `pnpm dev:openai` 显式装配该远端、provider-managed
      插件，不改变默认 standalone。
- [x] 类型化 Provider 节点局部重规划：当前 capability-aware `ReplanningPromptPacket 1.1.0` 绑定 immutable request、
      精确目录、实例状态与 `referenced_subtrees_v1` scope；Provider 可选实现 `replan()`，MCP/HTTP 提供
      list/prompt/generate/propose 顺序。初始与局部生成共享调用、并发、超时和持久 request ID 管理；
      `generate` 固定不建 Proposal，只有携带 canonical `generationRequestId` 的显式 `replan.propose` 才在
      同一事务记录 Proposal、请求关联与 provenance。相关事件已进入 Eval 路由；OpenAI opt-in provider
      同时支持初始规划和局部重规划，默认 standalone 仍 provider-free。
- [x] Blender 原生 Revision Workspace：在一个可折叠操作日志中组合当前基线、最多 8 个
      结构化节点引用、逐条移除、独立修订正文、线性历史、Plan diff 和 Accept/Reject。引用去重，
      跨基线引用会显式失败而不丢失草稿；折叠或 `Hide Guidance` 不丢失状态。发送只排队，
      不会自动调用 provider 或修改场景。
- [x] Revision 参数表单：Guide/Companion protocol `1.3.0` 为直接引用 action 参数增加精确
      `before/after` edits；Blender 从打包 ActionCatalog 派生 boolean/integer/number/enum/定长数值向量
      控件，编辑仅落入本地草稿。Orchestrator 核对 base 与完整 action schema，Provider 未精确应用时
      locality gate 拒绝。普通 string 与嵌套 records 仍只读。见
      [ADR 0033](adr/0033-catalog-derived-revision-parameter-forms.md)。
- [x] 显式 revision 分支与确定性合并：Guide/Companion protocol `1.4.0` 为每个请求增加
      `revise | fork | merge` 操作；thread 内继续保持唯一 parent，fork/merge source 建立显式 DAG 边。
      Runtime 只接受同宿主/目录/Plan 的已接受当前 head，以唯一最低共同祖先执行递归三方合并；独立
      字段组合，同字段分歧、delete-vs-edit、歧义 merge base、空 source contribution 或 source 前移均
      fail closed。Provider 必须原样返回 `expectedMergedPlan`，Proposal 保存 merge base 并继续经过
      Accept/Reject。Blender 可 Fork、Merge 和 Switch 已接受 head；这些操作都不执行 action 或修改场景。
      见 [ADR 0034](adr/0034-explicit-revision-branches-and-three-way-merge.md)。
- [x] 签名授权的异步 Replan Run 边界：`CompanionReplanRun 1.1.0` 只接受可信 operator 签发、绑定精确
      Provider descriptor/model、canonical packet、披露数据与有效期的 `ProviderCallAuthorization`；Blender
      不自签或以 boolean confirmation 代替。Orchestrator 持久化并单次消费授权后立即返回 `202`，后台复用严格 provider generation 与 canonical propose；
      Blender 只做短状态轮询。单实例 Run/待决 Proposal 互斥，失败或重启不自动重试；所有生成状态和
      Proposal preview 都不改场景或 active Session，仍需 Accept/Reject，`Next` 才执行动作。
- [x] 人工 Eval 采集基础设施：新增独立 `HumanEvalSuite`、`ProviderEvalRun`、
      `HumanEvalAnnotation`/`HumanEvalAdjudication` 与无分数 `HumanEvalComparisonReport` 协议，内部
      `@operatingline/eval-kit` 验证跨记录引用、精确 catalog/base Plan、内容哈希、安全 artifact、冻结
      live 事件链、盲审/裁决和 released readiness；published report 要求 artifact-verified dataset。
      `pnpm eval:check` 与 `pnpm eval:report` 可验证和报告目录数据集。首个 Blender suite 处于
      `collecting`，包含 7 个案例、6 条 lineage，并禁止 synthetic Run 进入 published comparison。
      见 [ADR 0018](adr/0018-versioned-human-eval-evidence.md)。
  - [x] 确定性 Human Eval 发布候选门：`pnpm eval:release-check` 只读接受 artifact-verified、状态为
        `released` 的完整目录，绑定全部 Run、annotation 历史、adjudication、blind sign-off、artifact 与
        runtime attestation 摘要，不含运行时时间或路径。candidate 只作为后续
        `DatasetReleaseAuthorization` 的精确目标，不执行发布，也不改变 `trainingUse: not_authorized`。
  - [x] 授权 Human Eval 最终发布登记：Bearer-authenticated Orchestrator 对 candidate 与
        `DatasetReleaseAuthorization` 做 live 签名、角色、时效、撤销和完整 binding 校验，再把授权消费、
        自包含 released manifest 与完成事件原子写入 SQLite；精确重试返回首次 manifest，scope/credential
        复用冲突 fail closed。该登记不上传或分发数据，训练仍需绑定最终 manifest hash 的独立授权。见
        [ADR 0105](adr/0105-atomic-authorized-human-eval-release.md)。
- [x] 本地 Human Eval 采集与 provider-blind 评审面：实现冻结 snapshot、`provider_only` /
      `host_execution_with_manual_artifacts` capture、每 Run 必需的独立 preparer sign-off sidecar，以及只监听回环地址的
      headless review service。普通浏览器只接收 opaque Run ID 和签署后的盲审投影，不接收 Provider
      profile、alias 清单、sidecar 或真实 Run ID；reviewer/adjudicator pseudonym 不能与 preparer 重合，
      adjudicator 也不能是该 Run 的 reviewer。默认 capture/blind/review/check/report 不调用模型 Provider
      或产生 API 费用；snapshot 只使用且不保存本地 Runtime access token。人工 artifact 模式只验证宿主
      terminal event；工程/PNG 没有 Runtime hash 绑定，只可供本地盲审，不能满足 released visual artifact
      evidence。该手工路径的 Provider profile/settings 也只是 operator-attested，Run 强制
      `not_reproducible`；运行时证明由下一个已完成里程碑补充。见
      [ADR 0019](adr/0019-local-human-eval-capture-and-blind-review.md)。
- [x] Runtime-attested Eval 证据链：opt-in Provider 在 requested/completed 事件中封存规范化
      profile/settings、treatment、request/packet/output hash；Guide/Companion `1.5.0` 终态保存 Blender
      工程副本并绑定 `.blend`/PNG hash、尺寸与渲染环境。Capture 新增
      `host_execution_with_runtime_attested_artifacts`，released 校验会从冻结事件重新核对 Run、终态报告和
      实际 artifact 字节。operator/manual 路径继续诚实降级；这不代表已经调用真实 Provider、完成人工
      盲审或发布数据集。见 [ADR 0036](adr/0036-runtime-attested-eval-evidence.md)。
- [x] Observation 成功门与恢复策略：Guide/Companion protocol `1.2.0` 为可执行叶节点增加显式
      `telemetry | success_gate` policy；失败可自动补偿并原位重试，或保留现场、锁住 Next 后通过
      `Recheck Observations`/`Back` 恢复。blocked step 不进入 completed evidence，成功报告复用放行时
      的单次 observation。内置雪人 revision 6 的 25 个叶节点全部启用自动回滚门，并在 Blender
      4.5.3/5.1.1 验证。旧 `1.0.0`/`1.1.0` 仍保持遥测。见
      [ADR 0030](adr/0030-observation-success-gates-and-recovery.md)。
- [x] 有界 Observation 自动重试：Guide/Companion `1.5.0` 可为 `rollback_step` 声明总计两次或三次
      尝试；每次失败必须先成功补偿并报告 attempt/remaining，成功只提交一个最终 `next` checkpoint，
      耗尽则以 `failed_rolled_back` 终止。中间 `retry_scheduled` 不可 finalization，成功或耗尽证据必须与
      accepted Plan 上限一致；回退失败和 `retain_for_repair` 不自动重试。见
      [ADR 0074](adr/0074-bounded-observation-retries.md)。
- [x] Blender 原生 Undo/Redo：Start、Next、Recheck、原生菜单动作与 Back 进入宿主历史；Scene
      checkpoint 同步进程内 Session，`session_uid` 重绑定 ID，Modifier 以精确 stack/property 状态
      重绑定，PNG 以哈希保护字节备份恢复。普通用户 Undo 只静默刷新 pointer，不伪造步骤事件；冲突
      会锁住引导并允许通过反向 Undo/Redo 恢复。Blender 4.5.3/5.1.1 foreground E2E 已覆盖对象、
      Bevel、Geometry Nodes、外部 Undo 与 Back 往返。见
      [ADR 0031](adr/0031-blender-native-undo-history.md)。
- [ ] 流式模型对话与授权内自动语义重规划（暂停，等待签署 packet-bound authority）：未来每轮最多两次
      Provider 调用都必须由可信签名 authority 精确绑定，Blender 不得自签或复用旧 boolean confirmation；
      首次调用的助手文本由 Runtime 持久化为 append-only revision，再由 Blender 短轮询显示。无 replan
      tool 或置信度低于固定 `0.8` 时只回答且不保存 revision request；达到阈值才原子保存候选请求并调用
      既有类型化 local replan。所有成功路径最多创建只读 Proposal，仍需 Accept/Reject，场景固定不变。
      默认不选择 Provider、不保存长期授权、不自动重试、接受或执行。见
      [ADR 0035](adr/0035-streamed-dialogue-and-semantic-replanning.md)。
- [x] 参数化多轨迹 ProcedureTree 基础：新增独立 `1.0.0` 中间表示，把视频、自然语言或人工来源组织为
      group/leaf 树；每个 leaf 用 `semanticRefs` 对齐具体、有序且可不等长的菜单、快捷键和 MCP 轨迹，
      位置、缩放、名称及函数 arguments 保存在真正输入它们的数组元素。来源证据、置信度、视频权利状态、
      ActionCatalog 绑定、Observation 与候选/验证状态一同保留；不存在的动作级 MCP 函数必须显式标记
      unavailable。Guide protocol `1.5.0` 与既有执行审批边界不变。见
      [ADR 0042](adr/0042-aligned-procedure-tree-tracks.md)。

## 后续里程碑

- [ ] 教学来源到可编辑执行树的完整闭环：把 ProcedureTree 基础推进为真实的知识采集、检索、可视化
      调整与 Blender 回放系统，而不是把 YouTube 下载或模型猜测直接当成训练真值。
  - [x] 首个证据绑定字幕切片：现有 authoring MCP/HTTP/Provider 请求可附带权利状态明确的 HTTPS 教学
        视频和 `user_supplied` 字幕分段；Runtime 校验时长内有序非重叠区间，把原文、时间与置信度规范化
        为 packet-bound source/evidence，并要求候选的每个 semantic operation 至少引用一段。普通目标继续
        使用 packet `1.0.0`，教程模式使用 `1.1.0`；两者都不自动保存、提案或执行。见
        [ADR 0075](adr/0075-evidence-bound-tutorial-transcript-authoring.md)。
  - [x] 用户提供字幕文档的确定性导入：版本化 MCP/HTTP 请求接受权利状态明确的视频和完整 SRT/WebVTT，
        严格解析 cue、时间与文本，对原始 UTF-8 内容保存 SHA-256/字节数/cue 数，并把规范化版本与统一
        置信度绑定到 authoring packet `1.2.0`。普通 `1.0.0` 和手填分段 `1.1.0` 保持不变；入口不联网、
        不转录、不调用模型、保存、提案或执行。见
        [ADR 0076](adr/0076-user-supplied-caption-document-import.md)。
  - [x] 字幕文档到显式 Provider candidate：独立 MCP/HTTP generate 请求在确定性导入后把 `1.2.0` packet
        交给调用方明确选择的 Provider，复用 request fingerprint、重启幂等、candidate identity、安装目录、
        authoring validator 与 compile 门。审计不保存原始字幕文档，结果不自动 store、materialize、propose
        或 execute。见 [ADR 0077](adr/0077-caption-document-provider-generation.md)。
  - [x] 经授权的 YouTube 字幕获取：显式 MCP/HTTP 请求在用户确认网络与配额后，通过运行时注入的 OAuth
        token 调用官方 Data API。独立 track-list MCP/HTTP 以一次 `captions.list` 的 50-unit 配额枚举可编辑
        视频的有界字幕轨元数据，不下载正文或静默选轨；调用方选择后，import 再读取视频元数据、核对一个
        精确 serving track 并下载 SRT/WebVTT，随后绑定获取 provenance 的 authoring packet `1.3.0`。请求、
        日志和事件都不含 token，completed evidence 不含原始字幕全文；两条操作均可重启幂等，且失败不使用
        同一 requestId 自动重试。入口不能抓取任意公开视频字幕，也不把编辑权限或权利声明当成 released
        训练许可。见 [ADR 0078](adr/0078-authorized-youtube-caption-acquisition.md) 与
        [ADR 0079](adr/0079-authorized-youtube-caption-track-discovery.md)。
  - [x] 需显式确认的字幕轨推荐：本地确定性入口引用已完成 list，按调用方给出的语言、track kind、audio
        track、draft、CC 与同步偏好返回稳定候选顺序、排序信号和逐轨排除原因。推荐不联网、不增加 quota、
        不下载内容、不调用 Provider、不持久化为训练标签，也不自动选择；import 仍要求精确 track ID。见
        [ADR 0080](adr/0080-explicit-youtube-caption-track-recommendation.md)。
  - [x] 字幕轨选择与理由证据：本地 MCP/HTTP 只接受明确确认的 serving track，保存受限 reason code、可选
        备注，并在给出推荐偏好时重算用户采用/覆盖结果；completed receipt 可重启幂等恢复，不联网、下载或
        调用 Provider。备注进入本地证据账本。见
        [ADR 0081](adr/0081-persisted-youtube-caption-track-selection.md)。
  - [x] 选择收据与 import 的强制 identity 绑定：当前 YouTube import request `1.1.0` 必须引用已记录的
        `selectionRequestId`，并在任何 API 调用前核对选择收据、video ID 与 caption track ID。历史 `1.0.0`
        仅保留兼容读取；成功导入生成携带非自由文本选择 provenance 的 authoring packet `1.4.0`，选择备注
        不进入 packet 或 Provider 输入。见 [ADR 0082](adr/0082-selection-bound-youtube-caption-import.md)。
  - [x] OAuth 登录、刷新与失效恢复：本地 operator CLI 使用 Google Desktop app client、临时 loopback
        callback、PKCE 与固定 `youtube.force-ssl` scope；refresh token 只保存到 OS credential vault，Runtime
        在请求前刷新，invalid grant 按凭据摘要在进程内阻断并要求重新登录，避免旧刷新删除并发写入的新授权。Logout 总是删除本地凭据并报告远端撤销
        confirmed/uncertain；API 请求后的 401 不自动重放。兼容短期 token 保留但不能与 client ID 同时设置。
        见 [ADR 0083](adr/0083-managed-youtube-oauth.md)。
  - [x] 经独立授权的 YouTube 教程媒体分析：可信服务端 registry 同时核对内容权利与独立的 YouTube 书面
        下载批准；本地 yt-dlp、ffprobe、ffmpeg、whisper.cpp 和 Tesseract 固定执行下载、探测、音频、ASR、
        证据帧、OCR 与确定性语义分段七阶段。私有 CAS 保存内容寻址产物，MCP/HTTP 提供 capabilities、异步
        create/status 和显式 restart；失败只能从 download 全量重启且不复用部分阶段。未配置时安全报告
        unavailable；结果不会生成 ProcedureTree。见
        [ADR 0084](adr/0084-authorized-youtube-media-analysis.md)。
  - [x] 已选官方字幕到不可变候选树的分阶段工作流：异步 run 固定执行选择绑定的 caption import、显式
        Provider generation 和目录 materialization，再暂停并要求精确 review ID 与 packet/candidate/materialized
        三哈希确认；通过后把 ProcedureTree 与完整 binding 证据原子存储。外部阶段不会在重启后自动重放，
        完成态不表示 Proposal、宿主执行或验证。见
        [ADR 0085](adr/0085-selected-caption-procedure-authoring-run.md)。
  - [x] 已验证媒体 manifest 到 authoring 准备：完成任务以 request/job id 取回并重新验证 CAS/manifest，
        把 semantic/ASR/frame/OCR/UI/shortcut candidate 精确绑定到最终 prompt evidence id；跨时段或无 grounding
        signal 的 segment 返回 blocker 与 `packet=null`。该入口不调用 Provider 或生成树。见
        [ADR 0096](adr/0096-verified-media-authoring-preparation.md)。
  - [x] 已验证媒体到完整候选树的分阶段工作流与可视化审阅入口：只接受服务端保留的 exact ready
        preparation，异步执行一次 Provider generation 与确定性 materialization，再以 preparation/packet/
        candidate/materialized 四重绑定暂停等待人工审阅；store 与 completed evidence 原子提交，崩溃恢复
        不重放 Provider，UI 的 Provider 与 review 确认绑定精确 descriptor/run/hash，并可直接打开已存树编辑器。
        见 [ADR 0097](adr/0097-reviewed-media-procedure-authoring-run.md)。
  - [ ] 用真实双人盲审标准校准教学视频的大步骤/小步骤层级、语义质量及 released dataset 准入。
  - [ ] ActionCatalog/InteractionCatalog 检索与增量覆盖：只有项目尚未支持且经过版本化真实宿主验证的
        菜单、快捷键别名和 MCP 函数映射，才能从 candidate 晋升为 verified。
  - [x] ProcedureTree 本地可视化 revision 编辑器：Orchestrator 工作台显示树节点与 semantic/menu/shortcut/MCP
        轨迹，支持节点增删/移动/重排、树/节点文本、目录证明的 Action 参数和锚点评论；Action 修改由
        `parameterProjection 1.0.0` 确定性同步到 semantic/menu/shortcut，旧树和 omitted 参数只读。所有修改先由服务端生成 stable-ID diff preview，
        再以全局 immutable revision CAS 提交。分支保留独立 head，merge 使用唯一最低共同祖先和确定性三方
        合并并逐冲突选择 target/source/base/custom，缺失、篡改或投影不一致的 resolution fail closed；branch、history 和树哈希外的 append-only comment 可跨重启恢复。入口不调用
        Provider、不创建 Proposal 或执行 Blender。见
        [ADR 0088](adr/0088-local-procedure-tree-revision-editor.md)。
  - [x] ProcedureTree → GuidePlan 确定性编译器：保留层级、依赖、Action、Anchor、Observation、成功门
        和回退，并通过当前 Blender ActionCatalog 校验；编译本身不提交、接受或执行计划。
  - [x] 执行轨迹确定性物化：按依赖安全的叶子顺序串联一个可用菜单/快捷键/MCP 轨迹；多别名必须
        显式选择 track ID，缺失、歧义或 unavailable 轨迹 fail closed。
  - [x] 只读 Runtime 编译入口：MCP `operatingline.procedure.compile` 与 HTTP
        `/api/v1/procedure/compile` 验证树、已安装精确 ActionCatalog 和 host version range，返回编译后的
        GuidePlan，但明确标记 interaction track 仅完成结构验证且不会创建 Proposal 或启动宿主执行。
  - [x] 不可变 ProcedureTree 资料库：通过内容哈希、`tree id + revision` 唯一键、单调 revision、原子审计
        事件及游标分页，持久保存经过完整编译门禁的树；MCP/HTTP 支持 store、精确/最新 get 和摘要 list，
        重启后仍可读取，但不会发布 GuidePlan、创建 Proposal 或执行宿主。见
        [ADR 0043](adr/0043-immutable-procedure-tree-library.md)。
  - [x] 不可变 ProcedureTree 精确操作索引：规范化索引 semantic 及 available 菜单、快捷键和 MCP
        operation；MCP/HTTP 以 AND 组合的精确结构 selector 返回 revision、节点、验证状态、来源和证据。
        `indexSequence` 只用于存储分页，不表示操作顺序；结果没有相似度分数或 semantic embedding，也不
        启动宿主执行。见 [ADR 0044](adr/0044-exact-procedure-operation-index.md)。
  - [x] Provider-neutral ProcedureTree 语义检索与 RAG context：显式授权后把自然语言 query 与 latest
        immutable tree 的有界 leaf 文档交给支持 embedding/runtime treatment 的 Provider；默认只检索
        verified leaf，且文档不含 source/evidence 原文。核心校验向量并计算稳定 cosine 排名，公开结果
        保留完整 leaf、真实 validation 与 Provider/model/corpus/batch/document 内容摘要，但不含向量。
        requested-only/failed 调用重启不自动重放，结果不保存新树、创建 Proposal 或执行宿主。首版仍是
        bounded live batch，没有持久 vector cache/ANN 或召回 Human Eval。见
        [ADR 0086](adr/0086-provider-neutral-procedure-semantic-retrieval.md)。
  - [x] 供应商无关的自然语言 Procedure 编写 packet：MCP/HTTP 将目标、固定来源证据、tree identity、
        精确 ActionCatalog/InteractionCatalog 与 candidate-only 响应 Schema 交给当前 MCP 宿主模型；
        当前只生成层级、语义 operation 和 Action 参数，菜单、快捷键与 MCP 轨迹强制 unavailable；目录和
        精确检索结果仅作为后续 grounding 候选。候选与原 packet 通过服务端 authoring validate 核对 canonical
        SHA-256、已安装目录、固定 identity/provenance 和 candidate-only 契约，再走既有 compile；packet 去掉
        重复 rendered prompt；当前 packet 有 512 KiB canonical 上限，历史 256 KiB packet 仍按自身预算
        fail closed。该流程不调用模型、不自动保存、创建 Proposal 或
        执行宿主，也不声称已经实现语义 RAG。见
        [ADR 0045](adr/0045-provider-neutral-procedure-authoring.md)。
  - [x] 显式 Procedure Provider coordinator：MCP/HTTP 先公开支持 authoring 的已配置 Provider 与传输/凭据
        披露；显式 generate 才把规范编码的完整 packet 交给 Provider。返回 candidate 立即经过严格 Schema、
        packet identity、installed catalog 与 compile 门；requested/completed/failed evidence 支持重启幂等，
        成功也不自动 store、materialize、propose 或执行。Procedure runtime attestation 与既有 Plan Eval
        operation 隔离。见 [ADR 0070](adr/0070-explicit-procedure-authoring-provider.md)。
  - [ ] 确定性交互 grounding/materialization：给 operation 增加可验证的 InteractionCatalog recipe/step
        或 verified Procedure operation provenance，将候选物化成包含精确菜单、快捷键、MCP 参数的 available
        轨迹；通用 compile 在此之前继续明确标记 interaction tracks 为 structural-only。
    - [x] 首个目录绑定菜单 grounding 切片：新增供应商无关的 MCP
          `operatingline.procedure.authoring.materialize` 与 HTTP
          `/api/v1/procedure/authoring/materialize`，复用原 packet + candidate 并重新执行 packet-bound
          validation。Blender InteractionCatalog `1.10.0` 仅为 UV Sphere 通过封闭声明启用按 catalog step
          顺序、累计 label、完整 semantic/evidence refs 和最终 accepted-action 参数生成的菜单轨迹；track/
          operation ID 与 catalog version 保留可重建的 recipe/step provenance。shortcut/MCP 确定性 unavailable，
          leaf 仍为 candidate，历史 `1.9.0` 可回放；结果带已安装目录 digest、输入/输出 tree hash 和逐 leaf
          coverage。完整 result 信封才构成该证明；单独抽取或经通用 store 保存的 tree 仍是
          `structural_only`。该切片不调用模型、保存、创建 Proposal 或执行 Blender。见
          [ADR 0046](adr/0046-catalog-bound-procedure-materialization.md)。
    - [x] 有序逐控件参数 DSL：InteractionCatalog `1.11.0` 的封闭
          `ordered_parameter_operations` 声明把 UV Sphere 物化为四步菜单加 Location、Scale、Object Name
          三个带精确值的控件 operation；目录安装期要求 Action 参数恰好映射或带理由省略，并限制为 literal、
          顶层 argument、identity/uniform-vector 转换。结果格式 `1.1.0`，旧 `1.10.0` 四步算法继续返回
          `1.0.0`。radius→scale 仍是 candidate 教学投影，不是宿主状态等价证明。见
          [ADR 0047](adr/0047-ordered-procedure-parameter-operations.md)。
    - [x] 候选快捷键物化：InteractionCatalog `1.12.0` 为 UV Sphere 声明六步 ordered shortcut；
          chord/sequence、selection path、参数顺序与 `vector3_x/y/z` 分量投影均可安装期验证，结果格式为
          `1.2.0`。该轨迹仍是 `candidate_only`/`structural_only`，不构成 Blender 状态等价证明。见
          [ADR 0048](adr/0048-candidate-shortcut-procedure-materialization.md)。
    - [x] 第二个 action 的有序菜单物化：InteractionCatalog `1.13.0` 为 Icosphere 声明六步 ordered menu；
          四步原生 guidance 后依次绑定 Location 与 Object Name，并在 operator step 绑定
          `subdivisions`/`radius`。`resourceId` 显式省略，Result 使用 `1.1.0`；shortcut 未声明，MCP 因没有
          真实 action-level tool 仍 unavailable。历史 `1.12.0` 逐字回放。见
          [ADR 0049](adr/0049-icosphere-ordered-menu-materialization.md)。
    - [x] 第三个 action 的有序菜单物化：InteractionCatalog `1.14.0` 为 Cube 声明六步 ordered menu；四步
          原生 guidance 的 operator step 以 identity 投影绑定完整边长 `size`，再依次绑定 Location 与 Object
          Name，且显式省略 `resourceId`。`size` 不是 transform scale；Result 使用 `1.1.0`，shortcut/MCP
          均 unavailable，历史 `1.13.0` 逐字回放。轨迹仍为 `candidate`/`structural_only`，没有真实 Blender
          replay；原生菜单/operator 不复现 managed collection、resource tag、receipt、幂等或补偿语义。见
          [ADR 0050](adr/0050-cube-ordered-menu-materialization.md)。
    - [x] 第四个 action 的有序菜单物化：InteractionCatalog `1.15.0` 为 Plane 声明六步 ordered menu；四步
          原生 guidance 的 operator step 以 identity 投影绑定完整边长 `size`，再依次绑定 Location 与 Object
          Name，并显式省略 `resourceId`。`size` 不是 transform scale；Result 使用 `1.1.0`，shortcut/MCP
          均 unavailable，历史 `1.14.0` 逐字回放。轨迹仍为 `candidate`/`structural_only`，没有完整 UI operation
          的真实 Blender replay；原生菜单/operator 不复现 managed collection、resource tag、receipt、幂等或
          补偿语义。见 [ADR 0051](adr/0051-plane-ordered-menu-materialization.md)。
    - [x] 第五个 action 的有序菜单物化：InteractionCatalog `1.16.0` 为 Torus 声明六步 ordered menu；四步
          原生 guidance 的 operator step 按顺序以 identity 投影绑定 `majorSegments`、`minorSegments`，固定
          literal `mode: MAJOR_MINOR`，再绑定 `majorRadius` 与 `minorRadius`，随后依次绑定 Location 与 Object
          Name，并显式省略 `resourceId`。
          Result 使用 `1.1.0`，shortcut/MCP 均 unavailable，历史 `1.15.0` 逐字回放。轨迹仍为
          `candidate`/`structural_only`，没有完整 UI operation 的真实 Blender replay；原生菜单/operator 不
          复现 managed collection、resource tag、receipt、幂等或补偿语义。见
          [ADR 0052](adr/0052-torus-ordered-menu-materialization.md)。
    - [x] 第六个 action 的有序菜单物化：InteractionCatalog `1.17.0` 为 Cone 声明六步
          ordered menu；四步 guidance 的 operator step 按序绑定 `vertices: 32`、
          `radius1 ← radiusStart`、`radius2 ← radiusEnd`、`depth ← distance`、
          `end_fill_type: NGON`、`calc_uvs: false`、`enter_editmode: false`、`align: WORLD`、
          `location: [0,0,0]`、canonical zero-roll XYZ `rotation`、`scale: [1,1,1]`，再绑定
          中点 Location 与 Object Name。封闭 `derived_action_arguments`/`segment_frame` 要求
          `distance`、`midpoint`、`rotation_euler_xyz_align_z` 三个输出各恰好一次并规范化
          `-0`。该 Euler 不声称与 managed executor quaternion/roll 精确等价。`resourceId`
          省略，Result 使用 `1.1.0`，shortcut/MCP unavailable，历史 `1.16.0` 冻结并精确回放。
          轨迹仍为 `candidate`/`structural_only`；Blender 4.5/5.1 原生 operator 双版本探针不是完整六步 UI replay，
          也不复现 collection/tag/receipt/idempotency/compensation。见
          [ADR 0053](adr/0053-cone-segment-frame-menu-materialization.md)。
    - [x] 第七个 action 的有序菜单物化：InteractionCatalog `1.18.0` 为 Cylinder 声明六步
          ordered menu；四步 guidance 的 operator step 按序绑定 `vertices: 32`、
          `radius ← radius`、`depth ← distance`、`end_fill_type: NGON`、`calc_uvs: false`、
          `enter_editmode: false`、`align: WORLD`、`location: [0,0,0]`、canonical zero-roll XYZ
          `rotation`、`scale: [1,1,1]`，再绑定中点 Location 与 Object Name。它复用封闭
          `segment_frame` 公式，且 `distance`/`midpoint`/`rotation_euler_xyz_align_z` 各恰好一次。
          本地 `+Z` 对齐 `end-start`，本地 `-Z` 端对应 `start`，本地 `+Z` 端对应
          `end`，两端同一 `radius`；该 Euler 不声称与 managed executor quaternion/roll 精确等价。
          `resourceId` 省略，Result 使用 `1.1.0`，shortcut/MCP unavailable，历史 `1.17.0`
          冻结并精确回放。轨迹仍为 `candidate`/`structural_only`；Blender 4.5/5.1 原生
          operator 双版本探针不是完整六步 UI replay，也不复现
          collection/tag/receipt/idempotency/compensation。见
          [ADR 0054](adr/0054-cylinder-segment-frame-menu-materialization.md)。
    - [x] Cube 候选快捷键物化：InteractionCatalog `1.19.0` 继续精确绑定 ActionCatalog `1.12.0`，
          冻结 `1.18.0`，并在既有 Cube 六步 menu 之外声明 candidate-only 六步 shortcut。六项前置条件
          固定为 `Layout`、`VIEW_3D`、`OBJECT`、Blender keymap、3D Cursor `[0,0,0]` 与 GLOBAL
          Transform Orientation；轨迹依次为 `Shift+A → Mesh → Cube`（默认 `size: 2`、origin）、
          `G X`、`G Y`、`G Z`、`S`、`F2`。移动绑定 `location` 三分量，`S` 使用封闭
          `divide_by_two` 绑定 `size / 2`，`F2` 绑定 `objectName`；`resourceId` 显式省略，MCP
          unavailable，Result 使用 `1.2.0`。Icosphere shortcut 仍 unavailable。Blender 4.5.3/5.1.1
          operator/transform 探针不是实际键盘事件或完整 UI replay，并保留未 bake 的
          `scale = size / 2`，不等价于 managed executor 的 baked mesh/`scale = 1`，也不提供
          collection/tag/receipt/idempotency/compensation 等价。见
          [ADR 0055](adr/0055-cube-candidate-shortcut-materialization.md)。
    - [x] Plane 候选快捷键物化：InteractionCatalog `1.20.0` 继续精确绑定 ActionCatalog `1.12.0`，
          冻结 `1.19.0`，保留既有 Plane 六步 menu，并声明 candidate-only 六步 shortcut。它复用 Cube
          的六项精确前置条件与封闭 `divide_by_two`：`Shift+A → Mesh → Plane` 使用默认 `size: 2`、
          origin，随后以 GLOBAL `G X`、`G Y`、`G Z` 绑定 `location` 三分量，`S` 绑定 `size / 2`，
          `F2` 绑定 `objectName`。`resourceId` 显式省略，MCP unavailable，Result 使用 `1.2.0`；
          Cube 与 UV Sphere shortcut 保持 available，Icosphere、Torus、Cone、Cylinder shortcut 保持
          unavailable。冻结的 `1.19.0` 中 Plane shortcut 仍 unavailable。Blender 4.5.3/5.1.1 Plane
          operator/transform 探针不是实际键盘事件或完整 UI replay；它保留默认未 bake Plane mesh 与
          `scale = size / 2`，不等价于 managed executor 的 baked mesh/`scale = 1`，也不提供
          collection/tag/receipt/idempotency/compensation 等价。见
          [ADR 0056](adr/0056-plane-candidate-shortcut-materialization.md)。
    - [x] Operator 参数 surface 协议与检索基础：保留历史无 `kind` shortcut，新增严格的 `F9` opener、
          连续逐控件 `operator_property_update` 与 `ENTER` closer 状态机；实际使用时输出 ProcedureTree
          `1.1.0` / Result `1.3.0`。Blender Python loader 执行同构验证，Schema 14 可按 operation kind、
          target/path、共享 surface 与 expected operator 精确检索完整链并恢复中断迁移。冻结的
          InteractionCatalog `1.20.0` 不启用该能力，Icosphere shortcut 保持 unavailable。见
          [ADR 0057](adr/0057-shortcut-operator-property-surfaces.md)。
    - [x] Icosphere F9 候选快捷键物化：InteractionCatalog `1.21.0` 继续绑定 ActionCatalog `1.12.0`，
          冻结 `1.20.0`，并声明 `Shift+A → Mesh → Ico Sphere`、`F9` opener、Subdivisions、Radius、
          `ENTER` closer、`G X/Y/Z` 与 `F2` 的九步 ordered shortcut。真实前台 event replay 在 Blender
          4.5.3/5.1.1 中均把参数改为 3/2.5，并验证 162 顶点与顶点半径；Result 使用 `1.3.0`。
          轨迹仍为 candidate/structural-only，MCP unavailable；后续移动/重命名的完整 UI replay、产品级
          Observation 成功门、恢复策略、原生 Undo 与 managed action 等价仍未完成。见
          [ADR 0058](adr/0058-icosphere-f9-shortcut-materialization.md)。
    - [x] Edit Mode Subdivide F9 候选快捷键物化：InteractionCatalog `1.22.0` 继续绑定 ActionCatalog
          `1.12.0`，冻结 `1.21.0`，并为既有 managed copy/swap `semantic_path` 声明九步 shortcut：
          `TAB`、`A`、`F3`（literal query `subdivide`）、`ENTER`、`F9`、Number of Cuts、Smoothness、
          `ENTER`、`TAB`。
          `cuts = 2`、`smooth = 0.25` 的真实前台 event replay 在 Blender 4.5.3/5.1.1 中均得到
          56 vertices、108 edges、54 polygons，并证明 Mesh pointer 与 datablock 数量不变。menu/MCP
          unavailable，`targetId`、`resultMeshId`、`resultMeshName` 显式省略；轨迹仍为
          candidate/structural-only，不提供产品级 Observation、恢复、原生 Undo 或 managed action 等价。
          见 [ADR 0059](adr/0059-edit-mode-subdivide-f9-shortcut-materialization.md)。
    - [x] Subdivision Surface Modifier 候选快捷键物化：InteractionCatalog `1.23.0` 绑定新增该 action 的
          ActionCatalog `1.13.0`，冻结 `1.22.0`，并声明 `Ctrl+1` 的 literal 来源参数、`F9` opener、
          accepted `viewportLevel` 对 Level 控件的绑定和 `ENTER` closer。Blender 4.5.3/5.1.1 各自回放
          level 1/2/3，验证 `26/48/24`、`98/192/96`、`386/768/384` vertices/edges/polygons、固定
          render level 2，以及源 Mesh pointer/datablock 不变。`F3` 搜索路径实测不可用，因此未收录；
          menu/MCP unavailable，`targetId`、`modifierId`、`modifierName` 显式省略。轨迹仍为
          candidate/structural-only；managed action 的 Observation、补偿与原生 Undo 证据不使 UI 路径与
          managed transaction 等价。见 [ADR 0060](adr/0060-bounded-subdivision-surface-modifier.md)。
    - [x] Edit Mode Bevel F9 候选快捷键物化：InteractionCatalog `1.24.0` 绑定 ActionCatalog `1.14.0`，
          冻结 `1.23.0`，并声明 `TAB`、Edge Select `2`、`A`、`Ctrl+B`、`F9`、Width、Segments、Profile、
          `ENTER`、`TAB` 十步 ordered shortcut。Blender 4.5.3/5.1.1 的真实前台 event replay 均把
          `width/segments/profile` 设置为 `0.2/3/0.6`，得到 96 vertices、192 edges、98 polygons，并证明
          Mesh pointer 与 datablock 数量不变。menu/MCP unavailable，三个 managed identity 参数显式省略；
          轨迹仍为 candidate/structural-only，不声称与 managed replacement Mesh、Observation、补偿或
          原生 Undo 等价。见 [ADR 0061](adr/0061-bounded-edit-mode-bevel-edges.md)。
    - [x] Individual Inset Faces F9 候选快捷键物化：InteractionCatalog `1.25.0` 绑定
          ActionCatalog `1.15.0`，冻结 `1.24.0`，并声明 `TAB`、Face Select `3`、`A`、`I`、`F9`、
          Thickness、Depth、Individual true、`ENTER`、`TAB` 十步 ordered shortcut。`I` 来源步骤包含
          完整 literal 默认值和内嵌 `ENTER`。Blender 4.5.3/5.1.1 的真实前台 event replay 均把
          `thickness/depth/individual` 设置为 `0.2/0.1/true`，得到 32 vertices、60 edges、
          30 个全 quad polygons、6/30 结果面选择和 ±1.1 坐标边界，并证明 Mesh pointer 与
          datablock 数量不变。Harness 只证明已发送 popup 关闭事件。menu/MCP unavailable，
          三个 managed identity 参数显式省略；轨迹仍为 candidate/structural-only，不声称与
          managed replacement Mesh、Observation、补偿或原生 Undo 等价。见
          [ADR 0062](adr/0062-bounded-individual-inset-faces.md)。
    - [x] Poke Faces F9 候选快捷键物化：InteractionCatalog `1.26.0` 绑定 ActionCatalog `1.16.0`，
          冻结 `1.25.0`，并声明 `TAB`、Face Select `3`、`A`、`F3(query="poke faces")`、`ENTER`、`F9`、
          Offset、`ENTER`、`TAB` 九步 ordered shortcut。来源 operator 的完整 UI 默认值为
          `offset=0`、`use_relative_offset=false`、`center_mode=MEDIAN_WEIGHTED`；F9 控件把 accepted
          `offset` 写入 `mesh.poke.offset`。Blender 4.5.3/5.1.1 的真实前台 event replay 均把 offset
          设置为 `0.2`，使 Cube 从 8/12/6 变为 14/36/24；24 个结果面均为 selected triangle，坐标边界
          为 ±1.2，Mesh pointer 与 datablock 数量不变。现代默认 keymap 没有 Poke Faces 直达键，legacy
          `Alt+P` 不进入默认轨迹。menu/MCP unavailable，三个 managed identity 参数显式省略；轨迹仍为
          candidate/structural-only，不声称与 managed replacement Mesh、Observation、补偿或原生 Undo
          等价。见 [ADR 0063](adr/0063-bounded-edit-mode-poke-faces.md)。
    - [x] Mirror Modifier 原生菜单别名证据：InteractionCatalog `1.27.0` 绑定 ActionCatalog `1.17.0`，
          冻结 `1.26.0`，并保存 Properties Modifier context 下
          `Add Modifier → Generate → Mirror` 的真实 Host 菜单与 operator 标识。Blender 4.5.3/5.1.1
          的前台 event replay 都通过 `Shift+A` 打开 Add Modifier、筛选并选择 Mirror，验证
          `OBJECT_OT_modifier_add(type=MIRROR, use_selected_objects=false)`、完整默认 RNA、Cube
          `8/12/6 → 16/24/12`，以及源 Mesh pointer/datablock 数量不变。该上下文别名无法携带 IDs、
          受管名称、安全门、Observation 或回退合同，故 menu/shortcut/MCP 仍全部 unavailable，不生成
          candidate operation 数组。见 [ADR 0064](adr/0064-bounded-mirror-modifier.md)。
    - [x] 下一确定性交互覆盖切片：InteractionCatalog `1.50.0` 为 Edit Mode Subdivide 增加十一项
          non-executable menu candidate，并在 Blender 4.5.3/5.1.1 中以收据绑定目标、真实 Select/Edge menu、
          F9 参数矩阵和四次 Undo/Redo 验证完整有界过程。候选仍为 `executionAuthority: none`；04–07 是
          exact-native 菜单标记，其余操作保持 reference-only，不把整条过程证据误写成逐控件定位证明。
  - [ ] 真实 Blender 逐叶回放：把物化轨迹继续接入安全审批、Observation、恢复策略和 Blender 原生
        Undo，并把宿主版本、结果和证据写回 verified 状态。
    - [x] 首个受管 Action 结果证明：`procedure.replay.propose` 对单一 UV Sphere leaf 重新验证/物化，
          原子保存完整 binding 与待审 Proposal；同一协商 lease 上报 accepted decision 和 terminal Companion
          report，并由服务端 receipt 序列证明先后之后，`procedure.replay.finalize` 才能用精确 identity/hash
          和 `uv_sphere_ready` 写入追加式 attestation 与
          Eval/replay 事件。只验证 managed Action 结果；menu/shortcut 未执行、MCP unavailable，也不把
          attestation 写成原生 Undo checkpoint 证明。见
          [ADR 0065](adr/0065-managed-procedure-leaf-replay-attestation.md)。
    - [x] Icosphere 受管结果证明：ActionCatalog `1.19.0` 增加 `icosphere_ready`，InteractionCatalog
          `1.29.0` 精确绑定它；同一 replay 合同接受单一 Icosphere leaf，并把 `subdivisions` 绑定到
          `10×4^(n-1)+2 / 30×4^(n-1) / 20×4^(n-1)` 的顶点/边/面数量。错误细分参数、拓扑、receipt
          action 或 Mesh 内容均 fail closed；证明范围仍不升级 menu/shortcut/MCP 或原生 Undo。见
          [ADR 0066](adr/0066-icosphere-managed-replay-attestation.md)。
    - [x] Cube/Plane 受管结果证明：ActionCatalog `1.20.0` 增加 `cube_ready` 与 `plane_ready`，
          InteractionCatalog `1.30.0` 只更新精确 binding；两种 Observation 都把 accepted `size` 绑定到
          实际局部坐标、固定 `8/12/6` 或 `4/4/1` 拓扑、receipt 和 Mesh 内容签名。错误尺寸、坐标、
          拓扑、action identity 或内容均 fail closed。见
          [ADR 0067](adr/0067-sized-primitive-managed-replay-attestation.md)。
    - [x] Torus 受管结果证明：ActionCatalog `1.21.0` 增加 `torus_ready`，InteractionCatalog `1.31.0`
          只更新精确 binding；Observation 以 `majorSegments × minorSegments` 推导动态拓扑，并按执行器的
          参数化公式逐顶点验证两组 accepted radius，包括 `minorRadius > majorRadius` 的自交形状。Torus
          没有经验证 shortcut，binding 与 attestation 因而明确保留 `unavailable`，不会虚构候选轨迹。见
          [ADR 0068](adr/0068-torus-managed-replay-attestation.md)。
    - [x] Cone/Cylinder 受管结果证明：ActionCatalog `1.22.0` 增加 `cone_ready` 与 `cylinder_ready`，
          InteractionCatalog `1.32.0` 只更新精确 binding；Observation 复算 accepted start/end 的中点、方向
          Quaternion、世界端点、32 段局部环坐标与面形。普通锥台/圆柱固定验证 `64/96/34`，单端半径为零的
          尖锥固定验证 `33/64/33`；两者的 shortcut 与 MCP 继续诚实保持 unavailable。见
          [ADR 0069](adr/0069-segment-primitives-managed-replay-attestation.md)。
    - [x] 原生 Undo checkpoint 回放证明：Companion 在报告时核对 Scene marker、journal、Session 与产物
          备份，并绑定精确 Plan/hash/execution/receipt；新的 finalize 缺失或错配 checkpoint 时 fail closed。
          attestation 明确不证明报告之后的当前场景。见
          [ADR 0071](adr/0071-native-undo-replay-checkpoint-attestation.md)。
    - [x] 按需当前状态证明：Runtime 持久化 nonce-bound challenge 并只投递给精确目标 lease；Blender 主线程
          只读复算强 Observation 与 Undo journal，结果分类为 verified 或 session/step/observation/checkpoint
          mismatch 并进入 Eval/replay；直接成功与 `recovered_after_repair` 均可复核，自动回退因没有保留 leaf
          明确拒绝。每条结果仍只证明 response report 时刻。见
          [ADR 0072](adr/0072-challenged-procedure-current-state-verification.md)。
    - [x] 失败/回退/修复恢复证明：互斥 finalizer 保存 `failed_rolled_back` 自动补偿终态，或把
          `repair_required`/`rollback_failed` 的保留 receipt `next` checkpoint 与后续强 Observation、
          `recovered` gate、`recheck` checkpoint 绑定；同 replay 不可再伪装成直接成功。见
          [ADR 0073](adr/0073-managed-procedure-failure-recovery-attestation.md)。
    - [x] 同 Action 有界重试证明：每次失败都先补偿并发出 `retry_scheduled`；成功摘要或最终
          `exhausted` 证据与 accepted Plan 的两次/三次上限绑定，且只在最终成功时产生一个原生 Undo
          checkpoint。见 [ADR 0074](adr/0074-bounded-observation-retries.md)。
    - [x] 首批 action-level MCP executor：InteractionCatalog `1.34.0` 只授权已接受 UV Sphere replay；
          `1.35.0` 冻结该历史版本，并新增 Icosphere、Cube 与 Plane。四者都复用严格
          `operatingline.blender.action.execute`，公开请求不接受 action/arguments；Runtime 从精确版本 binding
          推导参数，并继续强制 decision/Start/lease/CAS/trusted report/Observation/原生 Undo 链，成功 `next`
          checkpoint 必须直接引用 CAS 绑定的 Start checkpoint。旧 binding 不继承新权限，Torus/Cone/Cylinder
          仍 unavailable。见
          [ADR 0089](adr/0089-accepted-uv-sphere-action-level-mcp.md) 与
          [ADR 0090](adr/0090-simple-primitive-action-level-mcp.md)。
    - [x] Torus action-level MCP executor：InteractionCatalog `1.36.0` 冻结 `1.35.0`，只新增 Torus；Runtime
          从不可变 binding 派生 segments、radii、location 与 objectName，并以可信 receipt、动态拓扑与逐顶点
          参数化的强 `torus_ready` 及 Start→Next 原生 Undo 直连证明成功；action status 与 replay finalize 共用
          同一强 validator，后者另行固化追加式 provenance attestation。旧 binding 不继承权限，Torus shortcut
          仍 unavailable，menu grounding 仍不代表逐控件执行。见
          [ADR 0091](adr/0091-torus-action-level-mcp.md)。
    - [x] Cone action-level MCP executor：InteractionCatalog `1.37.0` 冻结 `1.36.0`，只新增 Cone；Runtime
          从不可变 binding 派生 start/end 与两端半径，用端点、局部环坐标、普通锥台或尖锥动态拓扑的强
          `cone_ready` 及 Start→Next 原生 Undo 直连证明成功。旧 binding 不继承权限，Cone shortcut 仍
          unavailable，menu 的 canonical Euler teaching projection 不冒充 managed quaternion 执行。见
          [ADR 0092](adr/0092-cone-action-level-mcp.md)。
    - [x] Cylinder action-level MCP executor：InteractionCatalog `1.38.0` 冻结 `1.37.0`，只新增 Cylinder；Runtime
          从不可变 binding 派生 start/end 与半径，用端点、局部环坐标、`64/96/34` 拓扑的强
          `cylinder_ready` 及 Start→Next 原生 Undo 直连证明成功。旧 binding 不继承权限，Cylinder shortcut 仍
          unavailable，menu 的 canonical Euler teaching projection 不冒充 managed quaternion 执行。见
          [ADR 0093](adr/0093-cylinder-action-level-mcp.md)。
    - [x] Mirror modifier action-level MCP executor：冻结 InteractionCatalog `1.39.0`，由 `1.40.0` 只为
          `blender.modifier.add_mirror` 开放 accepted replay 的通用 action executor。Runtime 从不可变 binding
          派生 target/modifier identity 与 axis，要求完整 fixed-property、源网格、evaluated topology 和
          `modifier_ready` 强 Observation，并继续绑定 decision、Start→Next 原生 Undo checkpoint、可信 receipt
          与补偿回退；menu/shortcut 仍 unavailable，旧 binding 不继承权限。见
          [ADR 0099](adr/0099-mirror-action-level-mcp.md)。
    - [x] 首个原生 shortcut proof executor：冻结 InteractionCatalog `1.38.0`，由 `1.39.0` 只为已接受的
          factory Cube Subdivision Surface replay 声明 `Ctrl+1 → F9 → Level → Enter`。Blender 4.5.3/5.1.1
          的 `Window.event_simulate` 执行器生成四段哈希收据、强 Observation、完整 factory Cube 指纹与原生
          Undo/Redo checkpoint；成功保持 mutation lock。单一完成事件避免终态半链，持久 terminal outbox 与
          Undo/Redo transition outbox 在 ACK 不确定或 Runtime 重启后只重交原始结果或服务端当前 result 后的严格
          后缀、不重放宿主输入；terminal challenge 绑定并随最新 replacement lease 轮换，driver 在每个 timer turn
          重验 authority，disconnect/unregister 与文件加载会先停止旧 callback。同一文档的进程内 identity 支持
          Controller 重建，文件加载、复制 `.blend` 与 OS 进程重启不会继承旧 target。该证明明确排除 OS HID、menu 点击、
          managed Action/MCP identity 及其它对象或快捷键。见
          [ADR 0094](adr/0094-native-subdivision-shortcut-proof.md)。
    - [x] 首个逐控件原生 menu proof：冻结 InteractionCatalog `1.40.0`，由 `1.41.0` 只为精确的 UV Sphere
          fixture 声明 `Layout → Add → Mesh → UV Sphere → Location → Scale → Properties/Object/Name`。
          Blender 4.5.3/5.1.1 各自通过 146 个 `Window.event_simulate` 前台事件，验证 `482/992/512`
          拓扑、具体位置/缩放/名称、八层原生 Undo 与八层 Redo；ProcedureTree 只有在 Action arguments
          与目录 `proofArguments` 完全一致时才携带声明。当前证明明确排除任意参数、其它 UI scale、OS HID、
          managed action/receipt 与通用 Companion 请求路径。见
          [ADR 0100](adr/0100-native-uv-sphere-menu-control-proof.md)。
    - [x] Solidify modifier action-level MCP executor：冻结 InteractionCatalog `1.41.0`，由 `1.42.0` 只为
          `blender.modifier.add_solidify` 开放 accepted replay 的通用 action executor。Runtime 从不可变 binding
          派生 target/modifier identity、受管名称、thickness 与 offset；强 `modifier_ready` 要求精确参数、完整
          固定 Solidify RNA、receipt 保护的源 Mesh 内容，以及正整数、有限且不超过 `8192/16384/8192` 的真实
          evaluated topology。成功继续绑定 decision、Start→Next 原生 Undo checkpoint、可信 receipt 与补偿
          回退；menu/shortcut 仍 unavailable，旧 binding 不继承权限。见
          [ADR 0101](adr/0101-solidify-action-level-mcp.md)。
    - [x] Edit、骨骼、权重与动画 action-level MCP 扩展：冻结 InteractionCatalog `1.42.0`，由 `1.43.0`
          为 Subdivide、Triangulate、Extrude Region、Bevel Edges、Inset Faces、Poke Faces、Create Armature、
          Bind Skin Weights 与 Create Pose Keyframes 开放同一 accepted-replay executor。Runtime 仍只从不可变
          binding 派生完整参数；Companion 强 Observation 逐项绑定 replacement Mesh 内容、骨架结构、逐顶点权重、
          稀疏 FCurve/keyframe、唯一 receipt 和受管 ownership。原生菜单/快捷键轨迹继续保持 unavailable 或
          candidate-only，不冒充 managed execution。Blender 菜单/keymap/RNA 事实按 4.5.3/5.1.1 官方源码与
          运行时探针核对。见 [ADR 0106](adr/0106-expanded-edit-rig-action-level-mcp.md)。
    - [x] Edit Mode Subdivide 原生 shortcut proof executor：冻结 InteractionCatalog `1.43.0`，由 `1.44.0`
          只为 untouched、单用户 `8/12/6` factory Cube 声明九步 `TAB → A → F3/subdivide → ENTER → F9 →
Cuts → Smoothness → ENTER → TAB` 前台事件执行。协议、Coordinator、Companion receipt、强 Observation
          与 v2 history marker 均按 executor 严格判别；结果证明同一 object/Mesh 原地变异、参数化 topology/geometry、
          四次 Undo baseline 和四次 Redo final，同时固定排除 managed action、ActionReceipt 与 replacement Mesh。
          Blender 4.5.3/5.1.1 的三组参数矩阵通过；projection 仍为 candidate-only，不冒充受管 copy/swap action。
          见 [ADR 0107](adr/0107-native-edit-subdivide-shortcut-proof.md)。
    - [x] Edit Mode Subdivide 十一步 menu candidate 的有界 UI 证据：InteractionCatalog `1.50.0` 在冻结
          `1.49.0` 后加入 Layout、收据绑定目标、Mode、Select/All、Edge/Subdivide、F9 参数与返回 Object Mode
          的有序候选。Blender 4.5.3/5.1.1 各以 `cuts/smooth = 1/0、2/0.5、8/1` 通过真实菜单、参数输入、
          四次 Undo/Redo 和对象/Mesh identity 检查；候选阶段不新增 managed receipt 或 replacement Mesh。
          该证据不提升执行权限：04–07 才是 exact-native 菜单标记，其余 operation 继续 reference-only，整条
          projection 仍为 candidate-only 且不等价于 managed copy/swap action。
    - [x] Poke Faces 隔离三叶 compound proof：Blender 4.5.3/5.1.1 前台已严格通过 Forward
          `Enter Edit→Poke→Exit Edit`、Back/Redo 各一次原生 history operation、逐叶 intent/receipt、
          middle-leaf-only checkpoint/history、完整 current-state integrity、每叶 crash/reconnect 分类、持久 lock、
          `unlock_final`/`abandon_baseline` 与负例门；Node/TypeScript 再用现有 compound protocol validator 验证
          terminal evidence，并真实覆盖 Object-mode Undo 的 quarantine negative。新增双版本三进程测试：保存
          `recovery_required` lock 后异常退出，新 Blender 进程加载同一 `.blend` 必须持久写入
          `history_lost/lost_permanently`，第三个进程再加载仍拒绝自动续跑。真实 Companion/Orchestrator 双版本
          transport E2E 另以 Scene terminal outbox 覆盖 delivery 后、result commit 前断线，Runtime 重启后只向
          replacement lease 发 recovery challenge，接受原终态后才 ACK/清 outbox，且普通 delivery/result 不重放。
          transport fixture 与真实几何/历史 proof 分层验证；未发布或修改任何 catalog，production Poke 继续
          unavailable，等待 Wave 2 catalog publication/composition。
          见 [ADR 0063](adr/0063-bounded-edit-mode-poke-faces.md)。
    - [x] Light Trails 具名节点轨迹：InteractionCatalog `1.51.0` 冻结 `1.50.0`，把 no-bake 叶子展开为
          23 个图级步骤，其中 20 个节点用精确 `OperatingLine.*` 名称定位；12 个 accepted 参数按消费顺序
          插入对应节点之后，Blender 叶子 rail 共 35 项。真实 Blender 4.5.3/5.1.1 验证创建、保存、重开、
          强 Observation、rollback 与零 bake；节点只声明 receipt-bound `CONTAINER CAPABLE`，逐 socket
          menu/shortcut 继续 unavailable。
    - [x] 混合 Euler/Quaternion pose 与完整参数轨迹：ActionCatalog `1.25.0` 冻结 `1.24.0`，每个 pose
          精确选择 XYZ Euler 或 WXYZ 单位四元数，并禁止同一 bone 跨帧切换 channel；插值/外推成为显式参数。
          InteractionCatalog `1.52.0` 冻结 `1.51.0`，以 `json_identity` 把完整 keyframes 数组放回其确切操作，
          连同 Action Name、Interpolation、Extrapolation 形成八步骤加四值的 rail。Blender 4.5.3/5.1.1
          已验证 19 条混合 FCurve、真实变形、强 Observation、注入失败零残留与 compare-and-restore rollback。
    - [x] Light Trails 完整连接与参数控件轨迹：InteractionCatalog `1.53.0` 冻结 `1.52.0`，在既有 20 个
          具名节点和 12 个就地参数之外补齐 19 条稳定 socket-identifier 连接，形成 42 个图级步骤、54 个
          叶子操作。12 个标量进入 OperatingLine 自有 revision 控件和收据绑定主 Socket 解析；连接 overlay
          使用具名端点消除重复 Node type 歧义。真实 Blender 4.5.3/5.1.1 已逐条比对 catalog 与实际 NodeTree
          links，并通过保存/重开、强 Observation、rollback 和零 bake。逐操作 mutation executor 与 4.5/5.1
          原生 socket 像素仍未声称完成。
    - [x] Light Trails 本地 54 步 mutation executor：Blender Guided Control 按目录严格执行预检、modifier、
          20 个节点、12 个参数、19 条连接和 no-bake 验证；每步形成连续指纹、operation receipt 与 LIFO
          inverse，写入后失败会确定性补偿，最终 strong Observation 才 promotion。Blender 4.5.3/5.1.1
          已通过 54 步正向、54 步反向、中途失败恢复，以及第 15 步、最终 promotion 和整叶 Back 的原生
          Undo/Redo。menu/shortcut 与原生 socket 像素未提升权限。见
          [ADR 0110](adr/0110-light-trails-local-operation-execution.md)。
    - [x] Light Trails 远程 54 步 operation-level MCP：InteractionCatalog `1.55.0` 冻结 `1.54.0`，把当前
          Light Trails MCP 物化为固定 `execute-next/status` 轨迹；Runtime 从不可变 replay 与成功前缀派生
          每个 ordinal、operation ID 和参数，Companion 逐项执行同一本地 executor。最终 report 必须携带
          从授权起点经过全部 54 个微操作的唯一原生 Undo checkpoint lineage，并按 Blender RNA float32
          核对 socket evidence。真实 Blender 4.5.3/5.1.1 Companion E2E 均通过 54 delivery/result、20 节点、
          19 连接、13,824 evaluated vertices、强 Observation 与零 Bake。见
          [ADR 0111](adr/0111-light-trails-operation-level-mcp.md)。
    - [x] Axis-Angle pose 通道：ActionCatalog `1.26.0` 冻结 `1.25.0`，每个 pose 在 Euler、单位 Quaternion、
          单位轴 Axis-Angle 中严格三选一，并保持同 bone 跨帧 channel 一致；InteractionCatalog `1.54.0` 冻结
          `1.53.0` 并保持八步骤/四值的完整 keyframe JSON 轨迹。Blender 4.5.3/5.1.1 已验证三骨骼、29 条
          FCurve、真实形变、强 Observation、Axis-Angle 中途失败零残留及完整 compare-and-restore rollback。
    - [x] Pose Animation 本地及远程 12 步 operation executor：InteractionCatalog `1.56.0` 冻结 `1.55.0`，
          把八个语义步骤与四个就地值物化为固定 `01→12` Guided Control/MCP 轨迹。Action 创建、命名、完整
          keyframe JSON、插值和外推只在 04/05/07/09/11 变更 RNA；其余步骤保留为显式预检、上下文和验证，
          不冒充原生控件点击。每项有连续指纹、稀疏 mutation receipt、LIFO Back/Abort、失败补偿和原生
          Undo/Redo；最终 `pose_animation_ready` 后才 promotion。真实 Blender 4.5.3/5.1.1 Companion E2E
          均通过 12 delivery/result、29 FCurves、87 keyframe points、完整 checkpoint lineage 与强 Observation。
          见 [ADR 0112](adr/0112-pose-animation-operation-level-mcp.md)。
      - [x] Pose Animation operation 07 已拆为严格 `rnaKeyframeInsertions`：当前三骨骼轨迹按 frame/pose/channel
            保存 27 次真实 `PoseBone.keyframe_insert`，逐项绑定 bone、data path、accepted values 与 87 个实际
            FCurve 点。Guided Control 显示 `KEYFRAME RNA` 子序列，Runtime 从 accepted replay 重建完整数组；
            Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过，且合法格式的伪造 action identity 被成功门拒绝。
            该切片不冒充 Insert Keyframe 菜单、Dope Sheet 手势或通用动画 executor。见
            [ADR 0122](adr/0122-pose-animation-rna-keyframe-insertion-evidence.md)。
      - [x] Pose Animation operation 09/11 已形成严格 `rnaAnimationPropertyWrites`：当前三骨骼轨迹沿 accepted
            曲线/帧顺序保存 87 条 keyframe interpolation 与 29 条 FCurve extrapolation 写入，包含默认 before、
            accepted/observed 值和 UI path。Guided Control 显示 `ANIMATION RNA` 子序列，Runtime 独立重建并拒绝
            合法格式的伪造 action identity；Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。该切片不冒充
            Dope Sheet/Graph Editor 控件或通用曲线 executor。见
            [ADR 0123](adr/0123-pose-animation-rna-property-write-evidence.md)。
      - [x] Pose Animation operation 04/05 已形成严格 `rnaActionResourceMutations`：Action create 与 Armature bind
            按 `.01/.02` 保存 receipt-derived pending identity，Action Name write 按 `.01` 保存 before/accepted/
            observed name。Guided Control 显示 `ACTION RESOURCE RNA`，Runtime 从 durable receipt ID 与 replay
            独立重建并拒绝合法格式的伪造 action identity；Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。
            该切片不冒充 Action Editor/selector 控件或通用 Action executor。见
            [ADR 0124](adr/0124-pose-animation-action-resource-evidence.md)。
    - [x] Armature 本地及远程 9 步 operation executor：InteractionCatalog `1.57.0` 冻结 `1.56.0`，把 Armature
          whole-action MCP 升级为固定 `01→09` Guided Control/MCP 轨迹。02/03/04/06/08 分别创建 pending
          object/data、应用两个名称、创建有序 bones、应用 rigid bindings；其余步骤是显式预检、上下文和最终
          `armature_ready`。执行器使用改名后 ResourceIdentity 重绑、连续 pointer-free fingerprint、稀疏 receipt、
          LIFO inverse、失败补偿和 native Undo/Redo rebind。真实 Blender 4.5.3/5.1.1 本地与 Companion E2E
          均通过九次 delivery/result、精确骨骼/绑定、整叶 Back、完整 checkpoint lineage 与强 Observation。
          见 [ADR 0113](adr/0113-armature-operation-level-mcp.md)。
      - [x] Armature operation 02/03/04/06/08 已形成严格 RNA 证据数组：资源 data/Object create、collection link
            与名称写入进入 `rnaArmatureResourceMutations`；EditBone create/parent 与 PoseBone rotation mode 进入
            `rnaArmatureBoneMutations`；刚性 target/bone parenting 进入 `rnaArmatureBindingMutations`。Guided
            Control 显示 `ARMATURE RESOURCE/BONE/BINDING RNA`，Runtime 从 receipt/replay 独立重建并拒绝三类
            合法格式的伪造 identity；Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。见
            [ADR 0125](adr/0125-armature-rna-mutation-evidence.md)。
    - [x] Skin Weights 本地及远程 9 步 operation executor：ActionCatalog `1.27.0` 冻结 `1.26.0`，把实际创建的
          Armature Modifier resource effect 从 `mutate` 修正为 `create`；InteractionCatalog `1.58.0` 冻结
          `1.57.0`，把 Skin Weights whole-action MCP 升级为固定 `01→09` Guided Control/MCP 轨迹。05/07/08
          分别写入完整归一化权重和 bone deform flags、创建 Preserve Volume Modifier、应用精确 Modifier Name；
          其余步骤保持 receipt-free 预检、上下文和最终 `skin_weights_ready`。执行器使用连续 pointer-free
          fingerprint、合并 partial receipt、LIFO inverse、失败补偿和 native Undo/Redo rebind。真实 Blender
          4.5.3/5.1.1 本地与 Companion E2E 均通过九次 delivery/result、完整顶点覆盖、精确 groups/weights、
          Modifier ownership/settings/name、整叶 Back、完整 checkpoint lineage 与强 Observation。
          见 [ADR 0114](adr/0114-skin-weights-operation-level-mcp.md)。
      - [x] Skin Weights operation 05/07/08 已形成严格 RNA 证据数组：bone deform、Vertex Group create 和每条
            accepted vertex/influence assignment 进入 `rnaSkinWeightMutations`；Armature Modifier create/object
            bind/三项 property write/name write 进入 `rnaSkinModifierMutations`。Guided Control 显示
            `SKIN WEIGHT/MODIFIER RNA`，Runtime 从 durable receipt ID 与 replay 独立重建并拒绝两类合法格式的
            伪造 identity；Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。见
            [ADR 0126](adr/0126-skin-weights-rna-mutation-evidence.md)。
    - [x] Solidify 本地及远程 4 步 operation executor：InteractionCatalog `1.59.0` 冻结 `1.58.0`，把 Solidify
          whole-action MCP 升级为固定 `01→04` Guided Control/MCP 轨迹。03 创建 receipt-derived pending
          `SOLIDIFY` Modifier，04 写入 accepted name、thickness、offset 与其余固定属性；01/02 保持 receipt-free
          预检和面板上下文。执行器使用连续 pointer-free fingerprint、partial receipt、LIFO inverse、失败补偿
          和 native Undo/Redo rebind。真实 Blender 4.5.3/5.1.1 本地与 Companion E2E 均通过四次
          delivery/result、精确 Modifier ownership/settings/name、inverse/replay、整叶 Back、完整 checkpoint
          lineage 与强 `modifier_ready`。见
          [ADR 0127](adr/0127-solidify-operation-level-mcp-and-rna-evidence.md)。
      - [x] Solidify operation 03/04 已形成严格 `rnaSolidifyModifierMutations`：一条 Modifier create、accepted
            name write 和 25 条固定 property write 按实际执行顺序保存 receipt-derived identity、before/accepted/
            observed 值、MCP 与 UI path。Guided Control 显示 `SOLIDIFY RESOURCE/PROPERTY RNA`，Runtime 从
            durable receipt 与 replay 独立重建并拒绝合法格式的伪造 identity 或参数；Blender 4.5.3/5.1.1
            本地及 Companion E2E 均通过。
    - [x] Mirror 本地及远程 7 步 operation executor：InteractionCatalog `1.60.0` 冻结 `1.59.0`，把 Mirror
          whole-action MCP 升级为固定 `01→07` Guided Control/MCP 轨迹。01–05 显示 Layout、owned Mesh、
          Modifiers、Add Modifier 与 Generate 上下文，06 创建 receipt-derived pending `MIRROR` Modifier，07
          写入 accepted name、单轴分量与其余固定属性。执行器使用连续 pointer-free fingerprint、partial
          receipt、LIFO inverse、失败补偿和 native Undo/Redo rebind。真实 Blender 4.5.3/5.1.1 本地及
          Companion E2E 均通过七次 delivery/result、精确 Modifier ownership/settings/name、inverse/replay、
          整叶 Back、完整 checkpoint lineage 与强 `modifier_ready`。见
          [ADR 0128](adr/0128-mirror-operation-level-mcp-and-rna-evidence.md)。
      - [x] Mirror operation 06/07 已形成严格 `rnaMirrorModifierMutations`：一条 Modifier create、accepted
            name write、三个轴分量 write 和 24 条固定 property write 按实际执行顺序保存 receipt-derived
            identity、before/accepted/observed 值、MCP 与 UI path。Guided Control 显示
            `MIRROR RESOURCE/PROPERTY RNA`，Runtime 从 durable receipt 与 replay 独立重建并拒绝合法格式的
            伪造 identity 或轴组合；Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。
    - [x] Subdivision Surface 本地及远程 4 步 operation executor：InteractionCatalog `1.61.0` 冻结
          `1.60.0`，把 Subdivision Surface whole-action MCP 升级为固定 `01→04` Guided Control/MCP 轨迹。
          01–02 显示 Layout 与 receipt-owned Mesh，03 创建 receipt-derived pending `SUBSURF` Modifier，04
          写入 accepted name、viewport level 与其余固定属性。执行器使用连续 pointer-free fingerprint、
          partial receipt、LIFO inverse、失败补偿和 native Undo/Redo rebind。真实 Blender 4.5.3/5.1.1
          本地及 Companion E2E 均通过四次 delivery/result、精确 Modifier ownership/settings/name、
          inverse/replay、整叶 Back、完整 checkpoint lineage 与强 `modifier_ready`。原生快捷键轨迹继续是
          candidate-only。见
          [ADR 0129](adr/0129-subdivision-surface-operation-level-mcp-and-rna-evidence.md)。
      - [x] Subdivision Surface operation 03/04 已形成严格 `rnaSubdivisionSurfaceModifierMutations`：一条
            Modifier create、accepted name write 和 14 条固定 property write 按实际执行顺序保存
            receipt-derived identity、before/accepted/observed 值、MCP 与 UI path。Guided Control 显示
            `SUBDIVISION SURFACE RESOURCE/PROPERTY RNA`，Runtime 从 durable receipt 与 replay 独立重建并
            拒绝合法格式的伪造 identity、level 或 mutation 顺序；Blender 4.5.3/5.1.1 本地及 Companion E2E
            均通过。
    - [x] Edit Bevel 本地及远程 6 步 operation executor：InteractionCatalog `1.62.0` 冻结 `1.61.0`，
          把 Edit Bevel whole-action MCP 升级为固定 `01→06` Guided Control/MCP 轨迹。01–04 显示 Layout、
          receipt-owned Mesh、Edit Mode 和 Edge 菜单教学上下文；05 创建 pending replacement Mesh、投影
          accepted `width/segments/profile` 并执行固定 BMesh bevel，06 写入 accepted Mesh name 与 Object
          data link。执行器使用连续 pointer-free fingerprint、partial receipt、LIFO inverse、失败补偿和
          native Undo/Redo rebind。真实 Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过六次
          delivery/result、`8/12/6 → 96/192/98`、源内容保留、inverse/replay、整叶 Back、完整 checkpoint
          lineage、伪造证据拒绝与强 `mesh_edges_beveled`。原生十步快捷键轨迹继续 candidate-only。见
          [ADR 0130](adr/0130-edit-bevel-operation-level-mcp-and-bmesh-evidence.md)。
      - [x] Edit Bevel operation 05/06 已形成严格 `editBevelMeshOperations`：五条 Mesh create、参数投影、
            BMesh content write 与两条 accepted name/Object data-link write 按实际执行顺序保存 identity、
            accepted/observed 值、固定 BMesh 常量、source/result topology、MCP 与 UI path。Runtime 独立重建
            确定性字段，并把 schema 验证后的动态 topology 与最终强 Observation 交叉核对；双版本本地及
            Companion E2E 均通过。
    - [x] Edit Inset 本地及远程 6 步 operation executor：InteractionCatalog `1.63.0` 冻结 `1.62.0`，
          把 Individual Inset Faces whole-action MCP 升级为固定 `01→06` Guided Control/MCP 轨迹。01–04
          显示 Layout、receipt-owned Mesh、Edit Mode 和 Face 菜单教学上下文；05 创建 pending replacement
          Mesh、投影 accepted `thickness/depth` 并执行固定 BMesh individual inset，06 写入 accepted Mesh
          name 与 Object data link。真实 Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过六次
          delivery/result、`8/12/6 → 32/60/30`、源内容保留、inverse/replay、整叶 Back、完整 checkpoint
          lineage、伪造证据拒绝与强 `mesh_faces_inset`。原生十步快捷键轨迹继续 candidate-only。见
          [ADR 0131](adr/0131-edit-inset-operation-level-mcp-and-bmesh-evidence.md)。
      - [x] Edit Inset operation 05/06 已形成严格 `editInsetMeshOperations`：四条 Mesh create、参数投影、
            BMesh content write 与两条 accepted name/Object data-link write 按实际执行顺序保存 identity、
            accepted/observed 值、固定 BMesh 常量、source loop count、严格
            `[V+L, E+2L, F+L]` topology、nondegeneracy、MCP 与 UI path。Runtime 独立重建确定性字段，并与
            最终强 Observation 交叉核对；双版本本地及 Companion E2E 均通过。
    - [x] Edit Poke 本地及远程 6 步 operation executor：InteractionCatalog `1.64.0` 冻结 `1.63.0`，
          把 Poke Faces whole-action MCP 升级为固定 `01→06` Guided Control/MCP 轨迹。01–04 显示 Layout、
          receipt-owned Mesh、Edit Mode 和 Face 菜单教学上下文；05 创建 pending replacement Mesh、投影
          accepted `offset` 并执行固定 BMesh poke，06 写入 accepted Mesh name 与 Object data link。真实
          Blender 4.5.3/5.1.1 本地及 Companion E2E 验证六次 delivery/result、`8/12/6 → 14/36/24`、
          triangle-only、源内容保留、inverse/replay、整叶 Back、完整 checkpoint lineage、伪造证据拒绝与
          强 `mesh_faces_poked`。原生九步快捷键轨迹继续 candidate-only。见
          [ADR 0132](adr/0132-edit-poke-operation-level-mcp-and-bmesh-evidence.md)。
      - [x] Edit Poke operation 05/06 已形成严格 `editPokeMeshOperations`：三条 Mesh create、offset 投影、
            BMesh content write 与两条 accepted name/Object data-link write 按实际执行顺序保存 identity、
            accepted/observed 值、固定 BMesh 常量、source loop count、严格 `[V+F, E+L, L]` topology、
            triangle/nondegeneracy、MCP 与 UI path。Runtime 独立重建确定性字段，并与最终强 Observation
            交叉核对；双版本本地及 Companion E2E 均通过。
    - [x] Edit Triangulate 本地及远程 6 步 operation executor：InteractionCatalog `1.65.0` 冻结
          `1.64.0`，把 Triangulate whole-action MCP 升级为固定 `01→06` Guided Control/MCP 轨迹。
          01–04 显示 Layout、receipt-owned Mesh、Edit Mode 和 Face 菜单教学上下文；05 创建 pending
          replacement Mesh 并以固定 `FIXED`/`EAR_CLIP` 方法执行 BMesh triangulate，06 写入 accepted
          Mesh name 与 Object data link。真实 Blender 4.5.3/5.1.1 本地及 Companion E2E 验证六次
          delivery/result、`8/12/6 → 8/18/12`、triangle-only、源内容保留、inverse/replay、整叶 Back、
          完整 checkpoint lineage、伪造 binding/name 拒绝与强 `mesh_triangulated`。见
          [ADR 0133](adr/0133-edit-triangulate-operation-level-mcp-and-bmesh-evidence.md)。
      - [x] Edit Triangulate operation 05/06 已形成严格 `editTriangulateMeshOperations`：两条 Mesh
            create/BMesh content write 与两条 accepted name/Object data-link write 按实际顺序保存
            identity、固定方法、source loop count、严格 `[V, E+L-3F, L-2F]` topology、源/结果内容、
            triangle-only、MCP 与 UI path。Runtime 与最终强 Observation 交叉核对；双版本本地及
            Companion E2E 均通过。
    - [x] Extrude Region 本地及远程 6 步 operation executor：InteractionCatalog `1.66.0` 冻结
          `1.65.0`，把 Extrude Region whole-action MCP 升级为固定 `01→06` Guided Control/MCP 轨迹。
          01–03 显示 Layout、receipt-owned Mesh 与 Edit Mode；04 验证 accepted 连通面区域，05 创建
          pending replacement Mesh、执行 BMesh region extrusion 并按 accepted local-space translation
          平移新顶点，06 写入 accepted Mesh name 与 Object data link。真实 Blender 4.5.3/5.1.1 本地及
          Companion E2E 验证六次 delivery/result、单面选区 `1/4/4/4`、`8/12/6 → 12/20/10`、源内容
          保留、inverse/replay、整叶 Back、完整 checkpoint lineage、伪造 binding/name 拒绝与强
          `mesh_region_extruded`。见
          [ADR 0134](adr/0134-edit-extrude-region-operation-level-mcp-and-bmesh-evidence.md)。
      - [x] Extrude Region operation 04/05/06 已形成严格 `editExtrudeRegionMeshOperations`：selection、
            Mesh create、translation projection、BMesh content write 与 accepted name/Object data-link
            write 按实际顺序保存 identity、accepted/observed 值、选区计数、严格
            `[V+selectedVertexCount, E+selectedEdgeCount+boundaryEdgeCount, F+boundaryEdgeCount]`
            topology、源/结果内容、MCP 与 UI path。Runtime 与最终强 Observation 交叉核对；双版本本地及
            Companion E2E 均通过。
    - [x] Bevel Modifier 本地及远程 4 步 operation executor：InteractionCatalog `1.67.0` 冻结
          `1.66.0`，首次为当前 Bevel recipe 增加固定 `01→04` Guided Control/MCP 轨迹。01–02 显示 Layout
          与 Modifier Properties 上下文；03 创建 receipt-derived pending `BEVEL` Modifier，04 依次写入
          accepted name、width、segments、固定 `limit_method=ANGLE` 与 accepted angle limit。真实 Blender
          4.5.3/5.1.1 本地及 Companion E2E 验证四次 delivery/result、inverse/replay、整叶 Back、完整
          checkpoint lineage、强 `modifier_ready` 与伪造 identity/value/order/constant 拒绝。见
          [ADR 0135](adr/0135-bevel-modifier-operation-level-mcp-and-rna-evidence.md)。
      - [x] Bevel Modifier operation 03/04 已形成严格 `rnaBevelModifierMutations`：一条 Modifier create 与
            五条 accepted name/width/segments/limit-method/angle-limit write 按实际顺序保存 logical identity、
            值来源、before/accepted/observed 值、MCP 与 UI path。Runtime 独立重建确定性字段，并与最终强
            Observation、源 Mesh 内容保护及有界 evaluated topology 交叉核对；双版本本地及 Companion E2E
            均通过。
    - [x] Single Material 本地及远程 4 步 operation executor：InteractionCatalog `1.68.0` 冻结
          `1.67.0`，首次为当前 material recipe 增加固定 `01→04` Guided Control/MCP 轨迹。01–02 显示
          Shading 与 Material Properties 上下文；03 创建 receipt-derived pending Material 并启用 Use Nodes，
          04 依次写入 accepted name、Material/Principled surface 与 ordered multi-target slots。真实 Blender
          4.5.3/5.1.1 本地及 Companion E2E 验证四次 delivery/result、双目标顺序、inverse/replay、整叶
          Back、完整 checkpoint lineage、强 `material_assigned` 与伪造 identity/surface evidence 拒绝。见
          [ADR 0136](adr/0136-single-material-operation-level-mcp-and-rna-evidence.md)。
      - [x] Single Material operation 03/04 已形成严格 `rnaMaterialMutations`：03 保存 Material create 与
            Use Nodes write；04 保存 accepted name、Material diffuse color/roughness/metallic、Principled
            Base Color/Roughness/Metallic 与每个 ordered target slot replacement，共 `13 + targetCount` 条。
            Runtime 从 accepted replay 重建 identity、值与 target order，并与最终强 Observation、唯一
            Principled/Material Output、assignment、ownership、receipt 和源 Mesh 内容证明交叉核对；双版本
            本地及 Companion E2E 均通过。
    - [x] Material Palette 本地及远程 4 步 operation executor：InteractionCatalog `1.69.0` 冻结
          `1.68.0`，首次为当前 palette recipe 增加固定 `01→04` Guided Control/MCP 轨迹。01–02 显示
          Shading 与 Material Properties 上下文；03 携带完整有序 `materials` 数组并保持非变更；04 原子创建、
          配置并分配全部材质。真实 Blender 4.5.3/5.1.1 本地及 Companion E2E 验证两种材质、三个目标、
          两个有序成功门、inverse/replay、整叶 Back、完整 checkpoint lineage，以及伪造材质 identity/value
          拒绝。见 [ADR 0137](adr/0137-material-palette-operation-level-mcp-and-rna-evidence.md)。
      - [x] Material Palette operation 04 已形成严格 `rnaMaterialPaletteMutations`：每个材质按
            `create → use_nodes → Material surface → Principled surface → ordered target assignments` 保存
            `14 + targetCount` 条记录，所有材质再用连续全局 order 串联。Runtime 从 accepted replay 重建
            identity、嵌套值和全局 target order，并与多个有序强 Observation、ownership、receipt、节点唯一性
            和源 Mesh 内容证明交叉核对；双版本本地及 Companion E2E 均通过。
    - [ ] 真实逐控件 menu/shortcut 与 socket executor，以及当前有界 managed action 集合之外的复合、Edit、
          Modifier、Geometry Nodes、骨骼和动画叶节点覆盖。
      - [x] Transform Geometry 05–07 已把 Translation/Rotation/Scale 拆为 `X→Y→Z` 九次真实 Blender RNA
            分量写入，并持久化严格的 operation/socket/property/value/MCP/UI-path 数组；Runtime 对新结果执行
            canonical equality，Blender 4.5.3/5.1.1 验证实际 float32 回读与恢复。该切片明确不是鼠标点击或通用
            socket executor。见 [ADR 0116](adr/0116-transform-geometry-rna-component-write-evidence.md)。
      - [x] Light Trails 十二项参数 operation 已拆为十五次真实 Blender RNA 写入；09/10/31 分别保存两个目标，
            每条绑定 accepted 参数、受限投影、before/projected/float32 observed、精确 node/socket/component、
            MCP 和 UI path。Guided Control 按 `.01/.02` 显示并与 native targeting 共用目标表，Runtime 对新结果
            执行 canonical equality；双版本本地与 Companion E2E 均通过。该切片仍不是通用节点或鼠标执行器。
            见 [ADR 0117](adr/0117-light-trails-rna-control-write-evidence.md)。
      - [x] Light Trails 九个节点创建 operation 已拆为三十九次稳定 RNA 初始化写入，覆盖 node enum/property、
            socket scalar 与 vector component，并保存 assigned/float32 observed、值来源、MCP 和 UI path。
            Guided Control 按 `INITIAL RNA` 子序列显示，Runtime 从 accepted replay 与 recipe 常量重建完整数组；
            Blender 4.5.3/5.1.1 本地及 Companion E2E 均通过。Resample Curve mode 的版本差异仍由适配器与最终图
            验证，不伪造统一目标。见
            [ADR 0118](adr/0118-light-trails-node-initialization-rna-evidence.md)。
      - [x] Light Trails 35–53 的十九项连接 operation 已各自形成严格 `rnaLinkCreations`：执行器从 Blender 返回的
            `NodeLink` 回读并核对 from/to node type、socket identifier 与方向，Guided Control 显示
            `35.01…53.01 LINK RNA`，Runtime 从固定 recipe 重建当前唯一端点。双版本本地及 Companion E2E 均
            通过；该切片证明数据模型连接，不冒充鼠标拖线或通用 socket executor。见
            [ADR 0119](adr/0119-light-trails-rna-link-creation-evidence.md)。
      - [x] Light Trails 二十项节点 operation 已形成二十二条严格 `rnaStructureCreations`：普通节点回读精确
            name/type，Group Input/Output 按 `.01 interface socket → .02 node` 保存 Geometry 方向/type 与节点。
            Guided Control 显示 `STRUCTURE/INTERFACE/NODE RNA`，Runtime 从固定 recipe 重建完整数组；双版本本地
            与 Companion E2E 均通过。该切片不冒充 Add/Search 菜单或鼠标放置节点。见
            [ADR 0120](adr/0120-light-trails-rna-structure-creation-evidence.md)。
      - [x] Light Trails operation 02 已形成三条严格 `rnaResourceMutations`，按 `.01 Node Group → .02 NODES
Modifier → .03 Bind` 保存实际返回资源、type、logical identity 与 UI path。Guided Control 显示
            `RESOURCE RNA` 子序列，Runtime 从 accepted replay 独立派生并 canonical-equality 核对；Blender
            4.5.3/5.1.1 本地及 Companion E2E 均通过，且合法格式的伪造资源收据被成功门拒绝。该切片不冒充
            Add Modifier 菜单、工作区切换或通用资源 executor。见
            [ADR 0121](adr/0121-light-trails-rna-resource-mutation-evidence.md)。
    - [x] 可信 action failure 的确定性候选：只有唯一终态失败与 finalized automatic-rollback attestation、不可变
          replay binding 和精确目录全部一致时，Runtime 才按服务端 schema policy 生成待审参数修复，或从同一叶
          选择携带 `proofExecution` 的备用轨迹；启动可幂等补齐，只读查询不接受 caller evidence，不调用 Provider、
          不创建/接受 Proposal、不执行 Blender。见
          [ADR 0102](adr/0102-trusted-execution-failure-replan.md)。
    - [x] 将确定性参数修复候选经带人工身份的一次性审查事务转为待审 GuideProposal：只读 MCP/HTTP 预览
          通过严格 `evidenceBinding` 明示并绑定候选、当前 Plan identity/content hash、目录版本/content hash
          与完整失败证据 hash；唯一 mutation 使用目标 Companion 当前 lease 的 HTTP
          POST。accept 原子写入 revision request、下一 revision 的 pending Proposal 与终态收据，discard 无
          Proposal 副作用；两者都不调用 Provider、不接受 Proposal、不执行 Blender。策略/语义接受继续
          fail closed。见 [ADR 0103](adr/0103-human-reviewed-execution-failure-replan.md)。
    - [x] Guide `1.6.0` 的可审查 execution-track 表达：proof-backed strategy switch 只把精确目录、recipe、
          menu/shortcut track 与 proof execution 摘要物化到失败 action leaf；durable review、revision、候选和
          replay proof 形成接受前的完整授权链。通用创建/发布、公开 Next 与 action-level MCP 均不能绕过。
          专用 execution-track MCP 已实现有界 UV Sphere v2 executor：七个前台事件模拟收据、八个 native
          mutation stage、精确 native Undo baseline restore、Redo barrier、managed-start ACK、单次 managed
          commit、强 Observation 和 durable recovery；它不扩大到其他叶节点。见
          [ADR 0104](adr/0104-reviewed-execution-track-override.md) 与
          [ADR 0115](adr/0115-uv-sphere-execution-track-v2.md)。
    - [ ] 在确定性候选耗尽后复用签名、单次消费的 Provider authority 触发语义局部重规划。自动应用或自动
          执行仍禁止。
  - [x] 已存 ProcedureTree 的语义 RAG 与交互局部精修：真实 embedding 从 latest verified leaf 产生带完整
        证据的 vector-free RAG context；显式授权的 coordinator 把精确 receipt 绑定进流式 Procedure 对话，
        仅在固定 `0.8` 阈值后进行第二次自动局部树 refinement。完整 Provider tree 经过 scope sanitization、
        locality、compile 和人工 review gate；store/discard 原子提交，重启不重放不确定的 Provider 调用。
        见 [ADR 0086](adr/0086-provider-neutral-procedure-semantic-retrieval.md) 与
        [ADR 0087](adr/0087-evidence-bound-procedure-refinement.md)。
  - [x] 从一句话通过显式 Provider 零基线生成完整 candidate ProcedureTree：Runtime 对完整 Provider disclosure
        与三项授权 fail closed，按请求 fingerprint 分配稳定 UUIDv8 tree id 和 revision 1，复用既有严格
        authoring/compile 门并跨重启恢复；结果不使用 existing-tree retrieval，也不 store/propose/execute。见
        [ADR 0095](adr/0095-zero-baseline-procedure-generation.md)。
  - [x] 零基线到语义 RAG、流式对话与自动局部重规划的安全分阶段编排：revision 1 candidate 先以四哈希
        binding 暂停人工 review，store 时与 reviewed evidence 原子提交；随后只对这棵精确已存树执行非空
        semantic retrieval，并把 durable receipt 交给既有 streamed refinement coordinator。后者继续执行固定
        `0.8` confidence、scope/locality、compile 与第二次 review/store 门。全流程可按 workflow id 恢复，
        requested-only Provider 阶段不重放；语义失败写入 terminal `semantic_failed`，同一 workflow/request 不重试；
        不创建 Proposal 或执行 Blender。见
        [ADR 0098](adr/0098-zero-baseline-grounded-dialogue-refinement.md)。
  - [ ] 经授权、去重、版本切分和双人盲审的轨迹数据集与训练/RAG 导出；candidate、unavailable 或权利
        不明确的视频数据不得进入 released 训练集。

- [ ] 更大的人工 Eval：把已完成的版本化采集基础设施推进为经过真实采集、独立盲审和数据审核的
      released 数据集。Capability trace 只证明 provider 声明可追溯到目录 action；确定性 packet、JSON
      输出、严格 Schema、locality 和质量门都不能写成“模型已经理解任意目标”；同进程插件也不是强
      安全隔离。
  - [x] 定义无分数 suite/run/annotation/adjudication/comparison 协议、`@operatingline/eval-kit`、
        `eval:check`/`eval:report`，并提交 7 个 `collecting` Blender 案例，覆盖 initial plan、local replan
        和 adversarial 能力边界。
  - [x] 实现本地 `eval:snapshot` → `eval:manifest` → `eval:capture` → `eval:blind` → `eval:review`
        工具链、单写者锁和
        provider-blind 浏览器投影；这只完成安全的本地采集/评审面，不代表已经采集或评审任何真实数据，
        也不构成发布级 treatment/artifact attestation。`eval:manifest` 从冻结 runtime proof 派生
        provider-only `best_effort` 输入；四个宿主参数完整提供时也可从精确终态证明派生 runtime-attested
        artifact 输入。两种路径都要求显式 case/request/run，且不读取 Provider credential。
  - [x] 实现只读、确定性的 `eval:release-check`：只对已通过 released readiness 与 artifact 字节验证的
        数据集生成发布候选 identity；不消费发布/训练授权，不上传数据，也不把测试 fixture 声称为真实采集。
  - [x] 实现授权发布 registry：服务端实时验证 `DatasetReleaseAuthorization`，原子登记最终 manifest 与
        consumption/completion evidence；它不替代真实数据采集、人工审核、远端分发或训练授权。
  - [ ] 按明确的数据披露与可能费用确认，为 7 个案例采集真实 Provider Run；当前 `runCount` 为 0。
  - [ ] 为每个 Run 取得至少两名校准 reviewer 的 provider-blind annotation，保留并按需 adjudicate
        分歧；当前 `blindSignoffCount`、`annotationCount` 与 `adjudicationCount` 均为 0。
  - [ ] 附加真实 Blender 执行事件与内容哈希渲染 artifact，完成人工数据审核后再把 suite 从
        `collecting` 推进到 `released` 并发布 comparison。
  - [x] Runtime 对 Provider/model/settings 与生成 artifact hash 提供不可变 attestation；未提供证明时，
        operator-attested capture 仍固定 `not_reproducible`，手工附加 PNG 仍不能满足 released visual evidence。
- [ ] Eval 评分与训练治理：在原始证据导出之上增加显式评分器、脱敏/同意/保留策略、数据集切分、
      训练授权与可追溯训练流水线。
- [ ] 第二软件宿主：以真实原生插件验证协议、能力降级和视觉引导的跨宿主语义。
- [ ] 正式自动发布：在已完成的 Changesets Phase 0 草稿版本 PR 之上，为明确 allowlist 的首批公开包
      补齐 `dist`、声明、精确 tarball/安装测试、分支保护、npm ownership、受保护 Environment 与
      Trusted Publisher。当前全部 package 仍为 private，workflow 不含 token/OIDC/publish/tag/
      GitHub Release/产物上传；见 [ADR 0039](adr/0039-changesets-release-preparation.md)。
- [x] 完成正式双通道代码审查：当前 Codex 表面明确提供文档化原生角色路由，独立
      `code-reviewer` 与 `architect` 已对最终流式对话工作树给出 `APPROVE` / `CLEAR`；确认的阻断问题
      均已修复，关键边界已补回归。OMX runtime 预检仍不支持 documented leader proof，因此没有伪造 runtime 状态。
      见 [正式双通道代码审查记录](quality/omx-code-review.md)。

## 设计约束

- 宿主内视觉由原生 Companion 提供，不使用独立桌面窗口冒充精确宿主引导。
- AI 计划先成为 Proposal，只有宿主内明确接受后才可执行。
- action 必须来自目标宿主发布的版本化目录；未知动作、参数或能力不得猜测。
- 树负责呈现和引用，DAG 负责执行；自动 action 只能位于叶子节点。
- 所有局部修改都产生新的不可变 revision，保留旧计划、决策和执行证据。
