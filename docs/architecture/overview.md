# 通用宿主架构

## 不变量

OperatingLine 的通用部分只定义意图、计划、状态和证据。宿主 Companion 负责把语义动作与
锚点翻译成 Blender Operator、VS Code Command、GIMP Procedure 等实际能力。
无界面 Orchestrator 是目标架构中唯一的计划与调度服务；当前实现只完成协议验证、计划发布、
事件记录和能力描述，实时调度链路仍在路线图中。MCP 客户端、CLI、Web 界面或其他第三方工具
都是可替换的协议消费者，不承担宿主内视觉呈现。

```text
GuidePlan
  ├─ presentation tree: parentId + order
  ├─ execution graph: dependsOn
  └─ executable leaf
       ├─ action(adapterId, name, arguments)
       ├─ semantic anchors
       ├─ expected observations
       └─ rollback policy
```

## 接入等级

| 等级     | 宿主条件                    | 可提供体验                                     |
| -------- | --------------------------- | ---------------------------------------------- |
| Native   | 官方插件/扩展 API           | 内部任务树、对象锚点、Overlay、原生动作与回退  |
| Assisted | 命令/API 可用但 UI 扩展有限 | 外部任务树、宿主命令、部分观察与回退           |
| Observed | 只有 Accessibility/视觉接口 | 屏幕提示与人工确认，不保证精确锚点或确定性回退 |

协议通过能力画像选择体验，规划器不得假设所有软件都有 Blender 等级的能力。

自动 action 只能位于结构叶子，并且其 `dependsOn` 只能指向其他自动 action。所有 Companion
按 DAG 拓扑顺序执行；`order` 和 `id` 只负责在多个 ready 节点之间提供跨语言稳定次序。
步骤 ID 限制为协议定义的可移植 ASCII 标识符，避免不同运行时的 Unicode 排序规则造成漂移。
actionless 叶子是说明或人工步骤，不会被自动执行器当作已经完成的依赖。

## 新宿主适配流程

1. 盘点官方插件 API、线程模型、命令目录、对象身份、观察和 undo/checkpoint。
2. 填写能力画像，明确 `native`、`emulated`、`unsupported`。
3. 实现稳定 action catalog；不暴露任意代码执行或任意文件路径。
4. 实现语义锚点解析与失败停止行为。
5. 运行通用 contract tests，再添加宿主 integration/e2e tests。
6. 只有公共 API 无法满足核心能力时，才向上游项目提出最小 API PR。

如果宿主已经有 MCP 或其他命令 transport，Companion 可以通过外部 `bridge/` 与其并存。
Bridge 必须把上游的宽泛能力收窄为允许列表命令，且不得将上游任意代码执行
宣称为 OperatingLine 的安全边界。

适配器起始约束见 [`adapters/README.md`](../../adapters/README.md)。
