# Host Adapters

每个目录代表一个宿主软件的原生 Companion。适配器可以使用不同语言和构建系统，但必须消费
`protocol/schemas`，发布版本与能力画像，并通过 `tests/contract` 的公共契约。

建议结构：

```text
adapters/<host>/
├── extension/               宿主内安装包
│   ├── domain/              宿主局部纯规则
│   ├── application/         命令、队列、状态协调
│   ├── infrastructure/      宿主 API、checkpoint
│   └── presentation/        panel、overlay、gizmo
└── bridge/                  可选的外部 MCP/API transport
```

不得把宿主 API 类型泄漏到 `packages/domain`，也不得用固定屏幕坐标替代语义锚点。新适配器
首先复制 `_template/capabilities.example.json`，逐项确认能力和限制。

`bridge/` 只负责连接已有宿主 transport，不是安全沙箱。它必须默认限制在回环地址、
校验消息大小与超时，并只暴露明确允许的 Companion 命令。不得将任意代码执行作为
OperatingLine 的公开能力。
