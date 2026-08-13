# ADR 0040: Companion 会话租约与能力协商

## 状态

已接受。

## 背景

此前 Runtime 只保存每个 `adapterId + instanceId` 的最新 Companion 状态。Guide 轮询可以证明某次
HTTP 请求成功，却不能证明某个历史状态仍在线；Blender 也会在网络线程启动后、首次成功通信前显示
Connected。持久化快照因此同时承担了审计记录和在线发现两种互相冲突的语义。

## 决策

新增独立的 Companion Session `1.0.0` 契约，不修改 Guide/Companion `1.5.0` 的历史消息：

1. Companion 先向 `POST /api/v1/companion/session` 声明实例身份、Companion/宿主版本、支持的 Guide
   协议版本、ActionCatalog 版本和 `AdapterCapabilities`。
2. Runtime 只对已安装且身份完全匹配的 ActionCatalog 建立会话。Session 字段允许客户端声明历史和
   未来版本以便后续演进，但 Phase 0 没有消息降级投影，因此客户端必须支持并协商 Runtime 当前 Guide
   `1.5.0`；只支持旧版时明确拒绝，不能给 1.5 payload 套上旧版外壳。服务端返回随机 `leaseId`、协商
   结果、5 秒心跳间隔和 15 秒 TTL。
3. Companion 每个心跳周期向 `POST /api/v1/companion/heartbeat` 发送严格递增序列。重复的最后一次
   心跳幂等；更旧序列、错误实例、已被新会话替代或过期的租约均拒绝。服务端使用单调时钟判断
   存活，`expiresAt` 只是供观察的墙钟时间，系统时钟跳变不会延长或提前终止租约。
4. 新版 Guide 轮询和状态报告携带 `x-operatingline-companion-lease`。状态报告的 Companion 版本、宿主
   版本及协议版本必须与会话一致。Blender 只有在握手成功后才显示 Connected。
5. `/api/v1/companions`、MCP `operatingline.companions.list` 和规划/重规划上下文只返回仍有有效 presence
   的持久化状态。租约过期不会删除历史状态；后续合法通信可重新使对应快照可见。
6. Phase 0 默认保留旧 Companion 的有界兼容：无 lease 的合法 Guide 请求可以继续轮询，但只有合法
   状态报告才建立同 TTL 的隐式 presence，避免只读查询复活历史快照。部署可用
   `companionLeases.allowLegacyCompanions: false` 或部署环境变量
   `OPERATINGLINE_ALLOW_LEGACY_COMPANIONS=false` 关闭该路径。携带 lease 的客户端永远走严格校验，
   不会降级为旧路径；同一 Runtime 进程内，曾成功协商的实例即使租约过期也不能回退到隐式
   presence。

能力协商复用现有 `AdapterCapabilities`，细粒度可执行能力仍以精确 ActionCatalog 为权威。当前 Runtime
验证非空目录不能声明 action invocation 为 unsupported，且目录要求的 rollback modes 必须被 coarse
profile 覆盖；通过后回显并绑定 Companion 的其余声明。这是受目录约束的能力 attestation，不是从
目录反推出 native/emulated 实现，也不把 coarse profile 替代为任意动作权限。

Phase 0 lease 的范围仅是 Guide/state 通道的 transport presence 协调。其他 Companion mutation 仍由
Runtime bearer 与各自 payload 校验保护；lease 不是全 Companion API 的独占授权令牌。心跳只证明后台
网络线程能完成往返，不证明 Blender 主线程、场景或动作执行器已经就绪。

## 后果

- 在线状态成为可过期的运行时事实，历史快照继续是耐久审计事实。
- Runtime 重启会使租约失效；Companion 自动重新握手，不需要持久化 bearer-like lease token。
- 同一实例的新握手立即替代旧 lease，避免两个网络线程同时代表同一实例。
- Blender 在 Runtime 不可用时对 Session 重试采用有界退避，避免本地故障形成紧密重连循环。
- Phase 0 兼容路径仍不能提供完整能力协商证明；生产式严格部署应关闭该路径，未来主版本可移除。
- 该协议只覆盖当前 Blender Companion。接入第二宿主仍需提供真实目录、能力画像和宿主集成验证。

## 验证

契约测试覆盖严格字段、未来版本声明和 TTL 关系；租约单元测试覆盖协商、续租、幂等、过期、替代与
旧版开关；Orchestrator 集成测试覆盖 HTTP 鉴权、错误 lease、身份漂移和在线列表失效；Blender 4.5/5.1
测试覆盖真实网络线程的握手、lease header、心跳及握手后 Connected 状态。
