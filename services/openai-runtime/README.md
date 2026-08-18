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
- `OPERATINGLINE_ALLOW_LEGACY_COMPANIONS`：默认 `true`；设为严格的 `false` 后，拒绝未先建立可续租
  Session 的旧版 Companion。只接受精确值 `true` 或 `false`。

## 调用顺序

初始规划：

1. 调用 `operatingline.planner.providers.list`，检查远端传输、凭据管理、可用性和并发声明。
2. 使用返回的 `providerId` 和一个新 UUID `requestId` 调用 `operatingline.planner.generate`。
3. 检查 `status` 与 `planningQuality`。当前 Blender `1.22.0` 使用 Planning Packet `1.1.0` 和 quality baseline
   `1.1.0`；草案必须把每条具体需求通过 `planning.capabilityCoverage` 映射到 catalog capability 和
   action 匹配的可执行叶子。历史目录继续使用 packet/baseline `1.0.0`。该结果固定
   `proposalCreated: false`。
4. 只有确定要送入宿主审查时，才把草案显式提交给 `operatingline.guide.propose`。

自然语言 ProcedureTree 编写：

1. 调用 `operatingline.procedure.authoring.providers.list` 检查相同 Provider 披露；可先调用不触发模型的
   `operatingline.procedure.prompt.get` 查看精确 packet。
2. 用新 UUID `requestId`、Provider ID、tree ID/revision、目标与可选目录版本调用
   `operatingline.procedure.authoring.generate`。
3. Runtime 将完整 packet 规范编码后发送，返回 candidate 立即经过 identity、installed catalog 与 compile
   门。成功也不自动 store、materialize、propose 或执行；用户审阅后必须分别显式调用后续入口。

HTTP 对应入口为 `GET /api/v1/procedure/authoring/providers` 与
`POST /api/v1/procedure/authoring/generate`。

节点局部重规划：

1. 用户先在 Blender 中提交带节点 `Ref` 的 Revision request；调用
   `operatingline.replan.requests.list` 取得其 `requestId`。
2. 调用 `operatingline.replan.providers.list` 并检查同一 provider 披露；可先用
   `operatingline.replan.prompt.get` 查看不会触发模型调用的类型化 packet。
3. 用一个不同于 revision request ID 的新 UUID 作为 generation `requestId`，连同
   `revisionRequestId + providerId` 调用 `operatingline.replan.generate`。
4. 只有结果为 `ready` 且 `planningQuality.valid`、`locality.valid` 均为 true 时，才把返回的 canonical
   `draft` 原样映射到 `operatingline.replan.propose`，并额外传入
   `generationRequestId: <generation requestId>`。任何编辑或过期 revision 都会被拒绝。
   Capability-aware replan 的 coverage 还只能引用规范化引用子树内的可执行叶子。
5. Proposal 仍只进入发起 Blender 实例的只读审查；宿主用户 Accept 后才会安装，之后仍需用户执行
   `Start`/`Next` 才会修改场景。

HTTP 对应入口依次为 `GET /api/v1/replan/providers`、`POST /api/v1/replan/prompt`、
`POST /api/v1/replan/generate` 和 `POST /api/v1/replan/propose`。所有 MCP/HTTP 请求都需要本地 Bearer
Token。

| 操作                   | 可能调用 OpenAI/计费 | 创建 Proposal | 安装或执行计划 |
| ---------------------- | -------------------- | ------------- | -------------- |
| `replan.prompt.get`    | 否                   | 否            | 否             |
| `replan.generate`      | 是                   | 否            | 否             |
| `replan.propose`       | 否                   | 是            | 否             |
| Blender Accept         | 否                   | 审批既有提案  | 只安装         |
| Blender `Start`/`Next` | 否                   | 否            | 用户显式执行   |

成功生成的严格草案、coverage、quality/locality 报告和 provenance 会进入未自动脱敏的 Eval 证据。
缺失、未知、action 不匹配或局部范围外的 coverage 会产生 `needs_revision`，不会创建 Proposal。
确定性校验只证明 Schema、identity、目录、引用子树范围、coverage 可追溯性和当前结构质量规则成立，
不产生语义分数，不自动选择 provider，也不证明 OpenAI 已正确理解任意目标或修订消息。Proposal 审批和
`Start`/`Next` 场景执行边界保持不变。完整决策见
[ADR 0017](../../docs/adr/0017-catalog-grounded-goal-coverage.md)。
Procedure authoring 边界见
[ADR 0070](../../docs/adr/0070-explicit-procedure-authoring-provider.md)。
