# ADR 0108：Transform Geometry 逐操作 MCP

- 状态：Accepted
- 日期：2026-08-24

## 背景

Transform Geometry 叶子已经把创建 Geometry Nodes modifier、三个节点、Translation/Rotation/Scale、两条连接和
最终验证表达为固定 `01→11` 操作，并在 Blender 内保存 partial run、连续状态指纹和聚合 ActionReceipt。此前这些
能力只可由面板里的 Guided Control 驱动；通用 action-level MCP 会一次执行整个叶子，不能向 Codex 或其它 MCP
客户端暴露可持久化、可观察、可逐步教学的叶内进度。

公开中间 Companion state report 也不是安全的替代方案。01–10 尚未完成正式叶节点，把它们伪装成
`step_succeeded` 会破坏 Plan 游标、Undo checkpoint 和 replay attestation 的含义；由调用者提交 ordinal、节点、
socket 或参数则会绕过已接受 Plan 与 InteractionCatalog 的权限边界。

## 决策

冻结 `interaction-catalog-1.48.0.json`，发布仍绑定 ActionCatalog `1.24.0` 的 InteractionCatalog `1.49.0`。
Transform Geometry recipe 的 menu 与 shortcut 继续 unavailable；新增唯一的 operation-level MCP 声明，固定工具：

`operatingline.blender.geometry-nodes.transform.execute-next`

公开请求严格只有 `formatVersion`、`requestId`、`replayId` 和 `expectedState`。Runtime 必须从不可变 replay binding、
已接受 Proposal、当前已 Start 的精确 executable prefix、目录 `1.49.0` 和此前已认证成功的连续 operation prefix
派生下一 ordinal、operation ID 与参数。调用方不能提交 action、leaf、ordinal、节点、socket、RNA、Python 或 Action
参数。

新增独立的 leaf-operation 协议与持久化 coordinator。每次只派发一个 operation；delivery 绑定目标实例、Proposal、
Plan hash、execution、leaf、完整十一项 ID、目录/物化/MCP hash、派生参数和 operation binding hash。Coordinator 对
请求幂等、一个 Blender 目标保持单一 history owner，并与 action、shortcut、menu-control 和 execution-track 通道互斥。
已派发但未确认的操作在 Runtime 重启后进入 `recovery_required`，永不自动重放。

每条持久请求同时绑定稳定的 Blender document-incarnation authority、实际派发时的 Companion session 和派发
lease。相同 session/document 的 lease 轮换可继续提交同一精确 delivery；同一 document incarnation 内出现新的
Companion session 时，已派发请求原子进入 `recovery_required`，而不是重新派发。不同 document incarnation 不能
接管原请求。这样既不把瞬时 lease 当成十一项操作的共同身份，也能区分普通重连、扩展重载和真正换文件。

Blender Companion 重新读取随扩展发布的同一目录，验证所有 identity/hash/参数和本地 exact-next cursor，再直接调用
bpy-free application command；它不通过 UI operator 或 whole-leaf `Next`。成功结果必须形成同一 run/binding/receipt
身份、精确 completed prefix 和连续 before/after fingerprint chain。01 与 11 是只读验证，02–10 必须真实改变指纹；
每一阶段还必须提交与当前节点图完全一致的结构证据。

01–10 只持久化 leaf-operation progress，Companion state CAS 保持不变。11 必须先发布由同一 document authority
认证的 `step_succeeded` report，再提交引用该 report 的终态结果；Runtime 重新验证完整 Geometry Nodes strong
Observation、Plan/执行/步骤身份、完成顺序和直接承接授权起点的 Blender 原生 Undo checkpoint 后才接受。可证明已恢复
到原状态的失败可终止并重试同一 ordinal；原子恢复或 native history 不确定时保持锁定，要求显式恢复，不能声称失败
已安全完成。

显式恢复只允许只读对账，绝不执行或自动重放 operation。若当前 prefix 与原生 checkpoint 可证明仍是授权状态，
`prefix_restored` 终止原请求；若 operation 已真实完成但结果在网络/进程边界丢失，`operation_applied` 必须携带完整
strict succeeded result 和当前 checkpoint，Runtime 重新运行与普通成功相同的 Observation、连续指纹、report 和
Undo 校验后才把原请求记为成功。响应丢失时，相同不可变 ACK 可在同文档的新 lease 下得到 `duplicate`。

扩展重载会丢失进程内 run/journal/witness，不能伪造上述两种证明。Runtime 只在持久记录证明“同一 instance 和
document incarnation、但 Companion session 已更换”时接受 `document_incarnation_retired`。该终态把 mutation
outcome 明确保留为 `indeterminate`，耐久隔离当前 document incarnation；它释放单个请求锁，但同一文档的所有后续
leaf-operation 请求继续以 409 拒绝，只有真正的新 document incarnation 才能重新开始。普通 lease 轮换、暂时缺少
witness、不同文档或调用方自报均不能触发隔离终态。

同一 Blender 进程内 disable/enable 会保留 instance/document incarnation、轮换 Companion session，并按
instance 在 `driver_namespace` 中延续 report sequence；它不保留 `last_report`、run、journal 或 witness，也不会把
未投递报告伪装成已投递证据。这样 replacement session 的状态报告仍保持单调编号，而恢复判断仍必须因本地证据丢失
进入上述 retirement。`pnpm test:blender:leaf-reload-recovery` 在真实 Runtime 与 Blender 中注入 op01 结果提交前拒绝，
验证 operation 只派发一次、重载后自动 retirement、UI quarantine 和同文档持久隔离。

## 结果

- Codex/MCP 客户端现在能沿同一可视树逐次驱动并观察 Transform Geometry 的 01–11，而不是生成任意 Blender Python。
- 中间操作不会污染正式 Guide 状态；最终叶成功仍只有一个可信 Companion report 和一个正式 aggregate receipt。
- Runtime restart、响应丢失和扩展重载具有互不混淆的持久恢复终态；任何无法证明的当前 Blender 状态都不会继续变更。
- InteractionCatalog 历史版本不继承新权限；Transform Geometry 仍不进入通用 whole-action allowlist。
- 当前只覆盖这一条固定 Geometry Nodes recipe。任意节点图、真实逐 socket 点击、其它 Geometry Nodes、Edit Mode、
  Modifier、骨骼动画和全 Blender 菜单仍需分别建立目录声明、执行器、Observation 与恢复证据。
