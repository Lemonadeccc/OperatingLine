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

网络/IPC 只接收紧凑命令并入队。`bpy`、任务状态更新和 Overlay 数据交换在 Blender 主线程
串行执行；绘制回调只读取缓存。Blender 官方不支持长期运行的 Python 后台线程，因此
companion transport 将采用外部进程或轻量 timer pump，不在绘制函数中阻塞。

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
