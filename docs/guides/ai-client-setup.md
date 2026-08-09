# Codex、Claude 与 Claude Desktop 接入指南

OperatingLine 的推荐产品形态不是独立桌面窗口，而是：

```text
Codex / Claude Code ── Streamable HTTP ──┐
                                         ├─ OperatingLine Runtime ── Blender Companion
Claude Desktop ── stdio MCPB bridge ─────┘
```

AI 客户端负责理解目标和生成完整 GuideProposal；Runtime 负责精确上下文、严格验证、持久证据和实例
路由；Blender 负责树、数字、引导线、审批与显式执行。

## 1. 启动 Runtime

Token 至少 16 个字符。不要把真实 Token 提交到 Git：

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-random-token'
export OPERATINGLINE_PORT=43123
pnpm dev
```

外部 Codex/Claude 本身就是规划模型，因此使用 provider-free 的 `pnpm dev`。只有希望从 Blender 内逐次
授权调用 OpenAI Provider 时才使用 `pnpm dev:openai`。

## 2. 连接 Blender

1. 安装 `artifacts/blender/operating_line-0.1.0.zip`。
2. 打开 Blender `Edit → Preferences → System → Network → Allow Online Access`。
3. 在 `3D View → Sidebar → OperatingLine` 填写 Runtime URL `http://127.0.0.1:43123`。
4. 填写同一个 Bearer Token，然后点击 `Connect`。
5. 在 `Goal to Guidance` 输入目标并点击 `Create Guidance`。

## 3. 一键配置 Codex

确保启动 Codex 的 shell 中存在相同 Token：

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-random-token'
pnpm setup:codex
codex mcp get operating-line --json
```

安装器只保存 `bearer_token_env_var = "OPERATINGLINE_ACCESS_TOKEN"`，不保存 Token 值。Codex CLI、
Codex 本地桌面端和 IDE Extension 使用同一 Codex MCP 配置；从 Dock/Finder 启动的 GUI 若没有继承该
环境变量，需要在 Codex MCP 设置中配置 Bearer Token，或从已设置环境的进程启动。

## 4. 一键配置 Claude Code

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-random-token'
pnpm setup:claude
claude mcp get operating-line
```

默认使用 Claude `user` scope。配置 Header 是文字占位符
`Bearer ${OPERATINGLINE_ACCESS_TOKEN}`，Claude 连接时才从环境读取。可选择其他 scope：

```bash
pnpm setup:claude -- --claude-scope project
```

同时安装已存在的 Codex/Claude CLI：

```bash
pnpm setup:ai-clients
```

安装器不会覆盖已有 `operating-line`。确认要替换这个精确条目时才使用：

```bash
pnpm setup:ai-clients -- --force
```

预览命令且不读取或修改客户端配置：

```bash
pnpm setup:ai-clients -- --dry-run
```

## 5. 安装 Claude Desktop Extension

构建经过官方 MCPB Manifest 校验的本地包：

```bash
pnpm package:claude-desktop
```

生成 `artifacts/claude-desktop/operating-line-0.1.0.mcpb`。双击该文件，或在 Claude Desktop 使用
`Developer → Extensions → Install Extension`。安装时填写：

- Runtime URL：`http://127.0.0.1:43123/mcp`
- Bearer Token：与 Runtime/Blender 相同的 Token

该字段在 Manifest 中标记为 sensitive。包内没有 Token。当前开发包未签名，Claude Desktop 可能显示
本地未签名扩展提示；公开分发前必须补签名和干净机验证。

Claude Desktop 的 `Customize → Connectors` 属于云端远程 Connector，不能用于这个 localhost Runtime；
应安装 MCPB Desktop Extension。

## 6. 发起任务

Runtime 会通过 MCP initialization 自动告诉支持 instructions 的客户端正确顺序。仍可明确输入：

```text
使用 operating-line 处理 Blender 中最新的 pending goal。
读取精确 Goal packet，生成完整计划，调用 planning.evaluate 修复全部 error，
再通过 guide.propose 提交。不要调用 guide.publish，不要声称场景已经执行；等待我在 Blender 审批。
```

Proposal 到达后，在 Blender：

1. 检查完整树、节点编号、动作和参数；
2. `Accept Plan` 只安装计划；
3. `Start` / `Next` / `Back` 才改变场景；
4. 需要修改时点击节点 `Ref`，提交 Revision request，再让同一 AI 客户端处理 pending replan。

## 7. 当前边界

- 目前不从 Blender 自动启动 Codex/Claude；AI 客户端和 Runtime 分别启动。
- Web/云任务访问不到回环 Runtime。
- 当前 Blender ActionCatalog 只允许已验证动作；目录外工作必须保持 actionless/manual。
- MCPB 是连接器，不包含 Runtime 或 Blender，不扩大场景执行权限。
- 不自动选择 Planner Provider，不自动产生额外 API 费用。
