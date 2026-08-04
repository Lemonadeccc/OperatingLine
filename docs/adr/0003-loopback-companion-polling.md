# ADR 0003：回环 HTTP Companion 同步

- 状态：已接受
- 日期：2026-08-04

## 决策

OperatingLine 的首个实时 Companion 链路采用经 Bearer Token 鉴权的回环 HTTP 短轮询。
Blender Extension 主动连接只监听 `127.0.0.1` 的 Orchestrator，拉取新 GuidePlan，并把
当前会话快照作为版本化状态报告回传。后续新增的 GuideProposal 与人工决策复用同一短轮询和
后台线程边界，其审批语义由 [ADR 0004](0004-human-approved-guide-proposals.md) 单独定义。

```text
MCP client
    │ publish GuidePlan
    ▼
Orchestrator on 127.0.0.1
    ▲                      │
    │ state report         │ plan poll
    │                      ▼
Blender network thread ── queue ── bpy.app.timers main-thread pump
                                      │
                                      ▼
                               Session / Operators / Overlay
```

网络线程只处理 HTTP 与 JSON，不读取或修改任何 `bpy` 数据。计划安装、动作执行、回退、
任务状态和 UI 更新全部由 `bpy.app.timers` 驱动的主线程泵串行完成。Panel 与 Overlay 仍然
只读取缓存状态。

## 协议边界

- Companion 使用 `adapterId + instanceId` 复合标识自身；不同适配器不得因 UUID 相同而
  覆盖彼此的快照。
- 已知计划由 `planId + revision` 成对表示；没有更新时 Orchestrator 返回空投递。
- v1 以单宿主 GuidePlan 为投递单位；所有非空 action 必须使用同一 `adapterId`。混合宿主
  计划在发布阶段拒绝，不能临时删减为可能破坏树、依赖、编号和 revision 的子计划。
- 状态报告使用唯一 `reportId` 与单实例递增 `sequence`。完全相同的精确重试是幂等的；
  同一 `reportId` 携带不同内容会返回冲突，旧序列不会覆盖较新的状态。
- Orchestrator 同时保存追加式状态事件和每个实例的最新快照，供 MCP、HTTP、replay 和
  后续 eval 使用。
- Blender 只接受其允许列表能够解释的动作。计划验证或动作目录解析失败时保留当前会话，
  并回传显式错误，不进行部分安装。

## 安全与权限

- Orchestrator 继续只监听回环地址；Companion 拒绝非回环 URL。
- MCP 与 Companion API 使用同一个最小 16 字符 Bearer Token。
- Token 只保存在 Blender 当前运行时的非项目属性中，不写入 `.blend` 文件。
- Blender Extension 在 manifest 中声明网络权限，并尊重 Blender 的 Online Access 设置。
- 此链路不复用现有 Blender MCP 的任意 Python 执行入口；过渡性 Bridge 仍保持独立，
  只允许调用 OperatingLine 自有控件。

## 为什么先使用短轮询

短轮询只依赖 Node.js、Fastify 和 Blender 自带 Python 标准库，安装包不需要附带 WebSocket
或 SSE 客户端。请求有明确超时，断线后可以独立重试，并且 Blender 始终是出站连接方。
当前计划更新频率远低于建模帧率，短轮询的额外延迟和请求成本可以接受。

未选择的方案：

- **WebSocket**：双向语义自然，但会引入 Blender 端第三方依赖、心跳和重连状态机。
- **SSE**：适合单向计划推送，但状态回传仍需 HTTP，且长连接关闭与 Extension 重载更复杂。
- **直接调用现有 Blender MCP TCP transport**：可以触发控件，但其上游入口可执行任意
  Python，不能成为 OperatingLine 的专用安全边界。
- **在绘制或 Operator 中同步请求**：会阻塞 Blender UI，违反宿主主线程约束。

## 后果与演进

Blender 在未连接 Orchestrator 时继续使用打包内置计划，避免网络故障破坏离线演示。连接
必须由用户显式发起；卸载或重载 Extension 时会停止线程并注销 timer。

未来在计划规模、更新频率或多宿主调度需要持续连接时，可以在保持 GuidePlan 与状态报告
Schema 不变的前提下，把 transport 升级为 SSE 或 WebSocket。传输升级不得改变主线程队列、
动作允许列表、幂等报告和失败停止这些不变量。
