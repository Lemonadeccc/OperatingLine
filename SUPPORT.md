# 支持说明

## 提交前先确认

请先查看 [README](README.md)、[`docs/`](docs/) 和现有 issue，并确认问题不是以下已知边界：

- 实时 Orchestrator ↔ Blender 配对、计划投递、执行队列和观察回传尚未打通。
- Blender Extension 当前使用打包内的雪人 fixture；Bridge 只提供 `start`、`next`、`back` 和
  `toggle_overlay` 四个受限控件。
- Bridge 所连接的第三方 Blender MCP transport 不是 OperatingLine 的安全沙箱。

## 在哪里求助

- 可稳定复现的错误：使用 **Bug report** issue 表单。
- 新能力或行为建议：使用 **Feature request** issue 表单。
- 安全漏洞：不要创建公开 issue，按照[安全政策](SECURITY.md)私下报告。

当前没有单独的一般问答渠道。如果使用问题揭示了可复现缺陷或明确的功能缺口，请选择对应的
issue 表单，并提供你的目标、已阅读的文档、运行环境、尝试过的命令和完整错误信息。请删除
访问令牌、私有路径、项目文件和其他敏感数据。

本项目由社区按可用时间维护，不承诺响应时限、兼容性支持周期或一对一技术支持。信息完整、
范围明确且可以复现的问题更容易获得帮助。
