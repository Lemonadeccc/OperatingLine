# Blender Companion

## 是否需要修改 Blender

当前需求不需要给 Blender 仓库提 PR。Blender Extension 可以通过公开 API 注册：

- `Panel` / `UILayout`：Sidebar 任务树和 Start、Next、Back。
- `Panel` / `UILayout`：可折叠 Goal-to-Guidance 输入、异步请求状态和初始 Proposal 审批入口。
- `Panel` / `UILayout`：同一 Sidebar 内的 AI 提案摘要、只读树与 Accept/Reject。
- `Panel` / `UILayout`：可折叠 Revision Workspace，包含活动树/待审树节点 `Ref`、逐条移除、
  独立修订正文、Provider 选择/披露、异步 Run 状态、历史、Plan diff 与 Accept/Reject。
- `Operator` / 原生 dialog：每次 Provider Run 的明确确认；不保存长期 consent、模型或 Provider 凭据。
- `Operator`：宿主数据操作。当前演示使用自有 `Back` 补偿回退，不声明 Blender 原生 Undo，
  因为模块内会话状态尚未接入 `undo_post`/`redo_post` 重建。
- `SpaceView3D.draw_handler_add`：`POST_PIXEL` 步骤卡片、数字和引导线。
- `gpu` / `blf`：形状与文字绘制。
- `GizmoGroup`：后续需要可交互三维锚点时使用。

