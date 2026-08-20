# ADR 0094：Subdivision Surface 的原生快捷键执行证明

- 状态：已接受
- 日期：2026-08-20

## 背景

InteractionCatalog `1.38.0` 已把 Subdivision Surface 的 `Ctrl+1 → F9 → Level → Enter` 建模为有序教学轨迹，
但它没有授权执行，也不能证明 Blender 的实际菜单、快捷键或 action-level MCP 被调用。现有 managed Action
执行器直接操作受管语义动作；即使得到相同场景，也不能作为原生快捷键路径的证据。

Blender 4.5.3 与 5.1.1 提供受启动参数显式开启的 `Window.event_simulate`。该边界可以在 Blender 窗口内投递
事件并收集逐操作收据，但它不是操作系统 HID 输入，且 F9 属性面板的位置只在固定窗口、factory startup 与
精确对象前置条件下可稳定验证。

## 决策

冻结 InteractionCatalog `1.38.0`，发布仍绑定 ActionCatalog `1.22.0` 的 `1.39.0`。新版本只为
`blender.modifier.add_subdivision_surface.semantic` 的既有快捷键轨迹增加 `proofExecution`：

- executor 固定为 `blender.subdivision_surface_f9.event_simulate.v1`；
- target 固定为唯一激活、唯一选中、无 Modifier、对象名为 `Cube` 的 factory Cube；专用 preflight 还锁定
  identity/delta transform、parent/constraint、`±1` 顶点、边与有向 quad 连接、Shape Key、custom normal，
  以及会影响 Subdivision 的 Mesh attribute（包括 crease、UV 与 sharp-face 默认值），不以 `8/12/6`
  数量冒充完整几何身份；
- Blender 版本固定为 4.5.3 与 5.1.1，viewport level 只允许 1、2、3；
- 四个 operation ID、顺序和事件证据由目录及 immutable binding 共同锁定；
- 执行边界固定为 `blender_window_event_simulate`，并明确 `osHidInput=false`；
- managed Action 与 managed receipt 均不得执行或创建。

新增独立 proposal、binding、Companion delivery/progress/result 与 Orchestrator 状态机。公开 execute 请求只接受新
request ID、replay ID 和精确 report CAS；Runtime 从已物化且已接受的单叶 replay 派生目标、level、操作序列与
目录摘要。任意原始按键、事件、坐标、operator、RNA、Python、action 参数、Plan ID 或 step ID 均不进入公开
输入面。

成功必须按顺序满足：Proposal accepted、Start receipt、同一协商 lease、未移动的 untouched report CAS、晚于
dispatch 的四段 canonical receipt chain、强 `subdivision_surface_shortcut_ready` Observation，以及绑定同一
receipt chain 和场景指纹的 Blender 原生 Undo checkpoint。成功状态保持 mutation lock；Undo 变为 `restored`，
Redo 变为 `reapplied_locked` 并重新加锁。

完整成功由一个权威 `completed` event 同时保存 result、history identity 与四段 receipt heads，不把 Observation、
checkpoint 和 success 拆成可留下半链的三个提交。Blender 端在 arm checkpoint 时把同一 terminal result 的内容哈希
与可重交 terminal outbox 固化进 Scene marker；若 Companion 在 result ACK 前重启，新 lease 只能响应 Runtime 发出的
`native_terminal_reconcile` challenge，并提交旧 delivery 的原始 result、精确 marker hash 与当前 locked scene
fingerprint。Runtime 验证已接收 receipt prefix、完整 terminal chain 和全部旧身份后单事件对账；它不会重新执行
任何快捷键，也不会把缺失或不匹配的 outbox 自动转移给新 lease。challenge 还绑定发起轮询的 replacement
session fingerprint；若另一个 replacement lease 在接受前接管轮询，Runtime 会签发新 recovery ID 并使旧
challenge 失效。旧 lease、旧 recovery ID 或二者交叉组合都不能提交，幂等重复只对最终绑定 lease 成立。

每次原生 Undo/Redo 都先把完整 `restored` / `reapplied_locked` result 及其 canonical hash 写入同一 marker，再通知
transport。marker 同时保留最后一个已确认 result 的完整内容，不把裸 hash 或 status 当作信任根；重读时重新验证
完整 immutable delivery identity、checkpoint/lock、baseline/locked/current fingerprint 和严格交替顺序。ACK 丢失或
Runtime 重启后，`native_history_rebind` challenge 带当前服务端 result hash；Blender 只提交该 hash 之后的精确有序
后缀，Runtime 在一个 `history-transition-reconciled` event 中原子保存最终 result、phase、新 lease 与完整 ACK。
客户端只清除精确确认的持久前缀，outbox 上限为 32；第 33 个未确认转换会 fail closed，而不会覆盖既有证据。

