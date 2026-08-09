# ADR 0022：本地 AI 客户端分发与 MCP 传输桥

## 状态

已接受。

## 背景

OperatingLine 已经提供经 Bearer Token 鉴权的回环 Streamable HTTP MCP endpoint，Codex CLI、
Claude Code 和其他本地 MCP Host 可以直接连接。但是，手工复制 URL/Header 容易出错，模型也不能只靠
二十多个独立 Tool description 稳定推导 `goal list → exact packet → evaluate → propose → host review`
的完整权限流程。Claude Desktop 普通聊天使用的远程 Connector 从 Anthropic 云端发起连接，不能访问
`127.0.0.1`；其本地 Desktop Extension 则要求 MCPB 内提供 stdio server。

本里程碑不把 Runtime 暴露到公网，不引入 OAuth，不自动启动 Blender，不让 AI 绕过宿主审批，也不把
整个 OperatingLine Runtime 复制进每一种客户端分发物。

## 决策

### 1. 直接支持本地 HTTP MCP Host

Codex 和 Claude Code 继续直接连接 `http://127.0.0.1:<port>/mcp`。仓库提供类型化安装器：

- Codex 使用 `codex mcp add --url ... --bearer-token-env-var ...`；
- Claude Code 使用 `claude mcp add-json`，Header 保存为环境变量占位符，而不是 Token 值；
- 默认只新增缺失的 `operating-line` 条目；已有条目保持不动，只有显式 `--force` 才删除并重建同名条目；
- `--dry-run` 不探测或修改任何客户端配置。

### 2. 用连接握手 instructions 承载跨客户端工作流

Orchestrator 在现代 `server/discover` 或旧版 `initialize` 握手中发布供应商无关 instructions。前 512
字符自包含地声明：连接不
等于执行授权、宿主 Goal 的确定顺序、禁止把不可信模型输出交给 `guide.publish`，以及 Proposal 只进入
Blender 审批。后续段落覆盖 Provider 费用披露、局部重规划、精确身份保持和目录外能力降级。

这比 Codex/Claude 专属 system prompt 更可靠：任何支持 MCP server instructions 的 Host 都能获得同一
契约；现有 `operatingline.plan_and_propose` Prompt 继续作为用户可显式选择的模板。

### 3. Claude Desktop 使用薄 MCPB stdio bridge

`OperatingLine.mcpb` 只打包一个通用 `@operatingline/mcp-stdio-bridge`：

1. Claude Desktop 通过 stdio 启动它；
2. bridge 从 MCPB `user_config` 接收 loopback URL 和 sensitive Token；
3. bridge 使用官方 MCP Client 自动协商 `2026-07-28`，并用官方 `serveStdio` 同时兼容新版
   `server/discover` 与旧版 `initialize` 客户端；
4. Tool/Prompt/Resource discovery 和调用透明转发，不复制 OperatingLine Schema；
5. bridge 继承 Runtime instructions，不自行放宽工作流；
6. URL 运行时再次限制为 `http`、精确 loopback host、无 credentials/query/fragment、精确 `/mcp`。

Token 不进入源码、命令参数、Manifest、构建日志或 `.mcpb`。MCPB 安装界面负责敏感配置输入。包内
同时携带项目 Apache-2.0 License、第三方 notices 和 MCP SDK 上游许可证；构建保留 dependency legal
comments。仓库提供临时自签名的开发验证和外部证书驱动的生产签名流程；不提交生产私钥，也不把
自签名描述为公开可信。CLI Provider 与现代 MCP 的后续决策见 ADR 0023。

## 选择依据

- OperatingLine Runtime 和 Blender Companion 本来就在同一台机器，公开远程 Connector 没有收益；
- 复用 Runtime Tool Schema，避免 Client 分发物与协议版本漂移；
- 保持 Codex、Claude 和未来 MCP Host 的工作流一致；
- 安装便利性不能扩大网络边界或场景执行权限；
- Desktop Extension 失败时只影响该客户端连接，不影响 Blender 离线计划。

## 被否决方案

- **把 Runtime 直接暴露公网供桌面端远程 Connector 使用**：当前只有本地静态 Bearer Token，没有
  HTTPS/OAuth、租户隔离和公网威胁模型。
- **在 MCPB 中复制全部 OperatingLine Tools**：Schema、Prompt 和权限说明会形成第二套权威实现。
- **MCPB 自动启动 Blender 或整个开发仓库**：扩大进程权限、生命周期和跨平台依赖，且安装包不再是
  可审计的薄连接器。
- **把 Token 写入 Codex/Claude 配置命令**：命令历史和配置文件会持久化秘密；改用环境变量引用或
  MCPB sensitive user config。
- **为每个 AI 客户端维护独立工作流 Prompt**：容易产生权限和版本差异；连接握手 instructions 为权威，
  客户端专属说明只解释安装方式。

## 后果

- Codex CLI、Claude Code 和 Codex 本地桌面会话可复用同一个 loopback Runtime；
- Claude Desktop 可通过 `.mcpb` 一键安装本地连接器；
- Runtime 仍需独立启动，Blender 仍需安装 Extension 并连接；
- GUI 启动的 Codex 进程若不继承 shell 环境，需要在其 MCP 设置中提供同名 Token 环境或显式配置；
- Claude/ChatGPT Web、云任务和远程 Connector 仍不能访问 localhost；
- 当前 bridge 转发 OperatingLine 已使用的 Tool、Prompt 和 Resource 能力，不宣称代理任意 MCP 扩展能力。

## 验证

- 安装命令构建、幂等、`--force` 和 `--dry-run` 单元测试；
- URL/Token 边界单元测试；
- 官方 MCPB CLI Manifest 校验、真实 pack/sign 与独立 CMS 验证；
- 真实 Runtime ↔ HTTP MCP Client ↔ stdio Server ↔ Claude-style Client 跨传输集成测试；
- MCP instructions、Tool 调用和 Prompt discovery 端到端断言；
- 全仓 lint、typecheck、tests、Schema 与格式门禁。
