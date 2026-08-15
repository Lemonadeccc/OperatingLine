# Blender Companion

## 是否需要修改 Blender

当前需求不需要给 Blender 仓库提 PR。Blender Extension 可以通过公开 API 注册：

- `Panel` / `UILayout`：Sidebar 任务树和 Start、Next、Back。
- `Panel` / `UILayout`：可折叠 Goal-to-Guidance 输入、异步请求状态和初始 Proposal 审批入口。
- `Panel` / `UILayout`：同一 Sidebar 内的 AI 提案摘要、只读树与 Accept/Reject。
- `Panel` / `UILayout`：可折叠 Revision Workspace，包含活动树/待审树节点 `Ref`、逐条移除、
  独立修订正文、branch fork/switch/merge、Provider 选择/披露、异步 Run、流式模型对话、历史、Plan diff 与
  Accept/Reject。
- `Operator` / 原生 dialog：每次 Provider Run 或 Dialogue Turn 的明确确认；不保存长期 consent、模型或
  Provider 凭据。
- `Operator`：宿主数据操作。`Back` 保留 receipt 补偿语义；Start、Next、Recheck、原生菜单动作和
  Back 同时接入 Blender 原生 Undo，`undo_post`/`redo_post` 会恢复模块 Session 并重绑定 RNA identity。
- `Menu` / `UILayout` / `Operator`：从版本化 InteractionCatalog 读取活动叶节点配方；在 Guidance
  可见期间，为经过版本测试的真实 `Add → Mesh → Plane/Cube/UV Sphere/Ico Sphere/Cone/Cylinder/Torus` 菜单项显示序号与状态，并把
  最终项路由到同一个受控计划动作。
- `SpaceView3D.draw_handler_add`：`POST_PIXEL` 步骤卡片、数字和引导线。
- `gpu` / `blf`：形状与文字绘制。
- `GizmoGroup`：后续需要可交互三维锚点时使用。

