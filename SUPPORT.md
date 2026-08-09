# 支持说明

## 提交前先确认

请先查看 [README](README.md)、[`docs/`](docs/) 和现有 issue，并确认问题不是以下已知边界：

- Runtime 只监听本机回环地址；云端任务、Web 客户端和 Claude Desktop 的远程 Connector 不能直接
  访问 localhost。Codex/Claude Code 使用本地 HTTP MCP，Claude Desktop 使用本地 MCPB。
- 当前 Blender ActionCatalog 只覆盖仓库已经验证的动作与语义能力；接入 AI 客户端不等于已经支持
  任意 Blender 任务，也不会绕过 Blender 内 Proposal 审批和 Start/Next 执行门禁。
- Claude Desktop MCPB 可构建 unsigned、临时自签名开发包或外部证书驱动的生产签名包。仓库不提供
  受信任发布证书或私钥；自签名不建立公开信任。所有包都需要先单独启动 Runtime，并在安装时提供
  本地 URL 和 Token；包本身不包含 Runtime、Blender 或凭据。
- `pnpm dev:clients` 可在 Blender 逐次确认后调用已安装的 Codex/Claude CLI；它不能启动桌面 GUI，
  不会自动选择 Provider，且 CLI 的远程模型调用可能使用订阅或 API 额度。
- 未连接 Runtime 时 Blender Extension 使用打包内的雪人 fixture。用于兼容第三方 Blender MCP 的
  Bridge 只提供 `start`、`next`、`back` 和 `toggle_overlay` 四个受限控件；上游 transport 不是
  OperatingLine 的安全沙箱。

## 在哪里求助

- 可稳定复现的错误：使用 **Bug report** issue 表单。
- 新能力或行为建议：使用 **Feature request** issue 表单。
- 安全漏洞：不要创建公开 issue，按照[安全政策](SECURITY.md)私下报告。

当前没有单独的一般问答渠道。如果使用问题揭示了可复现缺陷或明确的功能缺口，请选择对应的
issue 表单，并提供你的目标、已阅读的文档、运行环境、尝试过的命令和完整错误信息。请删除
访问令牌、私有路径、项目文件和其他敏感数据。

本项目由社区按可用时间维护，不承诺响应时限、兼容性支持周期或一对一技术支持。信息完整、
范围明确且可以复现的问题更容易获得帮助。
