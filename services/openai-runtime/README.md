# `@operatingline/openai-runtime`

这是一个显式启用 OpenAI Planner Provider 的独立 composition root。默认的
`@operatingline/orchestrator` standalone 仍然不导入厂商 SDK、不读取模型凭据，也不会自动选择
provider。

## 启动

复制仓库根目录 `.env.example` 为被 Git 忽略的 `.env` 并填写，或把同名变量导出到 shell 环境，
然后执行：

```bash
pnpm dev:openai
```

运行脚本使用 Node.js 24 内置的 `--env-file-if-exists` 显式读取仓库根 `.env`，不引入额外的 dotenv
依赖；已有 shell 环境变量也会正常生效。

必须显式设置：

- `OPERATINGLINE_ACCESS_TOKEN`：本地 MCP/HTTP 接口访问令牌，至少 16 个字符。
- `OPENAI_API_KEY`：只由本运行入口传给 OpenAI Provider，不进入协议、事件或公开 descriptor。
- `OPERATINGLINE_OPENAI_MODEL`：明确的模型 ID；项目不会静默选择或升级模型。

可选设置：

- `OPERATINGLINE_DATABASE_PATH`：默认 `.data/operating-line-openai.db`。
- `OPERATINGLINE_PORT`：默认 `0`，由系统选择空闲回环端口。

运行后先调用 `operatingline.planner.providers.list` 查看数据传输声明，再显式选择返回的
`providerId` 调用 `operatingline.planner.generate`。生成结果始终是未经信任但已由核心验证的草案，
不会创建 Proposal 或操作 Blender；调用方仍需单独提交 `operatingline.guide.propose`，随后由宿主
用户接受或拒绝。
