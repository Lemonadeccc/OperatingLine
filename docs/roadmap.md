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
- [x] Blender 内逐次授权本机 AI CLI：独立 `pnpm dev:clients` composition root 注册 Codex CLI 与
      Claude Code CLI，复用 Initial/Replan Run 的数据/费用披露、原生确认、异步状态、严格验证和
      Proposal 审批；默认 runtime 继续 provider-free。HTTP 与 stdio bridge 自动协商 MCP
      `2026-07-28` 并回退旧版；MCPB 已有临时自签名 CI 验证和外部凭据驱动的生产签名流程。见
      [ADR 0023](adr/0023-local-cli-planners-and-modern-mcp.md)。

## 已完成的规划基础

- [x] 版本化 ActionCatalog：让 AI 查询真实允许动作、参数、资源读写、观察和回退能力。
- [x] 版本化 InteractionCatalog：通用协议定义 action 到有序宿主交互步骤的严格配方；Blender
      `1.32.0` 与 ActionCatalog `1.22.0` 一一覆盖 27 个动作，历史 `1.9.0` 至已冻结的 `1.31.0` 保持逐字可回放。Plane/Cube/UV Sphere/Ico Sphere/Cone/Cylinder/Torus 使用经过
      4.5/5.1 验证的 `native_path`，其他二十个动作使用明确的灰色 `semantic_path` 与 `UI target unavailable`，
      其中 Subdivide、Edit Mode Bevel、Individual Inset Faces、Poke Faces 与 Subdivision Surface 另有 candidate-only shortcut，但 menu 仍 unavailable。活动叶节点不再依赖 Python
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
- [x] 宿主授权的异步 Initial Plan Run：Goal 获得 Runtime acknowledgement 后，Blender 可显式选择
      Planner Provider、查看目标/目录/精确实例状态的数据传输与可能费用披露，并逐次确认后台生成。
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
- [x] 宿主授权的异步 Replan Run：Blender 在 Runtime acknowledgement 后列出无凭据 Provider
      descriptor，保持默认不选择，并在每次调用或重试前显示数据传输/可能费用披露和原生确认 dialog。
      Orchestrator 持久化授权后立即返回 `202`，后台复用严格 provider generation 与 canonical propose；
      Blender 只做短状态轮询。单实例 Run/待决 Proposal 互斥，失败或重启不自动重试；所有生成状态和
      Proposal preview 都不改场景或 active Session，仍需 Accept/Reject，`Next` 才执行动作。
- [x] 人工 Eval 采集基础设施：新增独立 `HumanEvalSuite`、`ProviderEvalRun`、
      `HumanEvalAnnotation`/`HumanEvalAdjudication` 与无分数 `HumanEvalComparisonReport` 协议，内部
      `@operatingline/eval-kit` 验证跨记录引用、精确 catalog/base Plan、内容哈希、安全 artifact、冻结
      live 事件链、盲审/裁决和 released readiness；published report 要求 artifact-verified dataset。
      `pnpm eval:check` 与 `pnpm eval:report` 可验证和报告目录数据集。首个 Blender suite 处于
      `collecting`，包含 7 个案例、6 条 lineage，并禁止 synthetic Run 进入 published comparison。
      见 [ADR 0018](adr/0018-versioned-human-eval-evidence.md)。
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
- [x] 流式模型对话与授权内自动语义重规划：Blender 明确选择 Provider 并逐轮确认一次最多两次调用；
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
        不转录、不调用模型、保存、提案或执行。显式 Provider generate 尚未消费该文档导入请求。见
        [ADR 0076](adr/0076-user-supplied-caption-document-import.md)。
  - [ ] 经授权的 YouTube 获取、字幕抓取/语音转录、画面与按键识别、自动分段、证据帧，以及大步骤/小
        步骤质量校准；当前 Runtime 不下载或转录视频，也不把调用方权利声明当成 released 训练许可。
  - [ ] ActionCatalog/InteractionCatalog 检索与增量覆盖：只有项目尚未支持且经过版本化真实宿主验证的
        菜单、快捷键别名和 MCP 函数映射，才能从 candidate 晋升为 verified。
  - [ ] ProcedureTree 可视化编辑器：支持树节点、参数、替代轨迹和用户评论的局部修改，并保留 revision
        分支、合并和来源差异。
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
  - [x] 供应商无关的自然语言 Procedure 编写 packet：MCP/HTTP 将目标、固定来源证据、tree identity、
        精确 ActionCatalog/InteractionCatalog 与 candidate-only 响应 Schema 交给当前 MCP 宿主模型；
        当前只生成层级、语义 operation 和 Action 参数，菜单、快捷键与 MCP 轨迹强制 unavailable；目录和
        精确检索结果仅作为后续 grounding 候选。候选与原 packet 通过服务端 authoring validate 核对 canonical
        SHA-256、已安装目录、固定 identity/provenance 和 candidate-only 契约，再走既有 compile；packet 去掉
        重复 rendered prompt，并有 256 KiB canonical 上限。该流程不调用模型、不自动保存、创建 Proposal 或
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
    - [ ] 下一个确定性交互覆盖切片：从更多 action 的封闭声明、经真实版本验证的
          shortcut/MCP recipe，或完整 UI replay 中选择；未选定且验证前不声称已实现。
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
    - [ ] 真实逐控件 menu/shortcut executor、action-level MCP executor，以及七种已证明 primitive 之外的
          复合与编辑叶节点覆盖；根据失败分类改参数、切换策略或触发语义局部重规划仍未完成。
  - [ ] 句子到完整 ProcedureTree 的语义 RAG 与交互精修：显式 Provider coordinator 已能返回经严格验证的
        candidate；仍需经验证的语义召回、流式 Procedure 对话、自动局部树重规划与结果治理，使不会 Blender
        的用户能先审阅结构和参数，再对局部效果评论与精修；输入不依赖教学视频。
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