官方参考：[Creating Extensions](https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html)、
[SpaceView3D](https://docs.blender.org/api/current/bpy.types.SpaceView3D.html)、
[Panel](https://docs.blender.org/api/current/bpy.types.Panel.html)、
[Menu](https://docs.blender.org/api/current/bpy.types.Menu.html)、
[GizmoGroup](https://docs.blender.org/api/current/bpy.types.GizmoGroup.html)。

## 需要上游 PR 的边界

只有以下诉求才考虑 Blender Core PR：新增原生 Editor/Space、公开 API 缺失、需要新的绘制或
事件阶段、需要 Blender 官方维护的持久异步运行时，或需要 Python 扩展无法实现的安全边界。

任意内置按钮的像素边界不是稳定协议。本项目优先标注自有 Panel 控件、对象、骨骼、材质节点
和世界坐标；Plan 的 `operatorId`/`menuPath` 只保留语义，不决定可点击 UI。Blender InteractionCatalog
`1.21.0` 与 ActionCatalog `1.12.0` 一一绑定 22 个 action，并由活动叶节点的 `actionName` 选择配方；历史
`1.9.0` 至已冻结的 `1.20.0` 保持精确回放。UV Sphere 保留目录绑定的七步 menu 与六步
candidate shortcut；快捷键显式区分 chord/sequence 并把 location 分量绑定到 `G → X/Y/Z`。Icosphere
保留四步 guidance 加 Location、Object Name 的六步 menu，精确绑定 `subdivisions`、`radius`、`location`
与 `objectName`；其九步 candidate shortcut 依次执行 `Shift+A → Mesh → Ico Sphere`、`F9`、
Subdivisions、Radius、`ENTER`、`G X/Y/Z` 与 `F2`。Cube 和 Plane 各自使用四步 guidance 加 Location、Object Name 的六步 menu；最终 operator
以 identity 投影绑定 accepted action 的 `size`。该值表示完整边长而非 transform scale。Cube 与 Plane
各有 candidate-only 六步 shortcut：六项前置条件固定为 `Layout`、`VIEW_3D`、`OBJECT`、Blender
keymap、3D Cursor `[0,0,0]` 与 GLOBAL Transform Orientation；依次执行
`Shift+A → Mesh → Cube` 或 `Shift+A → Mesh → Plane`（默认 `size: 2`、origin）、`G X`、`G Y`、
`G Z`、`S` 与 `F2`。
三个移动步骤绑定 `location` 分量，`S`
通过封闭 `divide_by_two` 绑定 `size / 2`，`F2` 绑定 `objectName`。Torus 独立绑定
`major_segments`、`minor_segments`、literal `mode: MAJOR_MINOR`、`major_radius`、`minor_radius`，再绑定
Location 与 Object Name。
Cone 使用四步 guidance 加中点 Location、Object Name 的六步 menu。最终 operator 严格按序输出
`vertices: 32`、`radius1 ← radiusStart`、`radius2 ← radiusEnd`、`depth ← distance`、
`end_fill_type: NGON`、`calc_uvs: false`、`enter_editmode: false`、`align: WORLD`、
`location: [0,0,0]`、canonical `rotation`、`scale: [1,1,1]`。封闭 `derived_action_arguments`/
`segment_frame` 使用 `dx/dy/dz = end - start`、`horizontal = hypot(dx,dy)`、
`distance = hypot(horizontal,dz)`、`midpoint = (start+end)/2` 与
`rotation = [0,atan2(horizontal,dz),horizontal===0?0:atan2(dy,dx)]`，并将 `-0` 规范化为 `0`。
`distance`、`midpoint` 与 `rotation_euler_xyz_align_z` 各恰好映射一次。canonical zero-roll
XYZ Euler 只对齐本地 `+Z` 轴到 `end - start`；本地 `-Z`/`radius1` 对应
`start`/`radiusStart`，本地 `+Z`/`radius2` 对应 `end`/`radiusEnd`。它不声称与 managed
executor quaternion/roll 精确等价。
Cylinder 也使用四步 guidance 加中点 Location、Object Name 的六步 menu。最终 operator 严格按序输出
`vertices: 32`、`radius ← radius`、`depth ← distance`、`end_fill_type: NGON`、
`calc_uvs: false`、`enter_editmode: false`、`align: WORLD`、`location: [0,0,0]`、canonical
`rotation`、`scale: [1,1,1]`。它复用相同的 `segment_frame` 公式和三输出各恰好一次约束；
canonical zero-roll XYZ Euler 将本地 `+Z` 对齐 `end-start`，本地 `-Z` 端对应
`start`，本地 `+Z` 端对应 `end`，两端使用同一 `radius`，且不声称与 managed
executor quaternion/roll 精确等价。
Icosphere、Cube、Plane、Torus、Cone 和 Cylinder 都省略内部 `resourceId`；Torus、Cone、Cylinder
shortcut unavailable，所有 MCP track 也因没有真实 action-level tool 而 unavailable。
Icosphere shortcut 使用 ProcedureTree `1.1.0` / Result `1.3.0`，Cube 与 Plane shortcut 使用 Result
`1.2.0`，其余这些 menu-only 结果使用 Result `1.1.0`；轨迹仍是
`candidate`/`structural_only` 教学投影。Icosphere 的创建与 F9 参数前缀已在 Blender 4.5.3/5.1.1
完成真实事件回放并验证 3/2.5、162 顶点和半径，但后续移动/重命名及 managed action 语义仍不是完整
UI operation replay。Cube 与
Plane 的 Blender 4.5.3/5.1.1 operator/transform 探针不是实际键盘事件或完整 UI replay；它们保留默认
未 bake mesh 与 `scale = size / 2`，不等价于 managed executor 的 baked mesh/`scale = 1`。冻结的
`1.19.0` 保持 Plane shortcut unavailable。Cone/Cylinder 的 Blender
4.5/5.1 原生 operator 双版本探针也不等于六步 UI replay。原生菜单/operator
也不能复现 managed collection 归属、resource tag、receipt、幂等或补偿语义。见
[ADR 0050](../adr/0050-cube-ordered-menu-materialization.md) 与
[ADR 0051](../adr/0051-plane-ordered-menu-materialization.md) 与
[ADR 0052](../adr/0052-torus-ordered-menu-materialization.md) 与
[ADR 0053](../adr/0053-cone-segment-frame-menu-materialization.md) 与
[ADR 0054](../adr/0054-cylinder-segment-frame-menu-materialization.md) 与
[ADR 0055](../adr/0055-cube-candidate-shortcut-materialization.md) 与
[ADR 0056](../adr/0056-plane-candidate-shortcut-materialization.md)。Extension 的严格目录 loader 能解析并
验证 `F9` opener、逐控件 property update 与 `ENTER` closer，且要求控件属于 expected operator；
`1.21.0` 只据双版本前台证据启用 Icosphere 的 candidate materialization，不把它升级为 verified execution。
见 [ADR 0057](../adr/0057-shortcut-operator-property-surfaces.md) 与
[ADR 0058](../adr/0058-icosphere-f9-shortcut-materialization.md)。
Blender 4.5/5.1 版本适配器只把目录中的 `Add → Mesh → Plane/Cube/UV Sphere/Ico Sphere/Cone/Cylinder/Torus` 七条 `native_path` 接到
真实控件：Guidance 可见时临时替换三个原生菜单类的 draw 方法，隐藏或卸载时精确恢复；最终绿色
菜单项与 `Next` 进入同一个 Session action 和 receipt。相同 action 的叶节点会复用同一路径，例如
三个身体球；Cube、鼻子和手臂会分别切换到各自 recipe。批量几何、Edit/Modifier/Geometry Nodes、
材质、骨骼、显式蒙皮权重、动画和渲染等十五条
`semantic_path` 在卡片中显示灰色有序参考与 `UI target unavailable`，不绘制猜测坐标或替换无关
菜单项。未来只有新的版本专用 recipe 通过真实宿主测试后，才能升级为 `native_path`。见
[ADR 0024](../adr/0024-versioned-interaction-catalog.md) 与
[ADR 0026](../adr/0026-native-cube-action-slice.md) 与
[ADR 0027](../adr/0027-native-icosphere-action-slice.md) 与
[ADR 0028](../adr/0028-native-torus-action-slice.md) 与
[ADR 0029](../adr/0029-bounded-edit-modifier-geometry-nodes.md) 与
[ADR 0037](../adr/0037-bounded-solidify-modifier.md) 与
[ADR 0038](../adr/0038-bounded-edit-triangulate.md)。

## 视觉引导状态

Blender 应用层从 `active_index` 派生唯一稳定状态，不在 Panel 与 Overlay 各自维护第二份进度：

```text
index < active_index      -> completed（蓝色）
index == active_index     -> back（红色）
index == active_index + 1 -> next（绿色）
index > active_index + 1  -> locked（灰色）
```

Sidebar 用相同状态绘制根节点、阶段与叶子，并以文字 `OK`、`BACK`、`NEXT` 和锁图标补充颜色。
Back 按钮使用 Blender 原生 `alert` 警示背景，Next 使用绿色宿主图标，因为 `UILayout` 不支持
任意按钮背景色。视口 `POST_PIXEL` Overlay 最多显示四个相邻全局执行序号；Back/Next 的
真实对象或世界坐标锚点分别使用红/绿 4 px 主线、8–10 px 深色描边、箭头和终点编号。

底部步骤卡片使用更大的标题、状态文字、按钮提示与序号徽标。允许列表中的菜单叶子还会显示
`Layout → Add → Mesh → target` 四个微步骤：当前菜单层级为蓝色、紧邻的上一步/BACK 为红色、
下一点击为绿色、更早完成的层级为蓝色、未开放为灰色，并以同色连线连接。真实原生菜单在标签
右侧显示折叠序号与 `BACK/CURRENT/NEXT/ALT`，搭配 Blender 内置红/蓝/绿状态块；顶部 Add 入口的
紧邻上一步/BACK 使用原生 `alert` 红色背景，当前使用原生 `depress` 蓝色背景。`UILayout` 不提供
逐控件的绿色背景，因此下一步保留绿色状态块和 NEXT 文案；精确的绿色填充徽标和彩色连线由视口
卡片承担。适配器不修改全局主题，也不猜测控件像素坐标。计划外 `ALT` 项进入同一严格校验并拒绝
执行，不创建未跟踪对象。

引导可见性属于 Blender 进程级 UI 状态，保存在带 `SKIP_SAVE` 的 `WindowManager` 属性中，
因此切换到 OperatingLine 隔离 Render Scene 不会错误地把 UI 显示成隐藏。`Hide Guidance`
移除 draw handler、恢复原生菜单 draw 方法，并隐藏树与状态详情，但保留执行控件和
`Show Guidance` 恢复入口；步骤、receipt 与场景内容不随隐藏而改变。

## 主线程规则

当前 Companion 使用无 `bpy` 依赖的 Python 标准库网络线程，经鉴权向回环 Orchestrator 提交初始
GoalRequest，并短轮询 GuidePlan/GuideProposal、Provider descriptor、异步 Initial Plan Run、Replan Run
与 Dialogue Run 状态，再把 JSON 放入队列。Provider 的对话 SSE 只在 Runtime 内消费；助手增量先写入
durable append-only revision，Blender 始终只读取短 JSON 状态。
网络线程启动后先使用 Companion Session `1.0.0` 声明宿主/Companion 版本、支持的 Guide 协议、
ActionCatalog `1.12.0` 和能力画像；只有 Runtime 返回匹配目录与当前 Guide `1.5.0` 后，UI 才显示
Connected。Guide 与状态请求绑定服务端签发的 lease，线程按协商周期发送严格递增心跳；失联、过期、
Runtime 重启或同实例新会话替代旧 lease 时清空本地会话并自动重新握手。在线发现与持久化快照的边界
见 [ADR 0040](../adr/0040-companion-session-leases.md)。这里的 Connected/presence 只表示后台 transport
完成了握手和近期 HTTP 往返，不是 Blender 主线程执行就绪证明，也不是所有 Companion 端点的授权租约。
长达 120 秒的 Provider 调用运行在 Orchestrator 后台，不占用 Blender 的短请求线程。`bpy.app.timers` 在 Blender 主线程校验
提案、构建预览 Session、安装已接受计划、执行动作、回退并生成观察；绘制回调不访问网络、
不修改场景，只从当前会话派生最多四个相邻步骤，并为 Back/Next 解析已记录资源的
屏幕锚点。原生菜单 draw 也只推进瞬时的菜单揭示深度；只有最终受控 Operator 或 `Next` 才执行
同一个计划 action。

Start/Next/Back/Show/Hide 由 Blender Operator 事件触发当前界面自然重绘。Blender 4.5/5.1
没有可供 Extension 稳定调用的公开 `Area.tag_redraw` API，因此只更新远端计划或连接文案的
Companion timer 事件，可能要等到 Blender 的下一次正常界面重绘后才显示；生产代码不会为此
滥用面向测试/性能测量的 `wm.redraw_timer`。

网络请求有总时限、4 MiB 响应上限，并绕过系统代理且不跟随重定向。Disconnect/Extension
卸载只做短暂等待；残余清理线程为 daemon、保留到确认退出且不访问 `bpy`。Blender manifest
声明 network 权限，UI 同时检查 `bpy.app.online_access`；URL 仅接受 `http` 回环地址，Token
使用 WindowManager `SKIP_SAVE` 属性，不写入 `.blend`。

`guide.publish` 路径运行中收到新计划不会触发场景回退。若当前会话仍持有 action receipt，更新
会暂存并只报告一次 pending/error；用户 Back 到起点后由主线程自动安装。

`Goal to Guidance` 路径只把用户输入构造成 `GuideGoalRequest 1.1.0`：请求绑定当前
`blender + instanceId + ActionCatalog 1.12.0`、原始目标和一个新 Plan ID，不包含 Provider 或凭据。
提交在既有网络线程排队，主线程只显示 local、delivering、awaiting planner、proposal received 或
error；断线重试复用同一 payload 和 request ID。同一实例已有 active goal、revision request、Provider
Run 或待审 Proposal 时不能再提交。Runtime acknowledgement 只说明请求已持久化，不会自动选择或调用
Provider。外部 MCP 客户端仍可显式执行 list → prompt.get → evaluate → guide.propose。

若显式 Runtime 已注册 Planner Provider，acknowledgement 后的同一 Goal Workspace 还会提供可选 Initial
Plan Run。用户必须主动刷新公开 descriptor、选择 Provider、阅读 local/remote 数据传输和可能费用说明，
再通过 `Confirm Initial Planner Run` 原生 dialog 授权一个新 generation UUID。远端 Provider 只接收该
Goal、精确 ActionCatalog 和发起 Blender instance 的状态；Blender 不保存 API Key、模型或 endpoint。
transport 只发送短 `POST` 并轮询短 `GET` 状态，queued/generating/needs_revision/failed/interrupted 均不
修改 Session 或场景。ready 只创建既有 Goal-linked Proposal，仍需独立 Accept/Reject；Retry 必须重新
确认并换新 UUID。活动 Run 断线重连只重发完全相同的授权，Runtime 幂等返回持久状态，不再次授权调用。

请求关联 Proposal 必须带匹配的 `goalRequestId`、当前 `instanceId`、目录版本和预留 Plan ID，且不能
同时伪装成 revision Proposal。Blender 在主线程核对后才复用既有只读 Proposal 树；错误或无关 Proposal
不会清除 active goal。Accept/Reject 只在精确关联的审查结束后清除该请求状态。请求提交、重试、预览和
Reject 保持活动 Session、receipt、默认 Cube/Camera/Light 与场景对象不变。

`guide.propose` 路径始终进入独立审查状态：Blender 完整验证计划结构、动作允许列表与参数，
只创建不执行的预览 Session，并在 Revision Workspace 显示 proposal ID 对应的计划标题、
revision、目标宿主、Plan diff、只读任务树以及 Accept/Reject。存在提案时 Start/Next 在 UI 与
Operator 两层都被门禁，Back 保留，
以便活动会话回到起点。Accept 只有在 receipt 为空时才原子替换活动 Session，仍不会执行第一个
action；Reject 只清除预览。两种决策由主线程各生成一次稳定 payload，由网络线程异步重试且按宿主
实例幂等；只有 `accepted/duplicate` acknowledgement 回到主线程后才清除 pending 决策。连接替换保留
待审 Proposal、Goal 关联和同一决策身份；校验失败的 Proposal 只在当前连接隔离并报告，不会回传人工
Reject。普通 UI Disconnect 只暂停网络并保留待审 Proposal、Goal 关联、活动 Initial Plan Run、Replan
Run、Dialogue Run 的精确授权和活动修订草稿；Extension unregister 才显式清理这些进程内状态。

活动树和待审树的每个节点都提供 `Ref`。引用以结构化行显示，不插入或篡改用户正文；重复点击
去重，每条可独立移除。同一草稿最多引用 8 个节点，且不能混合两个 Plan 基线；尝试引用其他
基线会显式失败，保留当前引用和正文，需用户先 `Clear Draft`。发送时 Companion 把完整 base Plan、
稳定节点 ID、当时的树编号、打包目录版本、消息和可选结构化参数 edits 放入后台队列。每个 action
引用下的表单由打包目录派生：boolean、integer、number、enum 与 1–4 维定长数值向量可编辑；普通
string 与嵌套 records 保持只读。每次 edit 都先在 base Plan 隔离副本中通过完整 action 参数验证；移除
引用会同步移除其 edits，Reset/Clear 只清理本地草稿。请求确认或暂时失败只更新 UI 状态，不调用
`bpy` 场景 API。
Orchestrator 返回的请求关联 Proposal 必须带当前 `instanceId`，Blender 在主线程再次核对后才建立
只读预览。Protocol `1.1.0` 的 Proposal 还必须带线性 thread 元数据和 Plan diff；Panel 在 Accept 前
显示 `+ / - / ~ / moved`、变化节点、字段和可紧凑表示的 action 参数前后值。接受请求关联 Proposal
后，新的 active-plan 引用会继承 `threadId`、递增 turn 并把上一 request 作为 parent。Revision Workspace
仍以修订操作日志保存确定性请求/Proposal 历史；另一个 `Streamed model dialogue` 区域显示当前轮的
持久助手增量和最近对话。点击 `Send Request` 只进入认证的后台队列，不执行 Blender action。Runtime acknowledgement 后，工作区可列出
严格公开的 replan Provider descriptor，但默认保持未选择；不可用项只显示原因。选择远端 Provider 后，
界面明确说明将发送修订消息、结构化参数 edits、完整 base Plan/引用、ActionCatalog 与最新 Companion 状态，且调用可能
产生费用、OperatingLine 无法估价。`Confirm Provider Run` 使用 Blender 原生 dialog 逐次确认；重试显示
`Confirm New Provider Run`。Provider、
request 改变、断开、终态或 Retry 都不会沿用先前确认。

Protocol `1.4.0+` 下，后台还按当前 Plan 拉取每条 revision thread 的 durable head。只有带已接受 Proposal
和精确 `planContentSha256` 的 head 可以 `Switch`；切换要求当前 walkthrough 无 receipt、无待审 Proposal
或活动 Run，只替换 idle Session 并跟随对应历史，不执行 action。`Fork` 把活动已接受 lineage 固定为
source 并创建 turn 1；`Merge` 自动清空普通草稿、只引用目标 Plan root，并把选中的另一条已接受 head
作为 source。Runtime 负责唯一共同祖先、三方合并与冲突拒绝；Blender 不提供手工覆盖冲突的旁路。
生成的 merge Proposal 显示 source 与 `mergeBaseRequestId`，仍须 Accept/Reject。

确认后 transport 只发送一个短 POST，并轮询版本化 Run 状态。Run 的 queued/generating/needs_revision/
failed/interrupted 状态只更新应用/UI 状态；`proposal_created` 仍通过既有 Companion delivery 建立只读
preview。同一实例已有活动 Run 或未决 Proposal 时 Runtime 拒绝新 Run；失败/重启后的 Retry 使用新 UUID
并再次确认，不自动重复可能已计费的调用。Blender 不保存 Provider API Key、模型或 endpoint。Run、
Proposal preview 和 Reject 不修改活动 Session 或场景；Accept 只替换空闲 Session，`Next` 才执行第一个
action。默认 provider-free Runtime 显示空列表，外部 MCP planner 路径不受影响。

Dialogue Turn 只支持普通 `revise`，复用当前正文、结构化参数 edit、节点引用和至多 12 条严格交替的
近期对话。用户必须先刷新并明确选择支持 dialogue/replan 的 Provider，再在原生 dialog 确认本轮可能
传输的数据、可能费用、一次授权最多两次调用、固定 `0.8` 自动重规划阈值和 Proposal-only 结果。首次
Provider 调用的文本通过 `queued → streaming` 状态逐步显示；严格结果若为 answer 或 replan confidence
低于阈值，则以 `answered` 结束且不保存 revision request。达到阈值时，Runtime 原子保存已授权的候选
GuideRevisionRequest 并进入 `replanning`，再复用既有 replan 作为第二次也是最后一次调用。结果只能是
`needs_revision`、`proposal_created`、`failed` 或 `interrupted`；失败和重启不自动重做 Provider 调用。
已入库但未形成 Proposal 的 request 会转交普通 Replan Run，用新的 generation UUID 重新显式授权同一
request；Reject 后下一次明确授权从当前 accepted Plan 开新 thread。Proposal 仍按精确
`(revisionRequestId, proposalId)` 进入同一 Accept/Reject 门，不会自动安装或执行。

Provider Run 的 `queued/generating` 或 Dialogue Run 的 `queued/streaming/replanning` 期间，Sidebar 禁用
第二次 Send Request、Provider refresh 和并发 Proposal decision，
但保留草稿编辑、历史、既有计划与 walkthrough 控件。Controller 和 handoff state 都执行相同门禁；活动
Run 的 revision/generation identity 不会被普通 Plan/Proposal 投递或重复 ACK 清除。只有精确 pending ACK
能首次绑定，精确重复是 no-op；非活动状态安装新 Plan 会使旧 request context 失效，因此晚到 ACK 不能
把过期请求重新变成可运行状态。

Proposal delivery 可能早于或晚于 terminal status。Companion 使用有界的复合键候选集隔离这些消息，
初始 Run 只按精确 `(goalRequestId, proposalId)` 绑定，Replan/Dialogue Run 只显示 status 指定的
`(revisionRequestId, proposalId)`；错误 request、同 ID poisoning 或后到的无关 Proposal 不得覆盖
Provider Proposal。若同 request 的 Proposal 先到而 Dialogue 随后失败，终态会提升缓存 Proposal，避免
transport 去重造成隐藏。队列为活动/已知 Provider 结果保留容量；队列满只显示本地错误，不自动发送 Reject。
Request-linked Proposal
的 Accept 还会把 diff base 与当前 active Session 精确比较，漂移时保持 Proposal、场景、Session 和证据
不变。没有可验证 `planDiff.basePlan` 的旧版 request-linked Proposal 仍能查看和 Reject，但 Accept 在 UI
与 Controller 两层 fail closed。

后台 transport 还会读取当前 Plan 的 branch heads 和当前 thread 的
最新历史页；主线程验证 request/proposal/diff/decision 关系并在 Sidebar 显示最近三轮。用户可展开
全部已加载轮次，或通过 `Load Older Turns` 使用 `beforeTurn` 继续向前分页。历史是只读审查事实，
不会调用场景 API。折叠 Revision Workspace 或使用 `Hide Guidance` 都不会丢失草稿、Run、历史、执行进度或场景状态。

## revision 6 雪人教学执行切片

打包内的 `snowman-demo` revision 6 是当前 Blender Companion 的确定性验收场景。它按线性 DAG
执行 7 个阶段、25 个叶子步骤：创建地面和三段身体，再逐件创建两只眼睛、一个鼻子、五个嘴点、
三个纽扣和两条手臂，使每个部件都能独立引用、执行与回退；随后分配雪、煤、
胡萝卜、木头和地面材质，创建四骨骼 Armature 并把头部组件与两条手臂刚性绑定，写入第 1、20、40
帧姿态，创建隔离的 Scene、World 与自有 Collection，加入两个 Area Light 和一台 Camera，
最后在扩展管理的临时目录生成帧 20 的 320 × 320 Eevee PNG。

规范源是 `protocol/fixtures/v1/snowman-teaching.plan.json`。原
`protocol/fixtures/v1/snowman.plan.json` revision 4 保持字节与内容哈希不变，只用于既有
ActionCatalog 1.3.0 Human Eval 套件的精确回放；打包同步脚本会把 teaching fixture 复制成扩展内部
稳定资源名 `resources/snowman.plan.json`。

当前动作目录 `1.12.0` 允许以下 22 类 action，把它们完整划分到 Geometry、Materials、Animation、
Render setup 和 Output 五个有序规划阶段，并保留不可变 `1.0.0`、`1.1.0`、`1.2.0`、`1.3.0`、`1.4.0`、`1.5.0`、`1.6.0`、`1.7.0`、`1.8.0`、`1.9.0`、`1.10.0`、`1.11.0` 供精确回放：

- `blender.mesh.create_plane`
- `blender.mesh.create_cube`
- `blender.mesh.create_uv_sphere`
- `blender.mesh.create_icosphere`
- `blender.mesh.create_cone`
- `blender.mesh.create_cylinder`
- `blender.mesh.create_torus`
- `blender.mesh.create_primitive_batch`
- `blender.mesh.edit_subdivide`
- `blender.mesh.edit_triangulate`
- `blender.mesh.edit_extrude_region`
- `blender.modifier.add_bevel`
- `blender.modifier.add_solidify`
- `blender.geometry_nodes.create_transform`
- `blender.material.create_and_assign`
- `blender.material.create_palette_and_assign`
- `blender.rig.create_armature`
- `blender.rig.bind_skin_weights`
- `blender.animation.create_pose_keyframes`
- `blender.render_scene.create`
- `blender.render_rig.create`
- `blender.render.execute_preview`

`1.12.0` 提供十四项适配器自有 `semanticCapabilities`：ground plane、primitive assembly、whole-mesh
subdivide、whole-mesh triangulate、connected face-region extrusion、Bevel Modifier、Solidify Modifier、Transform Geometry Nodes、Principled material palette、rigid armature、
explicit deform skin weights、pose transform keyframes、render scene setup 和 PNG preview output。
Capability-aware Planning/Replanning Packet `1.1.0` 要求 provider 把每条具体需求映射到这些稳定能力，
再映射到 action 属于该能力的可执行叶子；局部重规划只能引用规范化引用子树内的叶子。缺失、未知、
action 不匹配或范围外的映射使 quality baseline `1.1.0` 失败并返回 `needs_revision`，不会产生
Proposal。历史目录继续使用 packet/baseline `1.0.0` 回放。

该 coverage 随 planning-quality 事件进入 Eval，不进入 Blender GuideProposal 信封，也不改变
Revision Workspace、Accept/Reject 或 `Start`/`Next`。它只证明 provider 声明可追溯到真实目录动作，
不证明需求抽取、参数语义或最终视觉结果正确。完整决策见
[ADR 0017](../adr/0017-catalog-grounded-goal-coverage.md)。

注册表按步骤 ID 绑定 action，而不是假设 action 名唯一。一个步骤的 receipt 可以同时记录多个
Blender datablock、mutation 和渲染产物；资源解析同时核对 `session_uid`、pointer、receipt token、logical ID、
步骤 ID 和 action 名。复合动作先对整批对象、数据和逻辑 ID 做预检，执行异常时补偿已经创建或
修改的部分。回退 mutation 前执行 compare-and-restore：当前值不再等于该动作写入的值时拒绝
覆盖，并保留当前步骤和 receipt。`Next`/`Back` 因而可以完成 25 步正向执行与完整反向补偿，
这种 Plan 补偿与 Blender 原生 Undo 是两层并存语义。

原生历史在每个成功或明确保留现场的 Operator 内写入一个随机 Scene checkpoint，并在进程内保存
对应 Session 快照。Undo/Redo 恢复 marker 后，handler 以 `session_uid` 和 action ownership 标签重新
绑定 ID；Modifier 使用所属对象、stack index、名称、类型和允许属性精确匹配。即使普通用户 Undo
没有改变 marker，也会静默刷新可能已重建的 pointer，但不会发送步骤 transition。PNG 不属于 Blender
历史，journal 只在内容哈希仍匹配 receipt 时删除或原子恢复有界字节；冲突会锁住新的 walkthrough
操作，直到 Undo/Redo 回到一致 checkpoint 或文件重载。完整文件加载和 Plan 替换会放弃 journal，
不会从可复制 Scene 标签接管旧执行。Back 仍执行 compare-and-restore 补偿，只是该补偿操作本身也
可以 Ctrl-Z/Redo。见 [ADR 0031](../adr/0031-blender-native-undo-history.md)。

Edit/Modifier/Geometry Nodes 当前开放六个有界动作：Subdivide 复制源 Mesh、对整网格执行
`1..8` cuts 后把对象换链到新 Mesh，源数据保留至回退；Triangulate 以固定 `FIXED` / `EAR_CLIP`
方法把复制 Mesh 转换为三角面；Bevel 创建一个不应用的 modifier；Solidify
只接受 `thickness` (`0.0001..100`) 与 `offset` (`-1..1`)，只允许 receipt-tracked 前置 Modifier，且源 Mesh 与
前置 stack 的求值输入均不超过 8192 vertices、16384 edges、8192 polygons，固定 `solidify_mode=EXTRUDE`、`use_even_offset=true`、`use_rim=true` 和
`use_rim_only=false`；Extrude Region 解析 1–256 个唯一 polygon index，要求一个有边界的连通面区域，
按长度在 `0.0001..1000` 的固定局部空间向量移动新顶点，并对源/结果实施相同拓扑上限；它在读取索引前验证
源 Mesh 内容与 Object→Mesh receipt 链，再按来源顶点、无向边和面顶点集合规范化结果索引，允许后续
Extrude 在 Blender 4.5/5.1 间稳定引用结果 polygon；Geometry
Nodes 创建固定的 Group Input → Transform Geometry → Group Output 图并通过一个 NODES modifier
挂载。动作创建的 Mesh 内容、初始 Object→Mesh link、蒙皮后的后继 Mesh 签名、modifier 精确属性和 node graph/interface 签名都参与 compare-and-restore，外部修改
会保留 receipt 并阻止旧状态覆盖。任意 vertex/edge 选择、互不连通的 face region、任意 Edit Mode operator、其他 modifier 类型和任意
node graph 仍不在允许列表。见 [ADR 0029](../adr/0029-bounded-edit-modifier-geometry-nodes.md) 与
[ADR 0037](../adr/0037-bounded-solidify-modifier.md)、
[ADR 0038](../adr/0038-bounded-edit-triangulate.md) 与
[ADR 0041](../adr/0041-bounded-edit-extrude-region.md)。

回退前会一次性检查当前 receipt 的全部资源。自有 Mesh/Light/Camera/Armature data 存在额外
用户、Material 或 Action 被计划外对象使用、Object 被链接到计划外 Collection，或自有
Collection/Scene 增加了未跟踪内容时，回退以零写入失败并保留 receipt 与步骤索引；用户解除
冲突后可以原地重试。扩展在同一 Blender 进程内被禁用时也不会因为该冲突而卸载失败或丢弃
receipt。模块重载后仍不会仅凭可复制标签接管旧资源。

Armature 创建 action 只接受 1–32 个具名骨骼和 1–64 个既有自有对象刚性绑定；父骨引用必须存在且
无环，绑定目标必须未被父级占用，并在 bone parenting 时保留对象世界矩阵。独立 skin action 只接受
最多 8192 顶点的自有未父级 Mesh、已有自有 Armature、完整且唯一的顶点索引，以及每点 1–8 个唯一
骨骼影响；执行时再次要求每点权重和为 1，不调用自动权重。它创建按骨名命名的 Vertex Group、一个
Armature Modifier，并只把引用骨骼设为 deform。动画 action 仍只接受 2–64 个严格递增帧和范围在
±2π 内的 Euler 旋转，同时可选写入有界 local location/正 scale，并统一声明 Bezier/Linear/Constant
插值与 Constant/Linear 外推。失败补偿会解除 Action/Modifier、恢复 pose、deform 标志、顶点组与
父子关系，再删除自有 Action、Armature object 和 data；任何外部权重、modifier 或关键帧修改都会
以零写入失败并保留 receipt。见
[ADR 0032](../adr/0032-bounded-skin-weights-and-pose-transforms.md)。

隔离渲染 Scene 只链接 OperatingLine 自有 Collection。默认启动文件中的 Cube、Camera 和 Light
既不会被删除，也不会进入该渲染 Scene；创建的相机和两盏 Area Light 只属于这次执行记录。
为了历史 Plan/receipt 精确回放，目录中的集合逻辑 ID 仍为 `snowman.collection`，但用户可见的
Blender Collection 名称已经是目标无关的 `OperatingLine Generated`。
预览 action 只接受扩展临时目录、1–100000 的显式帧，单边分辨率上限为 1024，采样上限为 128，
防止远端计划以合法参数长时间同步阻塞 Blender 主线程。

revision 6 使用 `resource_exists`、`material_assigned`、`armature_ready`、
`pose_animation_ready`、`render_scene_ready`、`render_rig_ready` 和
`render_artifact_exists` 七类 observation。25 个叶节点使用 Guide protocol `1.2.0` 的
`success_gate + rollback_step`：动作后只读评估一次，全部满足才进入 completed evidence；失败则
回传精确 observation、以 receipt 自动补偿并原位重试。外部 `retain_for_repair` Plan 会保留现场并
锁住 Next，Recheck 只重新观察而不重复 action；回滚冲突升级为 blocked 并保留 receipt。旧
`1.0.0`/`1.1.0` Plan 继续按 telemetry 执行。见 [ADR 0030](../adr/0030-observation-success-gates-and-recovery.md)。

## 非雪人规划基准

`protocol/fixtures/v1/planning/robot-preview.benchmark.json` 是首个版本化跨目标案例。它把“创建并
渲染一个友好风格机器人”绑定到历史 catalog `1.2.0`、目标所需阶段和完整参考 Plan，因此继续以
quality baseline `1.0.0` 作为精确 replay fixture，不携带 `1.3.0` coverage。该目标明确不需要
Animation，只使用 Geometry、Materials、Render setup 与 Output；六个叶子动作创建地面、批量
机器人部件、调色板、隔离渲染场景、灯光/相机和 320 × 320 PNG。

`tests/integration/blender/test_planning_benchmark.py` 在 Blender 4.5/5.1 中真实执行六步并逐步检查
逻辑资源和文件，然后从最后一步回退到起点，证明产物和所有 OperatingLine 自有 Blender 数据均被
清除。测试只删除精确匹配的工厂 Cube/Camera/Light 以建立隔离 fixture；这不改变 Extension 默认
Start 不删除用户场景内容的产品行为。此基准证明阶段画像和执行目录可以用于第二个题材，不证明
外部模型已能理解任意目标或评价造型审美。

## 与现有 Blender MCP 的边界

当前 `adapters/blender/bridge` 连接已安装 Blender MCP 扩展的回环 TCP transport，
默认使用 `127.0.0.1:9876` 和 NUL 结尾 JSON 帧。它不修改上游扩展，也不监听第二个
同端口服务。

Bridge 只允许调用 `bpy.ops.operating_line` 下的 `start`、`next`、`back` 和
`toggle_overlay`，并对回环地址、端口、超时和响应体积设限。这些限制只约束
OperatingLine 客户端；上游 transport 本身仍具有任意 Python 代码执行能力，因此不是安全沙箱，
不得暴露给非受信网络。长期方案是由专用 Companion transport 直接交换版本化命令和观察结果。

## 默认场景处理

`Start` 默认不删除现有对象。用户必须显式启用
`Delete factory Cube/Camera/Light on Start`，才授权 Extension 尝试清理启动三件套。
授权后仍要求当前 Scene 恰好只有这三个对象，并通过名称、类型、数据、变换、拓扑和常用参数
组成的保守指纹，才会原子性删除。Blender 没有暴露可靠的“工厂对象来源”标记，因此指纹只作为
额外拒绝条件，不能被描述为完整修改检测，也不能替代用户授权。
