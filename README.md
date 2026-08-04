# OperatingLine

[![CI](https://github.com/Lemonadeccc/OperatingLine/actions/workflows/ci.yml/badge.svg)](https://github.com/Lemonadeccc/OperatingLine/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> 当前阶段：`0.1.0` 垂直切片。Blender 内引导与本地 Orchestrator ↔ Companion
> 计划投递/状态回传闭环已可运行；内置计划可完成并回退一张确定性的雪人渲染预览。
> 通用 AI 自动规划、节点聊天、训练/Eval 和第二宿主仍在路线图中。

OperatingLine 是一套面向 AI/MCP 软件操作的可观察引导协议与宿主适配框架。

## 问题与价值

当 AI 通过 MCP 操作 Blender 等复杂软件时，用户往往只看到最终结果：不知道 AI 当前在做什么、
为什么这样做、操作了哪个对象，也难以定位需要修改的步骤。

OperatingLine 把高层目标拆成可引用的任务树，再把可执行叶子节点绑定到语义动作、
宿主内锚点、完成验证和回退策略。用户可以看到当前步骤，按顺序前进或回退，并用
`1.2.1` 这样的编号精确引用某个节点。

OperatingLine 不在目标软件外叠加透明窗口。任务树、引导线和操作控件由每个宿主的原生
Companion/Extension 在软件内呈现；无界面 Orchestrator 负责协议验证、计划发布、
本地 Companion 投递、状态查询、事件记录和能力描述。

## 真实可运行能力

- **Headless Orchestrator**：提供经鉴权的 MCP/HTTP 接口，可验证和发布 GuidePlan、投递给
  本地 Companion、查询最新执行状态，并把追加式事件与每个实例的最新快照写入本地数据库。
- **版本化协议**：定义 GuidePlan、树/DAG、语义锚点、动作绑定和能力画像，并生成
  JSON Schema 与跨语言 fixture。
- **Blender Extension**：在 3D View Sidebar 显示任务树，支持展开/折叠、Start/Next/Back、
  Overlay 开关、当前步骤卡片和视口引导线；可显式连接回环地址上的 Orchestrator，非阻塞
  拉取新计划并回传步骤结果。
- **完整雪人预览垂直切片**：内置 revision 2 计划包含 6 个阶段、13 个可执行步骤，依次完成
  地面、三段身体、脸部、纽扣、手臂、材质、隔离渲染场景、双 Area Light、相机和
  320 × 320 Eevee PNG；`Back` 可以逐步反向补偿整条执行链。
- **Blender MCP Bridge**：可以不修改已安装的 Blender MCP 扩展，仅通过允许列表命令
  触发 OperatingLine 控件。

Blender Extension 已在 Blender 4.5.3 LTS 和 5.1.1 中通过无界面集成测试。

![OperatingLine 在 Blender 内的任务树、控制按钮、步骤卡片与雪人预览](docs/assets/blender-guidance.png)

> [!IMPORTANT]
> 当前完成的是内置 GuidePlan 驱动的确定性雪人预览，不是“AI 已能自动完成任意 Blender
> 任务”。通用 AI 自动拆解、节点聊天引用、Eval/训练导出、骨骼动画和第二宿主尚未完成。
> 未连接 Orchestrator 时，Extension 继续使用打包内的雪人 fixture；Bridge 仍只是受限控件
> 调用的过渡方案，不参与新的专用 Companion 同步链路。

## 工作原理

```text
Codex / Claude / another MCP client
                 │ MCP
                 ▼
services/orchestrator
计划验证 · Companion 投递 · 状态/事件记录 · 能力描述
                 │ authenticated loopback HTTP
                 │ plan pull / state report
        ┌────────┴─────────┐
        ▼                  ▼
adapters/blender      adapters/<host>
native extension      native companion
        │                  │
        ▼                  ▼
     Blender          another application
```

`protocol/` 是跨语言交换格式，`packages/protocol` 是 TypeScript 绑定与 Schema 生成器。
任务树的 `parentId + order` 负责展示和编号，`dependsOn` 形成实际执行 DAG。每个叶子节点
可包含动作名、经校验的参数、语义锚点、预期观察和回退方式。

Blender 当前允许 8 类通用 action：创建平面、创建 UV 球、批量创建基础体、创建并分配单个
材质、创建并分配材质组、创建隔离渲染场景、创建灯光相机组，以及生成受限临时目录中的渲染
预览。动作注册表按步骤 ID 绑定执行器；同一种 action 可以安全地出现在多个步骤中。

每个步骤的 action receipt 可以记录多个新建 datablock、对既有自有资源的 mutation 和文件
产物。资源身份同时校验 Blender pointer、不可预测 receipt token 和计划内 logical ID，避免
仅凭名称或可复制属性删除对象。复合动作先检查整批名称与逻辑 ID 冲突；执行中途失败会补偿
已经产生的部分结果。回退 mutation 前还会比较当前值与动作完成后的记录值，发现用户或其他
工具已经修改时拒绝覆盖。若自有 Mesh、Material 或 Collection 已被外部对象引用，`Back` 会在
零写入预检阶段停止并保留步骤收据；解除外部引用后可以重试，不会静默留下失管资源。

自动动作只允许绑定在结构叶子上，并且只能依赖其他自动动作；Companion 必须按
`dependsOn` 的拓扑顺序执行，`order` 只作为同时可执行节点的稳定排序条件。没有 action 的
叶子保留给说明、人工确认或未来规划，不会被当前自动执行器悄悄视为已完成。
步骤 ID 使用协议限定的可移植 ASCII 格式，保证 TypeScript、Python 和未来其他适配器的
并列步骤排序一致。

Companion protocol v1 的一个 GuidePlan 内，所有非空 action 必须使用同一个 `adapterId`。
当前 Orchestrator 会在发布阶段显式拒绝混合宿主计划，而不会把必然无法安装的完整计划投递给
某一个宿主。跨宿主计划需要另外设计保持树、依赖、编号和 revision 语义的投影/调度协议；
纯 actionless 计划因缺少宿主路由信息，当前只可发布和查询，不会由 Companion 接口投递。

Companion 负责把这些通用定义翻译成宿主的 Operator、Command 或 Procedure，并在宿主内
解析对象、世界坐标或自有控件等稳定锚点。持久协议不使用易受窗口、DPI 和布局变化影响的
固定像素坐标。

Blender Companion 的网络线程只交换 HTTP/JSON，并把新计划放入队列；`bpy.app.timers`
在 Blender 主线程安装计划、执行动作和更新 UI。状态报告通过 `reportId + sequence` 实现
精确重试、乱序拒绝和最新快照恢复。计划投递本身不会删除已经创建的场景对象：运行中收到
新 revision 时会暂存更新，等用户 Back 到起点后再安装。

## 5 分钟快速开始

前置要求：Node.js 24、Corepack、pnpm，以及 Blender 4.5+。

```bash
git clone https://github.com/Lemonadeccc/OperatingLine.git
cd OperatingLine
corepack enable
pnpm install
pnpm package:blender
```

如果 Blender 不在平台默认路径，显式指定可执行文件：

```bash
BLENDER_BIN=/absolute/path/to/blender pnpm package:blender
```

打包产物为 `artifacts/blender/operating_line-0.1.0.zip`。在 Blender 中选择
`Edit → Preferences → Extensions → Install from Disk`，安装并启用该 ZIP。

这条快速开始可以直接运行 Blender Extension 内置雪人计划，不需要先启动 Orchestrator。

### 连接实时 Orchestrator

使用固定回环端口启动 Orchestrator；Token 至少 16 个字符，并应由当前用户自行生成：

```bash
export OPERATINGLINE_ACCESS_TOKEN='replace-with-a-local-secret-token'
export OPERATINGLINE_PORT=43123
pnpm dev
```

然后在 Blender 的 `OperatingLine` Sidebar 中：

1. 确认 `Edit → Preferences → System → Network → Allow Online Access` 已开启。
2. `Runtime URL` 填写 `http://127.0.0.1:43123`。
3. `Bearer token` 填写同一个 Token；该字段使用 `SKIP_SAVE`，不会写入 `.blend`。
4. 点击 `Connect`。连接成功后，Extension 会保留当前离线计划，并只拉取 ID/revision 更新的计划。
5. 把 Codex、Claude 或其他 MCP Client 连接到 `http://127.0.0.1:43123/mcp`，调用
   `operatingline.guide.publish` 发布 GuidePlan。

计划安装、Start/Next/Back 和步骤观察可以通过
`operatingline.companions.list` 或 `GET /api/v1/companions` 查询。所有 `/mcp` 和 `/api/`
请求都需要 `Authorization: Bearer <token>`；服务与 Blender Companion 都拒绝非回环地址。
当前查询返回的是每个 `adapterId + instanceId` 的最新已知快照，不是带心跳或超时判定的在线
状态；关闭 Blender 后，最后一条快照仍会保留，直到未来引入租约/心跳机制。

## Blender 内交互

在 3D View 中按 `N`，打开 `OperatingLine` 页签：

1. `Start` 重置演示会话、展示 Overlay，并将计划置于第一个可执行步骤之前。
2. `Next` 按 13 个步骤依次创建地面、模型与细节，分配雪/煤/胡萝卜/木头/地面材质，建立
   隔离 Scene、World、双 Area Light 和 Camera，最后生成 320 × 320 Eevee PNG。
3. `Back` 回退当前步骤；连续回退可以删除渲染产物并补偿全部 13 步，不删除用户对象。
4. `Toggle Overlay` 显示或隐藏当前步骤卡片和视口引导。
5. 任务树分支可以独立展开或折叠，当前叶子节点会显示活动状态。
6. `Connect`/`Disconnect` 控制本地实时 Companion；Disconnect 会取消尚未安装的远端计划。

默认情况下 `Start` 不删除任何现有对象。只在用户显式勾选
`Delete factory Cube/Camera/Light on Start` 后，Extension 才会尝试清理启动场景；即便已经授权，
也只有场景恰好包含通过保守工厂指纹检查的三件套时才会原子性删除。Blender 不提供这些对象的
可信来源标记，因此显式开关才是删除授权，指纹检查只是额外保护，不能代替授权。

当前回退 receipt 只在本次 Extension 会话内有效，并以步骤 ID 保存该步产生的多个资源、mutation
和文件产物。保存重开或扩展重载后，OperatingLine 不会仅凭可复制的自定义属性接管或删除旧对象；
遇到同名残留时会停止并要求用户明确处理，避免误删用户复制或修改过的内容。若资源在执行后被
外部修改，compare-and-restore 检查会拒绝用旧值覆盖该修改，并保留 receipt 供用户处理冲突。

revision 2 使用 `resource_exists`、`material_assigned`、`render_scene_ready`、
`render_rig_ready` 和 `render_artifact_exists` 五类新增 observation 检查资源、材质、场景、
灯光相机和 PNG 产物。协议 `0.1.0` 仍把 observation 作为执行后遥测：不满足的观察会回传，
但不会把 action 的 `step_succeeded` 自动改判为失败，也不会触发自动补偿。

运行中收到更高 revision 时，Extension 不会因为“收到计划”而自动回退场景。更新会显示为
pending，用户 Back 到起点后才会安装；Disconnect 会取消该 pending 更新。非法协议版本、
非允许列表动作、非回环 URL、超大响应和过期/冲突状态报告都会显式失败。

## 与现有 Blender MCP 并存

`adapters/blender/bridge` 是过渡性外部客户端。它连接已安装 Blender MCP 扩展在回环地址
上开启的 TCP transport（默认 `127.0.0.1:9876`），不修改该扩展，也不启动第二个同端口服务。

OperatingLine Bridge 只允许 `start`、`next`、`back` 和 `toggle_overlay` 四个控件，
并强制限制回环地址、端口范围、总请求时限和响应大小。但是，当前上游 MCP transport 本身
接受 Python 代码，因此 Bridge 不是安全沙箱，不应对非受信网络开放该端口。

## 如何适配其他开源软件

跨软件复用的是协议和契约，不是 Blender 代码。新宿主从 `adapters/<host>` 接入：

1. 盘点宿主的官方扩展 API、主线程规则、命令目录、对象身份和 undo/checkpoint 能力。
2. 从 `adapters/_template/capabilities.example.json` 建立能力画像，把每项能力声明为
   `native`、`emulated` 或 `unsupported`。
3. 实现允许列表 action catalog；不对外暴露任意代码执行或任意文件路径。
4. 把通用语义锚点解析为宿主对象、命令、节点或自有面板控件；解析失败时停止而不是盲目点击。
5. 用宿主原生面板、Overlay 或类似扩展点呈现任务树和引导；没有扩展 API 时如实降级。
6. 运行 `tests/contract` 的通用契约测试，再补充宿主集成测试和端到端验收场景。

宿主分为三级：有官方扩展 API 的 **Native**、有命令/API 但 UI 扩展受限的 **Assisted**、
只有 Accessibility/视觉接口的 **Observed**。降级宿主不得伪装拥有精确锚点或确定性回退。
详见 [通用宿主架构](docs/architecture/overview.md) 和 [适配器约定](adapters/README.md)。

## 为何无需 Blender PR，什么时候需要

当前功能不需要向 Blender Core 提交 PR。Blender 公开 Extension API 已能注册：

- `Panel` / `UILayout`：Sidebar 任务树和控制按钮。
- `Operator`：宿主数据操作；当前雪人垂直切片使用受控 `Back` 补偿回退，不接入 Blender
  原生 Undo 栈，避免 Python 会话状态与 ID datablock 撤销状态脱节。
- `SpaceView3D.draw_handler_add`：`POST_PIXEL` 卡片、数字和引导线。
- `gpu` / `blf`：形状与文字绘制。
- `GizmoGroup`：后续可交互三维锚点。

只有需要新的原生 Editor/Space、公开 API 中缺失的绘制或事件阶段、Blender 官方维护的
持久异步运行时，或 Python Extension 无法提供的安全边界时，才考虑最小化上游 PR。

详见 [Blender Companion](docs/architecture/blender-companion.md)。

## 开发与测试

安装依赖后执行完整的 TypeScript/Node.js 质量检查：

```bash
pnpm check
```

这会依次运行 ESLint、TypeScript 类型检查、Vitest、协议 Schema 漂移检查和 Prettier 格式检查。

运行 Blender Extension 集成测试并构建安装包：

```bash
pnpm test:blender
pnpm test:blender:companion
pnpm test:blender:visual
pnpm package:blender
```

`pnpm test:blender` 会在检测到的 Blender 4.5+ 可执行文件中运行基础 Extension 回归和完整雪人
测试；后者验证复合动作冲突不会留下部分结果、外部 Mesh/Material/Collection 引用会安全阻止
回退、320 × 320 PNG、隔离 Scene，以及 13 步完整前进/回退。`pnpm test:blender:companion`
会启动真实 Orchestrator 进程和 Blender，经过 MCP 发布计划、回环 HTTP 拉取、主线程
Start/Next/Back 与状态回传，验证默认 Cube 不被删除以及跨进程闭环。
`pnpm test:blender:visual` 会从 Blender 工厂场景开始，保留默认 Cube、Camera 和 Light，执行
完整计划后切换到隔离渲染 Scene，并调用真实 OperatingLine Panel 绘制任务树与控制按钮，再
通过真实 GUI 捕获 `artifacts/blender/overlay-smoke.png`。

macOS 会自动检测 `/Applications/Blender.app` 和 `/Applications/Blender 2.app`；Linux 会检测
`/usr/bin/blender` 和 `/usr/local/bin/blender`。其他安装位置使用 `BLENDER_BIN`。

单独启动 Orchestrator：

```bash
OPERATINGLINE_ACCESS_TOKEN=development-token OPERATINGLINE_PORT=43123 pnpm dev
```

服务只监听 `127.0.0.1`，启动日志会输出 MCP endpoint。当前注册的 MCP tools 为
`operatingline.health`、`operatingline.adapters.list`、`operatingline.guide.publish` 和
`operatingline.companions.list`。

## 提交规范

项目使用 Conventional Commits、Commitizen、Husky 和 Commitlint。优先通过交互式命令生成提交信息：

```bash
git add <files>
pnpm commit
```

常用类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci` 和 `chore`。
Husky 会在提交前运行完整的 `pnpm check`，并使用 Commitlint 检查提交信息。

## 路线图与当前边界

已完成的是协议、Orchestrator 发布/投递/状态端、Blender 内引导与可回退建模、真实
Orchestrator ↔ Companion 跨进程闭环，以及受限的现有 MCP Bridge。当前仍未完成：

1. 根据“创建雪人”等任意目标自动生成结构正确、能力可执行的 GuidePlan。
2. 在确定性雪人预览之外增加骨骼动画，并扩展经过验证的通用 Blender 动作目录。
3. 加入节点聊天引用、局部重规划、计划差异确认和用户可编辑参数。
4. 把 observation 从 `0.1.0` 遥测升级为可配置的成功门与恢复策略，并在接入 Blender
   `undo_post`/`redo_post` 后再声明原生 Undo 能力。
5. 导出可复现的执行轨迹、计划、观察与评分数据，形成 eval/replay 流程。
6. 增加 Companion 心跳、租约与能力协商，再使用同一协议接入第二个开源宿主。
7. 在首个稳定发布前引入 Changesets 与自动发布流程。

首版只保证自有面板控件、三维对象和世界坐标锚点，不承诺精确标注任意 Blender 内置按钮。
对没有官方扩展 API 的宿主，只提供能力画像明确允许的降级体验。

## 参与贡献与安全

提交改动前请阅读 [贡献指南](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。Bug 与
功能建议使用仓库 Issue Forms；安全漏洞请按 [安全政策](SECURITY.md) 私密报告，普通使用问题
参见 [支持说明](SUPPORT.md)。

生产依赖审计可运行 `pnpm audit:prod`；已核实的精确例外与复查条件公开记录在
[依赖审计说明](docs/security/dependency-audit.md)。本轮未引入 Changesets，版本发布流程将在稳定
发布前单独设计。

## License

OperatingLine 使用 [Apache License 2.0](LICENSE)。仓库内改编的第三方材料及其原始许可见
[Third-Party Notices](THIRD_PARTY_NOTICES.md)。