`instanceId` 是 Blender 进程中当前已加载文档的运行时 incarnation，其路由来源保存在不进入 `.blend` 的
`bpy.app.driver_namespace`。同一文档内重建 Controller 或 transport 会复用它；`load_post` 会先停止旧 transport 再
轮换 identity，新 OS 进程也会生成新 identity。Scene marker 的完整旧 result 可把旧 `instanceId` 保留为不可变证明
内容，但代码绝不从 marker 恢复当前路由身份。因此复制 `.blend` 不会复制路由权限，文件加载或 Blender 进程重启也
不会自动认领旧 target。跨进程安全恢复若要开放，必须另行设计带认证的 claim/lock 协议；本版本保持 fail closed。

原生输入 driver 在每个 timer turn 投递下一事件前重新验证当前本地 authority 与 live lease。disconnect/unregister
先取消 driver 并注销其稳定 timer callback，再拆 transport；第一段 mutation event 一旦可能进入 Blender，取消路径
必须用当前场景指纹证明已回到 baseline，否则建立 failure checkpoint 或进入 indeterminate lock。`load_post` 使用
独立 abandon 路径，只停止旧 callback，不读取或写入新 Scene；旧 lease 的不确定结果留给 Runtime 恢复状态机处理。

执行中失败若仍保留变更，则记录 failure checkpoint 并保持同样的 Undo lock；Undo 回到 baseline 后为
`restored`，Redo 只恢复失败现场及锁，不把失败升级为成功。执行器能自行证明已回到 baseline 时返回
`failed_restored`；变更前拒绝为 `rejected`；投递或恢复身份不确定时进入 `recovery_required`，不自动重放。

## 证明边界

- `1.38.0` 仍只有候选教学轨迹，不获得执行权；已存 ProcedureTree 也不会因 active 目录升级而自动获得权限。
- 成功只证明 Blender `Window.event_simulate` 边界内的四段事件及报告时场景，不证明 OS HID、逐控件菜单点击、
  action-level MCP 或报告后的当前状态。
- `managedActionResult=not_executed`、`managedIdentityVerified=false`；原生快捷键创建的默认 Modifier 名称不冒充
  accepted managed `modifierId` 或 `modifierName`。
- factory Cube 是由专用 proposal 路径验证并按 consumer step、resource ID、resource type 精确绑定的外部输入；
  普通计划仍必须提供资源 creator。
- Scene marker 是持久 outbox 与 history association，不单独构成成功证明；只有 Runtime 对旧 delivery、result、
  marker hash、live fingerprint 和已有 progress prefix 完成精确对账后，才可恢复 ACK 前的终态。
- marker 中旧 result 的 `instanceId` 只是历史证明，不能恢复当前 Companion identity；同一运行时 incarnation 的
  恢复权限来自进程内 namespace，复制或加载 `.blend` 不能继承 target lease。
- 本执行器不授权其它对象、快捷键、菜单、Modifier、Edit Mode、Geometry Nodes 或 Blender 版本。

## 验证

- 冻结 `1.38.0` 的逐字内容与 SHA-256，并证明 `1.39.0` 只改变版本、factory Cube 前置条件和 proof declaration；
- 协议覆盖 proposal/binding/receipt/Observation/checkpoint/attestation 的 canonical hash、完整身份绑定和非法输入拒绝；
- Orchestrator 集成覆盖 accepted/Start/lease/CAS、独立 Companion 投递、四段 progress、success lock、Undo 与 Redo；
- failure history 覆盖 checkpointed failure 的 Undo/Redo 循环且从不生成 success attestation；
- crash-window 覆盖 checkpoint arm 后、result POST 前、POST 后 ACK 前及 Undo/Redo result ACK 前的
  Controller/transport/Runtime 重启；恢复只重交原始 terminal evidence 或当前服务端 result 后的严格转换后缀，不再次
  运行 driver，并拒绝 marker、完整 acknowledged result、fingerprint、delivery、checkpoint 或 receipt prefix 篡改；
- replacement lease B/C 竞争覆盖 challenge 轮换、旧 lease/旧 recovery ID 拒绝、最终 lease 幂等接受及 Runtime
  重启后的同一约束；真实 Blender history E2E 覆盖 terminal POST 已被接受但 ACK 丢失、Controller 重建、
  `native_history_rebind`、单 checkpoint lineage 与事件计数不增加；
- driver 生命周期覆盖 mutation 前取消、mutation 后取消、每 turn authority 撤销、event dispatch 异常、缺失或异常
  cancel、文件替换 abandon，以及 checkpoint 构造/验证/写入失败时的 fail-closed lock；
- 身份生命周期覆盖同一文档 Controller 重建复用、`load_post` 轮换并停止旧 transport，以及 `.blend` marker 不提供
  `instanceId`；
- Blender 4.5.3 与 5.1.1 分别验证 level 1、2、3 的真实事件轨迹、Modifier 属性、求值拓扑、指纹和原生历史。

## 后续

仍需为更多菜单与快捷键建立各自的版本化 proof declaration、控件定位与 Observation；需要真实操作系统输入时，应
单独设计带权限与平台证明的 HID 边界，不能复用本 ADR 的 `event_simulate` 结论。
