# ADR 0002：Headless 核心与宿主原生 Companion

- 状态：已接受
- 日期：2026-08-04

## 决策

OperatingLine 采用“语言无关协议 + Headless Orchestrator + 每宿主原生 Companion”的结构。
Orchestrator 不拥有任何桌面 UI；Codex、Claude 和其他 MCP 客户端都是可替换的外部消费者。
任务树、引导线和操作控件由宿主 Companion 在目标软件内原生呈现。

## 驱动因素

1. 只有宿主扩展能稳定访问对象、视图变换、原生 undo 和应用主线程。
2. 跨软件复用来自协议与能力协商，不来自一套假定所有 UI 相同的屏幕自动化。
3. 计划、动作、观察、验证和回退记录必须能脱离任何 UI 运行，才能用于 replay 和 eval。

## 关键约束

- 展示模型是树，执行模型是有向无环依赖图。
- 持久化语义锚点；像素坐标只能是带布局指纹和有效期的临时解析结果。
- 每个 Companion 声明任务树、Overlay、交互锚点、执行、截图、回退、网络和线程模型能力。
- Blender 的所有 `bpy` 调用在主线程完成；绘制回调中不进行网络或重计算。
- 无法解析锚点或验证结果时暂停，不能盲点屏幕。

## 备选方案

- 独立桌面控制中心：增加安装和版本成本，且不能可靠绘制宿主内部引导，否决。
- 全局透明 Overlay：受窗口、DPI、布局、遮挡和视图变化影响，仅可作为降级能力。
- 修改 Blender Core：当前公共 Extension API 已覆盖 Panel、Operator、Overlay 和 Gizmo，成本不必要。

## 后果

- 第一交付物是可单独安装的 Blender Extension ZIP。
- 新软件通过新增 `adapters/<host>` 接入，不修改 Orchestrator 领域规则。
- 没有插件 API 的软件必须明确报告降级能力，不能假装提供精确锚点或可靠回退。
