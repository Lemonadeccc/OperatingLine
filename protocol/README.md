# OperatingLine Protocol

这里存放供所有语言和宿主软件消费的公开协议产物。TypeScript 绑定位于
`packages/protocol`，发布前由其生成 JSON Schema；Blender/Python 和未来的软件
适配器只依赖版本化 Schema 与 fixtures，不依赖 Orchestrator 的实现语言或任何客户端。

`protocol/fixtures` 是示例计划的唯一编辑源。Blender 构建和测试脚本会把离线所需 fixture
同步到 Extension resources，并通过集成测试校验内容一致，禁止手工维护两份不同计划。

## 版本规则

- `protocolVersion` 使用语义化版本。
- Major 不兼容时必须拒绝连接，不能静默降级。
- 屏幕像素坐标不是持久协议字段；适配器在运行时解析语义锚点。
- 树形父子关系用于呈现和引用，`dependsOn` 用于执行调度。
- 步骤 ID 使用 `[A-Za-z0-9][A-Za-z0-9._:-]*`；ASCII 序关系保证不同语言的稳定排序一致。
- 同一 Plan ID 的 `revision` 必须严格递增；切换到其他计划后也不能重新发布旧 revision。

重新生成协议：

```bash
pnpm schema:generate
pnpm schema:check
```
