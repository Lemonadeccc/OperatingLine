# ADR 0115：有界 UV Sphere execution-track v2 执行器

- 状态：Accepted
- 日期：2026-08-24
- 部分取代：[ADR 0104](0104-reviewed-execution-track-override.md) 的“执行边界”章节

## 背景

ADR 0104 定义了经审查 `executionTrackOverride` 的表达和授权链，但当时刻意不提供逐控件执行器：公开
`Next`、通用 action-level MCP 和独立 execution-track MCP 都在宿主 mutation 前 fail closed。该限制仍适用于
公开 `Next`、通用 action delivery 和未受管的 Blender 功能；现在需要为一条已经冻结并审查的 UV Sphere
menu/control 轨迹提供可恢复、可证明的专用执行路径，而不能把轨迹数据升级成任意宿主控制权。

## 决策

`operatingline.blender.execution-track.execute` 只接受 execution-track v2 的严格 binding，并只授权固定 executor
`blender.uv_sphere_menu_proven_managed_commit.v2`。它绑定精确 target、document incarnation、Plan revision、
leaf、Action/Interaction Catalog、review、track、proof execution、起始 Companion report 与原生 Undo
checkpoint。公开 `Next` 和通用 `operatingline.blender.action.execute` 继续拒绝带 override 的 leaf；本决策不允许
客户端提交任意 operator、控件、坐标、快捷键或 Python。

执行分为以下不可跳过的阶段：

1. Companion 证明当前 report、session、document lease、原生 start checkpoint、Scene fingerprint 和对象身份域
   与 binding 完全一致，并在确认 delivery 前持久化 v2 outbox。
2. 专用 proof driver 以前台事件模拟执行固定七个 UI operation：`Layout` workspace、`Add`、`Mesh`、
   `UV Sphere`、Location、Scale 和 Object Name。每项生成有序、哈希链接的 receipt；实际宿主变化由八个
   native mutation stage 表示：创建球体、三个 Location 分量、三个 Scale 分量和名称。
3. proof 成功后保持锁定并记录强 `uv_sphere_menu_controls_ready` Observation、proof checkpoint、八层 native
   history cursor 和 proof terminal marker。此时尚未执行 managed action，也没有 managed receipt。
4. Companion 执行八次精确 native Undo；每次都记录 cursor、前后 Scene fingerprint 与连续 transition hash。
   只有最终 fingerprint 和所有 identity domain 都回到 baseline，才写入 `baseline_restored`。
5. Companion 移除 proof marker、执行原生 Undo push，并验证 Redo poll 为 false，以此建立不能重新进入 proof
   mutation 的 Redo barrier；随后持久化唯一 commit intent。
6. Companion 提交 managed-start，等待 Runtime 对同一 lease、commit intent、baseline 和 proof evidence 的 ACK。
   只有 token 授权的内部路径可以绕过公开 Next 锁，并且只执行一次 allowlisted
   `blender.mesh.create_uv_sphere` managed action。
7. 终态必须包含 `uv_sphere_ready` 强 Observation、唯一 managed receipt、原生 managed checkpoint、精确
   Companion report、result 与 Scene 内 terminal marker。任一项不一致都不能报告成功。

## Lease 与并发边界

所有 proof、restore、barrier、managed-start 和 terminal 边界都重验同一个 session/target/document identity。
长时间 UI proof 通过唯一 Companion network thread 请求 heartbeat；主线程等待刷新结果时释放 GIL。后续 progress
只能绑定同一 authority、过期时间单调不减的 current lease。旧 lease、不同 document incarnation、重连后的陈旧
delivery 或无法及时刷新 lease 都会停止执行，不会借用当前线程或隐式网络调用继续 mutation。

## 持久化与恢复

每个可观察阶段先原子更新 Scene outbox，再向 Runtime 发送。重启或 ACK 丢失时禁止自动重放 proof、Undo 或
managed action，只允许 replacement lease 发起 `read_only_reconcile`：

- baseline 已终止时返回精确 `baseline_terminal` evidence；
- mutation 阶段无法确定时返回 `unresolved_current_state`、`recovery_required` 并保留 target lock；
- managed terminal 已持久化时返回精确 `persisted_managed_terminal` evidence，而不重发 action；
- `failed_managed` 只有在 retained terminal、repair authority、恢复 report、Observation 与 checkpoint 全部匹配时
  才能进入单次 repair 对账。

Recovery ACK 本身先持久化；进程再次启动只重发该精确 ACK。Runtime 确认后才清理已完成的成功 outbox；状态不明
或 managed failure 不会因为重启而释放锁。

## 结果与边界

- UV Sphere 轨迹现在具有真实 UI receipt、native Undo baseline proof、Redo barrier、单次 managed commit、强
  Observation 和 durable recovery 的端到端证据。
- Blender 4.5.3 LTS 与 5.1.1 的真实 Companion E2E 都必须通过相同协议断言。
- ADR 0104 的 override 表达、人工审查和通用 fail-closed 边界保持不变；本 ADR 只取代其中“专用 MCP 仍然只是
  `failed_no_mutation` 能力探测”的历史执行边界。
- 这不是全 Blender 逐控件 executor。其他 primitive、Edit Mode、Modifier、Geometry Nodes socket、骨骼、
  动画、快捷键和复合叶节点仍须分别冻结轨迹、实现执行器并取得同等级别的真实 E2E 证据。