官方参考：[Creating Extensions](https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html)、
[SpaceView3D](https://docs.blender.org/api/current/bpy.types.SpaceView3D.html)、
[Panel](https://docs.blender.org/api/current/bpy.types.Panel.html)、
[GizmoGroup](https://docs.blender.org/api/current/bpy.types.GizmoGroup.html)。

## 需要上游 PR 的边界

只有以下诉求才考虑 Blender Core PR：新增原生 Editor/Space、公开 API 缺失、需要新的绘制或
事件阶段、需要 Blender 官方维护的持久异步运行时，或需要 Python 扩展无法实现的安全边界。

任意内置按钮的像素边界不是稳定协议。本项目优先标注自有 Panel 控件、对象、骨骼、材质节点
和世界坐标；对内置操作保存 `operatorId` 与可选 `menuPath`。当前版本在没有公开 UI 矩形时
显示语义路径与 `UI target unavailable`，不会绘制猜测坐标。未来只有版本专用 locator 通过
真实宿主测试后，才能把该类锚点升级为精确目标。

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

引导可见性属于 Blender 进程级 UI 状态，保存在带 `SKIP_SAVE` 的 `WindowManager` 属性中，
因此切换到 OperatingLine 隔离 Render Scene 不会错误地把 UI 显示成隐藏。`Hide Guidance`
移除 draw handler 并隐藏树与状态详情，但保留执行控件和 `Show Guidance` 恢复入口；步骤、receipt
与场景内容不随隐藏而改变。

## 主线程规则

当前 Companion 使用无 `bpy` 依赖的 Python 标准库网络线程，经鉴权向回环 Orchestrator 提交初始
GoalRequest，并短轮询 GuidePlan/GuideProposal、Provider descriptor 和异步 Replan Run 状态，再把
JSON 放入队列。
长达 120 秒的 Provider 调用运行在 Orchestrator 后台，不占用 Blender 的短请求线程。`bpy.app.timers` 在 Blender 主线程校验
提案、构建预览 Session、安装已接受计划、执行动作、回退并生成观察；绘制回调不访问网络、
不修改场景，只从当前会话派生最多四个相邻步骤，并为
Back/Next 解析已记录资源的屏幕锚点。

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
`blender + instanceId + ActionCatalog 1.3.0`、原始目标和一个新 Plan ID，不包含 Provider 或凭据。
提交在既有网络线程排队，主线程只显示 local、delivering、awaiting planner、proposal received 或
error；断线重试复用同一 payload 和 request ID。同一实例已有 active goal、revision request、Provider
Run 或待审 Proposal 时不能再提交。Runtime acknowledgement 只说明请求已持久化，外部 MCP 客户端仍须
显式 list → prompt.get → evaluate → guide.propose。

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
Reject。普通 UI Disconnect 只暂停网络并保留待审 Proposal、Goal 关联和活动修订草稿；Extension
unregister 才显式清理这些进程内状态。

活动树和待审树的每个节点都提供 `Ref`。引用以结构化行显示，不插入或篡改用户正文；重复点击
去重，每条可独立移除。同一草稿最多引用 8 个节点，且不能混合两个 Plan 基线；尝试引用其他
基线会显式失败，保留当前引用和正文，需用户先 `Clear Draft`。发送时 Companion 把完整 base Plan、
稳定节点 ID、当时的树编号、
打包目录版本和消息放入后台队列。请求确认或暂时失败只更新 UI 状态，不调用 `bpy` 场景 API。
Orchestrator 返回的请求关联 Proposal 必须带当前 `instanceId`，Blender 在主线程再次核对后才建立
只读预览。Protocol `1.1.0` 的 Proposal 还必须带线性 thread 元数据和 Plan diff；Panel 在 Accept 前
显示 `+ / - / ~ / moved`、变化节点、字段和可紧凑表示的 action 参数前后值。接受请求关联 Proposal
后，新的 active-plan 引用会继承 `threadId`、递增 turn 并把上一 request 作为 parent。Revision Workspace
明确称为修订操作日志，而不是 Chat，因为当前没有自动 provider 选择/调用或流式回复。点击
`Send Request` 只进入认证的后台队列，不执行 Blender action。Runtime acknowledgement 后，工作区可列出
严格公开的 replan Provider descriptor，但默认保持未选择；不可用项只显示原因。选择远端 Provider 后，
界面明确说明将发送修订消息、完整 base Plan/引用、ActionCatalog 与最新 Companion 状态，且调用可能
产生费用、OperatingLine 无法估价。`Confirm Provider Run` 使用 Blender 原生 dialog 逐次确认；重试显示
`Confirm New Provider Run`。Provider、
request 改变、断开、终态或 Retry 都不会沿用先前确认。

确认后 transport 只发送一个短 POST，并轮询版本化 Run 状态。Run 的 queued/generating/needs_revision/
failed/interrupted 状态只更新应用/UI 状态；`proposal_created` 仍通过既有 Companion delivery 建立只读
preview。同一实例已有活动 Run 或未决 Proposal 时 Runtime 拒绝新 Run；失败/重启后的 Retry 使用新 UUID
并再次确认，不自动重复可能已计费的调用。Blender 不保存 Provider API Key、模型或 endpoint。Run、
Proposal preview 和 Reject 不修改活动 Session 或场景；Accept 只替换空闲 Session，`Next` 才执行第一个
action。默认 provider-free Runtime 显示空列表，外部 MCP planner 路径不受影响。

`queued/generating` 期间，Sidebar 禁用第二次 Send Request、Provider refresh 和并发 Proposal decision，
但保留草稿编辑、历史、既有计划与 walkthrough 控件。Controller 和 handoff state 都执行相同门禁；活动
Run 的 revision/generation identity 不会被普通 Plan/Proposal 投递或重复 ACK 清除。只有精确 pending ACK
能首次绑定，精确重复是 no-op；非活动状态安装新 Plan 会使旧 request context 失效，因此晚到 ACK 不能
把过期请求重新变成可运行状态。

Proposal delivery 可能早于或晚于 terminal status。Companion 使用有界的复合键候选集隔离这些消息，
只显示 status 指定的 `(revisionRequestId, proposalId)`；错误 request、同 ID poisoning 或后到的无关
Proposal 不得覆盖 Provider Proposal。队列满只显示本地错误，不自动发送 Reject。Request-linked Proposal
的 Accept 还会把 diff base 与当前 active Session 精确比较，漂移时保持 Proposal、场景、Session 和证据
不变。没有可验证 `planDiff.basePlan` 的旧版 request-linked Proposal 仍能查看和 Reject，但 Accept 在 UI
与 Controller 两层 fail closed。

后台 transport 还会读取当前 thread 的
最新历史页；主线程验证 request/proposal/diff/decision 关系并在 Sidebar 显示最近三轮。用户可展开
全部已加载轮次，或通过 `Load Older Turns` 使用 `beforeTurn` 继续向前分页。历史是只读审查事实，
不会调用场景 API。折叠 Revision Workspace 或使用 `Hide Guidance` 都不会丢失草稿、Run、历史、执行进度或场景状态。

## revision 4 雪人执行切片

打包内的 `snowman-demo` revision 4 是当前 Blender Companion 的确定性验收场景。它按线性 DAG
执行 7 个阶段、15 个叶子步骤：创建地面和三段身体，批量创建脸部、纽扣和手臂，分配雪、煤、
胡萝卜、木头和地面材质，创建四骨骼 Armature 并把头部组件与两条手臂刚性绑定，写入第 1、20、40
帧姿态，创建隔离的 Scene、World 与自有 Collection，加入两个 Area Light 和一台 Camera，
最后在扩展管理的临时目录生成帧 20 的 320 × 320 Eevee PNG。

当前动作目录 `1.3.0` 允许以下 10 类 action，把它们完整划分到 Geometry、Materials、Animation、
Render setup 和 Output 五个有序规划阶段，并保留不可变 `1.0.0`、`1.1.0`、`1.2.0` 供精确回放：

- `blender.mesh.create_plane`
- `blender.mesh.create_uv_sphere`
- `blender.mesh.create_primitive_batch`
- `blender.material.create_and_assign`
- `blender.material.create_palette_and_assign`
- `blender.rig.create_armature`
- `blender.animation.create_pose_keyframes`
- `blender.render_scene.create`
- `blender.render_rig.create`
- `blender.render.execute_preview`

`1.3.0` 还发布七项适配器自有 `semanticCapabilities`：ground plane、primitive assembly、Principled
material palette、rigid armature、rigid pose keyframes、render scene setup 和 PNG preview output。
Capability-aware Planning/Replanning Packet `1.1.0` 要求 provider 把每条具体需求映射到这些稳定能力，
再映射到 action 属于该能力的可执行叶子；局部重规划只能引用规范化引用子树内的叶子。缺失、未知、
action 不匹配或范围外的映射使 quality baseline `1.1.0` 失败并返回 `needs_revision`，不会产生
Proposal。历史目录继续使用 packet/baseline `1.0.0` 回放。

该 coverage 随 planning-quality 事件进入 Eval，不进入 Blender GuideProposal 信封，也不改变
Revision Workspace、Accept/Reject 或 `Start`/`Next`。它只证明 provider 声明可追溯到真实目录动作，
不证明需求抽取、参数语义或最终视觉结果正确。完整决策见
[ADR 0017](../adr/0017-catalog-grounded-goal-coverage.md)。

注册表按步骤 ID 绑定 action，而不是假设 action 名唯一。一个步骤的 receipt 可以同时记录多个
Blender datablock、mutation 和渲染产物；资源解析同时核对 pointer、receipt token、logical ID、
步骤 ID 和 action 名。复合动作先对整批对象、数据和逻辑 ID 做预检，执行异常时补偿已经创建或
修改的部分。回退 mutation 前执行 compare-and-restore：当前值不再等于该动作写入的值时拒绝
覆盖，并保留当前步骤和 receipt。`Next`/`Back` 因而可以完成 15 步正向执行与完整反向补偿，
但这种补偿不是 Blender 原生 Undo。

回退前会一次性检查当前 receipt 的全部资源。自有 Mesh/Light/Camera/Armature data 存在额外
用户、Material 或 Action 被计划外对象使用、Object 被链接到计划外 Collection，或自有
Collection/Scene 增加了未跟踪内容时，回退以零写入失败并保留 receipt 与步骤索引；用户解除
冲突后可以原地重试。扩展在同一 Blender 进程内被禁用时也不会因为该冲突而卸载失败或丢弃
receipt。模块重载后仍不会仅凭可复制标签接管旧资源。

骨架 action 只接受 1–32 个具名骨骼和 1–64 个既有自有对象绑定；父骨引用必须存在且无环，
绑定目标必须未被父级占用。当前使用 rigid bone parenting，不做权重绘制或网格变形，并在绑定时
保留对象世界矩阵。动画 action 只接受 2–64 个严格递增帧和范围在 ±2π 内的 Euler 旋转，创建
一个自有 Action 后写入 pose keyframe。失败补偿会先解除 Action，再恢复 pose 与父子关系，最后
删除自有 Action、Armature object 和 data；不会调用任意 Python 或任意 Blender operator。

隔离渲染 Scene 只链接 OperatingLine 自有 Collection。默认启动文件中的 Cube、Camera 和 Light
既不会被删除，也不会进入该渲染 Scene；创建的相机和两盏 Area Light 只属于这次执行记录。
为了历史 Plan/receipt 精确回放，目录中的集合逻辑 ID 仍为 `snowman.collection`，但用户可见的
Blender Collection 名称已经是目标无关的 `OperatingLine Generated`。
预览 action 只接受扩展临时目录、1–100000 的显式帧，单边分辨率上限为 1024，采样上限为 128，
防止远端计划以合法参数长时间同步阻塞 Blender 主线程。

revision 4 使用 `resource_exists`、`material_assigned`、`armature_ready`、
`pose_animation_ready`、`render_scene_ready`、`render_rig_ready` 和
`render_artifact_exists` 七类 observation。它们读取 receipt 身份与当前 Blender 状态，并随
Companion report 回传；在协议 `0.1.0` 中仍是遥测，不是
`step_succeeded` 的提交门，也不会因 `satisfied: false` 自动回退 action。

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
