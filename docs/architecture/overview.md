# 通用宿主架构

## 不变量

OperatingLine 的通用部分只定义意图、计划、状态和证据。宿主 Companion 负责把语义动作与
锚点翻译成 Blender Operator、VS Code Command、GIMP Procedure 等实际能力。
无界面 Orchestrator 是架构中唯一的计划与调度服务；当前实现已经完成协议验证、计划发布、
经鉴权的回环 Companion 拉取、幂等状态回传、事件/最新快照持久化和能力描述。MCP 客户端、
CLI、Web 界面或其他第三方工具都是可替换的协议消费者，不承担宿主内视觉呈现。

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

Companion protocol v1 以单宿主计划为投递单位：一个 GuidePlan 的所有非空 action 必须使用
同一个 `adapterId`。Orchestrator 在发布时拒绝混合宿主计划，不临时过滤步骤；否则会破坏
`parentId`、`dependsOn`、编号和 revision 的整体语义。纯 actionless 计划没有宿主路由信息，
当前只保存为已发布计划，不进入 Companion 投递链路。跨宿主投影与协调需要后续协议设计。

## Companion 同步契约

首个 transport 使用经 Bearer Token 鉴权的回环 HTTP 短轮询：Companion 以
`adapterId + instanceId` 标识实例，使用成对的 `knownPlanId + knownRevision` 拉取更新，并以
唯一 `reportId`、单实例递增 `sequence` 回传状态。Orchestrator 将精确重试识别为 duplicate，
拒绝旧 sequence，并把同 reportId 的不同内容识别为 conflict。

列表接口表示“最新已知状态”，不等同于实时在线证明；当前版本还没有 heartbeat/TTL。
Transport、线程和 UI 规则由各宿主实现，但不得改变以下不变量：

- 计划投递本身不执行 action，也不删除宿主数据。
- 宿主 API 调用只能发生在宿主允许的线程/事件阶段。
- 动作目录必须是允许列表，不能把任意代码执行包装成通用 action。
- 非法计划、过期或冲突状态必须显式失败。
- 离线能力与网络能力分开声明，断线不能破坏已安装的本地计划。

`0.1.0` 的 observation 是执行后的遥测：`satisfied: false` 会被原样回传，但尚不改变
`step_succeeded` transition，也不触发自动补偿。它不能被规划器或 eval 当作已验证成功；
动作结果与观察判定、补偿策略的分离仍属于下一阶段。

## 宿主执行记录与补偿

Companion 应按步骤 ID 保存 action receipt，不能把 action 名当作唯一键；一个计划可以在多个
步骤复用同一种通用 action。receipt 可以包含多个新建宿主资源、对既有自有资源的 mutation、
文件产物和用于视觉定位的锚点。Blender revision 3 实现使用 pointer、不可预测 receipt token
和 logical ID 的组合身份，并额外核对步骤 ID 与 action 名；名称只用于显示和冲突预检，不构成
删除授权。

多资源动作应先验证整批参数、名称、逻辑 ID 和依赖资源，再开始写入。宿主 API 在预检后仍可能
失败，因此执行器还必须记录已产生的副作用并进行失败补偿。mutation 回退采用
compare-and-restore：只有当前值仍等于该动作写入的值时才恢复旧值；检测到外部修改时显式拒绝，
避免静默覆盖用户或其他工具的后续操作。

这是 Blender Companion 当前的补偿实现，不是所有宿主已经具备的通用能力。其他适配器必须在
能力画像中分别声明批量预检、精确身份、失败补偿和冲突检测的支持等级。

当前 HTTP 决策与升级边界见 [ADR 0003](../adr/0003-loopback-companion-polling.md)。

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
