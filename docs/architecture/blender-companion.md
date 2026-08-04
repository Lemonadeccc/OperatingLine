# Blender Companion

## 是否需要修改 Blender

当前需求不需要给 Blender 仓库提 PR。Blender Extension 可以通过公开 API 注册：

- `Panel` / `UILayout`：Sidebar 任务树和 Start、Next、Back。
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
和世界坐标；对内置操作保存 `operator_id` 与菜单路径，由 Companion 在当前版本解析。

## 主线程规则

当前 Companion 使用无 `bpy` 依赖的 Python 标准库网络线程，经鉴权从回环 Orchestrator
短轮询 GuidePlan，并把 JSON 放入队列。`bpy.app.timers` 在 Blender 主线程安装计划、执行动作、
回退、生成观察和更新 Overlay 缓存；绘制回调只读取缓存，不进行网络或重计算。

网络请求有总时限、4 MiB 响应上限，并绕过系统代理且不跟随重定向。Disconnect/Extension
卸载只做短暂等待；残余清理线程为 daemon、保留到确认退出且不访问 `bpy`。Blender manifest
声明 network 权限，UI 同时检查 `bpy.app.online_access`；URL 仅接受 `http` 回环地址，Token
使用 WindowManager `SKIP_SAVE` 属性，不写入 `.blend`。

运行中收到新计划不会触发场景回退。若当前会话仍持有 action receipt，更新会暂存并只报告
一次 pending/error；用户 Back 到起点后由主线程自动安装。Disconnect 会取消 pending 更新。

## revision 2 雪人执行切片

打包内的 `snowman-demo` revision 2 是当前 Blender Companion 的确定性验收场景。它按线性 DAG
执行 6 个阶段、13 个叶子步骤：创建地面和三段身体，批量创建脸部、纽扣和手臂，分配雪、煤、
胡萝卜、木头和地面材质，创建隔离的 Scene、World 与自有 Collection，加入两个 Area Light
和一台 Camera，最后在扩展管理的临时目录生成 320 × 320 Eevee PNG。

动作目录允许以下 8 类 action：

- `blender.mesh.create_plane`
- `blender.mesh.create_uv_sphere`
- `blender.mesh.create_primitive_batch`
- `blender.material.create_and_assign`
- `blender.material.create_palette_and_assign`
- `blender.render_scene.create`
- `blender.render_rig.create`
- `blender.render.execute_preview`

注册表按步骤 ID 绑定 action，而不是假设 action 名唯一。一个步骤的 receipt 可以同时记录多个
Blender datablock、mutation 和渲染产物；资源解析同时核对 pointer、receipt token、logical ID、
步骤 ID 和 action 名。复合动作先对整批对象、数据和逻辑 ID 做预检，执行异常时补偿已经创建或
修改的部分。回退 mutation 前执行 compare-and-restore：当前值不再等于该动作写入的值时拒绝
覆盖，并保留当前步骤和 receipt。`Next`/`Back` 因而可以完成 13 步正向执行与完整反向补偿，
但这种补偿不是 Blender 原生 Undo。

回退前会一次性检查当前 receipt 的全部资源。自有 Mesh/Light/Camera data 存在额外用户、Material
被计划外对象使用、Object 被链接到计划外 Collection，或自有 Collection/Scene 增加了未跟踪
内容时，回退以零写入失败并保留 receipt 与步骤索引；用户解除冲突后可以原地重试。扩展在同一
Blender 进程内被禁用时也不会因为该冲突而卸载失败或丢弃 receipt。模块重载后仍不会仅凭可复制
标签接管旧资源。

隔离渲染 Scene 只链接 OperatingLine 自有 Collection。默认启动文件中的 Cube、Camera 和 Light
既不会被删除，也不会进入该渲染 Scene；创建的相机和两盏 Area Light 只属于这次执行记录。
预览 action 只接受扩展临时目录，单边分辨率上限为 1024，采样上限为 128，防止远端计划以合法
参数长时间同步阻塞 Blender 主线程。

revision 2 新增 `resource_exists`、`material_assigned`、`render_scene_ready`、
`render_rig_ready` 和 `render_artifact_exists` 五类 observation。它们读取 receipt 身份与当前
Blender 状态，并随 Companion report 回传；在协议 `0.1.0` 中仍是遥测，不是
`step_succeeded` 的提交门，也不会因 `satisfied: false` 自动回退 action。

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
