# ADR 0023：本机 CLI Planner 与 MCP 2026-07-28 兼容

## 状态

已接受。

## 背景

OperatingLine 已有两条规划路径：外部 MCP Host 自行消费 Planner Packet，以及显式注入 Runtime 的
`PlannerProvider`。前者适合 Codex/Claude 桌面端或 CLI 中由用户发起任务，但不能让用户完全留在
Blender；后者已经具备 Blender 内 Provider 选择、数据/费用披露、逐次确认、异步状态和 Proposal 审批，
却只有直接调用 OpenAI API 的参考实现。

与此同时，MCP 稳定规范已更新到 `2026-07-28`。新版以 `server/discover` 和逐请求 `_meta` 替代旧版
`initialize` 会话，并保留客户端协商回退。项目的 HTTP Runtime 已由 MCP SDK 2.0 提供双时代服务，
但 Claude Desktop 的 stdio bridge 仍显式采用旧版默认握手。

## 决策

### 1. CLI 作为可选 PlannerProvider，而不是新的 Blender 特例

新增 `@operatingline/cli-planner-provider`，提供 Codex CLI 和 Claude Code CLI 两个 provider。新增
`services/cli-runtime` 作为唯一装配点，并由 `pnpm dev:clients` 启动。默认 `pnpm dev` 继续保持
provider-free，不探测 CLI、不读取模型配置，也不启动模型进程。

Blender 不直接拼接命令行。它复用已有 Initial Plan Run 与 Replan Run：用户选择公开 descriptor，阅读
会发送的目标、宿主状态、ActionCatalog、可能费用与凭据归属，原生确认一次 Run；Runtime 才把精确
`renderedPrompt` 通过 stdin 交给对应 CLI。CLI 返回的 JSON 仍经过 packet identity、严格 Schema、目录、
coverage、quality/locality 门禁。只有 ready 结果可成为待审 Proposal；Accept 只安装，`Start` / `Next`
才执行 Blender action。

### 2. 子进程采用最小权限与短生命周期

- Codex 使用临时空目录、`--ephemeral`、`--sandbox read-only`、`--ignore-user-config`、
  `--ignore-rules`，并让 shell tool 不继承环境变量；禁止危险 bypass 参数。
- Claude 使用 `--print`、`--safe-mode`、空 tools、`dontAsk`、无 session persistence 和明确的每次运行
  预算上限；禁止 skip-permissions。
- 两者只从 stdin 接收 packet，不把目标放入命令参数；OperatingLine Token 和 MCPB 签名变量不会传给
  子进程。CLI 自己管理登录、模型服务和费用。
- 输出有字节上限，只接受 JSON；退出码、超时、取消、无输出和非法 JSON 均变成不含 provider 原文的
  安全错误。失败后不会自动重试可能已计费的调用。

Codex/Claude 桌面 GUI 没有稳定的本机 headless 调用 API，因此它们继续使用 ADR 0022 的外部 MCP Host
路径：用户在 GUI 中发起任务，GUI 连接 Runtime。Blender 内一键 Run 只承诺已安装且可执行的 CLI。

### 3. stdio bridge 自动协商现代协议并兼容旧客户端

bridge 到 HTTP Runtime 的官方 MCP Client 使用 `versionNegotiation: { mode: "auto" }`；对下游则使用
官方 `serveStdio`，由 SDK 根据首个 `server/discover` 或 `initialize` 选择现代或旧版实例。现代连接
协商为 `2026-07-28` 并自动附加 `_meta`；旧客户端仍可使用 2025 初始化流程。项目当前没有需要
Sampling、Roots、Elicitation 或 Tasks 的业务流程，因此不为“追新”增加无使用者的协议能力。

### 4. MCPB 签名区分开发证明与生产信任

`package:claude-desktop:dev-signed` 在临时目录创建自签名证书，使用官方 `mcpb sign` 签名并以 OpenSSL
验证 detached CMS 签名与原始内容绑定，只用于 CI 和
本地验证签名链路；临时私钥随后删除，自签名不等于公开可信。

`package:claude-desktop:signed` 要求外部提供 `MCPB_SIGN_CERT_PATH` 与 `MCPB_SIGN_KEY_PATH`，可选提供
intermediate chain。私钥文件在 POSIX 上必须仅当前用户可读。脚本从不生成或提交生产私钥，先复制
未签名包，在临时目录签名并由 OpenSSL 验证 CMS 和系统信任链后再原子发布 signed artifact。MCPB
2.1.2 自带的 `verify` 当前调用 node-forge 尚未实现的 PKCS#7 verify，因此会把刚签好的包误报为
unsigned；项目明确记录该上游限制，不伪造官方 verify 通过。取得受信任证书、发行权限和费用
授权仍是发布者的外部凭据边界。

## 后果

- 用户可完全留在 Blender 中逐次授权本机 Codex/Claude CLI 生成初始计划或局部重规划；
- 这不是自动选择模型、后台自治执行或绕过 Proposal 审批；
- CLI 可能使用订阅或 API 额度，OperatingLine 只能披露并限制 Claude 的单次预算，不能替 Codex 估价；
- 外部 MCP Host、CLI Provider 和 OpenAI API Provider 共用同一 Planner Packet 与验证核心；
- 现代与旧版 MCP 客户端都可经 HTTP 或 Claude Desktop stdio bridge 接入；
- 仓库可以证明开发签名流程，但不声称提交了受 CA/商店信任的发布证书。

## 验证

- CLI 参数、stdin、环境隔离、JSON 解析、错误清洗、取消和不可用状态单元测试；
- composition root 配置与默认 provider-free 打包边界测试；
- 真实 Runtime 上游和真实 stdio 子进程下游均协商 `2026-07-28` 的集成测试；
- 官方 MCPB `validate`、`pack`、`sign`，以及 OpenSSL detached CMS 内容/信任链验证；
- 全仓 lint、typecheck、tests、Schema、格式和生产依赖审计。
