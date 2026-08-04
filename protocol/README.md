# OperatingLine Protocol

这里存放供所有语言和宿主软件消费的公开协议产物。TypeScript 绑定位于
`packages/protocol`，发布前由其生成 JSON Schema；Blender/Python 和未来的软件
适配器只依赖版本化 Schema 与 fixtures，不依赖 Orchestrator 的实现语言或任何客户端。

`protocol/fixtures` 是示例计划的唯一编辑源。Blender 构建和测试脚本会把离线所需 fixture
同步到 Extension resources，并通过集成测试校验内容一致，禁止手工维护两份不同计划。

`protocol/schemas/v1/companion-*` 定义通用 Companion 的计划/提案拉取与状态报告格式；
`guide-proposal-*` 定义 AI 提案、服务端信封和宿主决策。它们与 GuidePlan Schema 一样由
`packages/protocol` 生成；任何宿主不得自行增加未版本化字段。

`action-catalog.schema.json` 定义宿主发布的版本化允许动作目录；`planning-context.schema.json`
定义 Orchestrator 交给模型客户端的目录、目标、revision 提示、Companion 状态和计划约束组合。
目录规范数据由适配器拥有，例如 Blender 位于
`adapters/blender/catalog/v1/action-catalog.json`，不放进通用协议包硬编码。

`guide-revision-request.schema.json` 定义宿主创建的不可变节点修订请求；
`guide-replan-submission.schema.json` 定义 MCP 客户端针对该请求提交的完整新版计划。请求保存精确
ActionCatalog 版本、完整 base Plan、稳定节点 ID 和当时的显示编号，而不是只保存易漂移的自由文本。

## 版本规则

- `protocolVersion` 使用语义化版本。
- Major 不兼容时必须拒绝连接，不能静默降级。
- 屏幕像素坐标不是持久协议字段；适配器在运行时解析语义锚点。
- 树形父子关系用于呈现和引用，`dependsOn` 用于执行调度。
- 步骤 ID 使用 `[A-Za-z0-9][A-Za-z0-9._:-]*`；ASCII 序关系保证不同语言的稳定排序一致。
- 同一 Plan ID 的 `revision` 必须严格递增；切换到其他计划后也不能重新发布旧 revision。
- AI 计划使用 `GuideProposal` 信封投递；接收和校验不等于接受，只有宿主内显式
  `accepted` 决策才能把它安装为活动计划。`rejected` 不得修改宿主场景或活动计划。
- Proposal 决策以 `proposalId + adapterId + instanceId` 唯一；同一实例的同值重试幂等，
  相反决策是 conflict。其他实例仍可独立审查同一提案。
- 修订请求以 `requestId` 幂等；相同 ID 的不同 payload 是 conflict。引用的 `nodeId + nodeNumber`
  必须与请求携带的完整 base Plan 一致。
- 请求关联重规划必须使用同一 Plan ID、请求绑定的精确 `catalogVersion` 和严格更高 revision；返回的
  Proposal 带 `targetInstanceId`，只投递给发起请求的 Companion。
- AI 在生成可执行步骤前应读取目标宿主的精确 ActionCatalog/PlanningContext。Proposal 的动作名、
  顶层参数、anchor、observation 和 rollback 必须属于该目录；宿主仍对嵌套参数和实际资源执行
  最终校验。
- Companion protocol v1 的单个 GuidePlan 中，所有非空 action 必须使用同一 `adapterId`；
  混合宿主计划必须拒绝，不能通过删减步骤破坏树、依赖、编号或 revision 语义。
- 没有 action 的计划缺少宿主路由信息，当前可发布和查询，但不会投递给 Companion。
- Companion 身份使用 `adapterId + instanceId`；同一身份的 `sequence` 必须严格递增。
- 同 `reportId` 只有完整 payload 一致时才是幂等重试；内容变化是 conflict，不是 stale。

重新生成协议：

```bash
pnpm schema:generate
pnpm schema:check
```
