# 贡献指南

感谢你改进 OperatingLine。提交代码前，请先了解项目当前边界：协议、Headless Orchestrator、
Blender Extension、受限 Blender MCP Bridge，以及实时 Orchestrator ↔ Blender 的计划投递与
状态回传闭环已经可运行。内置 revision 4 计划可以完成并回退 15 步雪人建模、刚性骨骼姿态动画
和渲染预览；节点引用修订、版本化 Eval 采集/盲审基础也已实现。任意目标的可靠语义规划、已发布的
真实 Provider Eval、变形/权重骨骼和第二宿主仍未完成。请勿把确定性验收场景描述成“AI 已能自动
完成任意 Blender 任务”。

## 开始之前

开发环境需要：

- Node.js 24（仓库当前固定为 24.19.0）
- Corepack 和 pnpm 10.20.0
- 修改或验证 Blender Extension 时，需要 Blender 4.5 或更高版本

```bash
corepack enable
pnpm install
```

使用 oh-my-codex 的贡献者可以选择初始化本地代理环境；这不是构建或运行 OperatingLine 的
前置条件：

```bash
omx setup --scope project --plugin
omx doctor
```

`.codex/` 与 `.omx/` 是本机生成的工具状态，已被 Git 忽略。协作规则的仓库入口是
`AGENTS.md`，不要提交生成的 prompt、skill 或运行状态副本。

如果 Blender 不在平台默认路径，请为相关命令指定可执行文件：

```bash
BLENDER_BIN=/absolute/path/to/blender pnpm test:blender
```

## 选择改动范围

- 通用协议和 Schema 位于 `protocol/` 与 `packages/protocol/`。
- 与宿主无关的领域规则位于 `packages/domain/`，不得依赖 Blender 等宿主 API。
- Orchestrator 位于 `services/orchestrator/`。
- Blender 原生扩展与外部 Bridge 位于 `adapters/blender/`。
- 新宿主适配器应放在 `adapters/<host>/`，并遵循 `adapters/README.md` 的能力画像、允许列表
  action 和语义锚点约束。

保持改动聚焦。修复缺陷时补充回归测试；改变协议或宿主行为时，同步更新对应 fixture、Schema、
测试和文档。不要暴露任意代码执行、任意文件路径或非回环网络服务作为公共能力。

## 本地验证

所有拉取请求都应先运行完整的 Node.js / TypeScript 检查：

```bash
pnpm check
```

该命令依次运行 ESLint、TypeScript 类型检查、Vitest、协议 Schema 一致性检查和 Prettier
格式检查。

生产依赖审计使用：

```bash
pnpm audit:prod
```

单个已核实例外及其复查条件记录在 `docs/security/dependency-audit.md`，不得用宽泛忽略规则隐藏
新的漏洞。

改动 Blender Extension、Blender fixture 或相关构建脚本时，再运行：

```bash
pnpm test:blender
pnpm test:blender:companion
pnpm package:blender
```

`pnpm test:blender` 会先运行纯 Python 引导状态单元测试，再对检测到的 Blender 可执行文件运行
基础 Extension 回归和完整雪人无界面集成测试，包括复合动作冲突预检、隔离渲染、PNG 产物与
15 步完整回退，并验证允许列表中的原生菜单引导与自动 `Next` 具有相同的 action/receipt 语义。
`pnpm test:blender:companion` 会启动真实 Orchestrator 与 Blender，验证 MCP 发布、回环计划拉取、
状态回传和跨进程前进/回退。`pnpm package:blender` 会在 `artifacts/blender/` 生成安装包。

改动 Panel、Overlay、引导线或其他可视行为时，还应在有图形界面的环境运行：

```bash
pnpm test:blender:visual
```

该命令为十六个真实 GUI 状态分别启动第一个检测到的 Blender，从互相隔离的工厂场景捕获任务树、
Provider、前进/回退、隐藏、operator 语义降级及原生 Add/Mesh 菜单引导状态。输出为
`artifacts/blender/guidance-*.png`，并将前进中状态写入兼容产物
`artifacts/blender/overlay-smoke.png`。每次捕获都会确认默认 Cube、Camera 和 Light 仍存在。
如果本机没有检测到 Blender，命令会失败并提示设置 `BLENDER_BIN`。请在拉取请求中说明无法运行的
检查及原因，不要把未运行的检查标记为通过。

## 提交信息

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)。可以使用交互式命令：

```bash
git add <files>
pnpm commit
```

常用类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci` 和 `chore`。标题使用
祈使语气并准确描述单一改动，例如：

```text
fix(blender): preserve user objects when starting a plan
docs: clarify live pairing status
```

仓库会在提交前运行 `pnpm check`，并通过 Commitlint 检查提交信息；CI 还会检查拉取请求中的
全部提交。

## 记录版本意图

改动 workspace 包的公共行为、接口或依赖契约时，使用 Changesets 记录 SemVer 意图：

```bash
pnpm changeset
pnpm release:check
```

纯文档、测试、CI 或仓库内部维护改动可以不添加 changeset，但应在拉取请求中说明。当前发布流程是
预发布 Phase 0：只有受保护 `main` 上的非空 changeset 才会创建或更新草稿版本 PR；当前远端
`main` 尚未保护，所以该 job 保持 skipped。所有包仍为 private，不会发布 npm、
创建 tag/GitHub Release 或上传产品产物。不要在发布 workflow 中加入 registry token、OIDC 或 publish
命令。保护 `main` 前还必须在 GitHub Actions 设置中允许工作流创建拉取请求，使默认
`GITHUB_TOKEN` 能创建草稿版本 PR；不要改用 PAT 绕过该设置。完整边界见
[ADR 0039](docs/adr/0039-changesets-release-preparation.md)。

Dependabot 仅将 minor/patch 更新按开发依赖和生产依赖分组，major 更新保持为独立 PR。当前
`typescript-eslint` 尚不支持 TypeScript 7，因此暂缓 TypeScript major 更新；其余 major 更新仍会
单独提出。不要覆盖 Dependabot 的默认标签，除非所有自定义标签已在仓库中创建。

## 提交拉取请求

拉取请求应：

1. 说明问题、解决方式和明确不包含的范围。
2. 关联相关 issue；涉及用户可见行为时附上复现步骤或截图。
3. 列出实际运行的验证命令与结果。
4. 标明兼容性、安全性、协议或数据迁移影响；没有影响时也明确写出。
5. 保持提交历史符合 Conventional Commits。

提交贡献即表示你同意按照仓库的 [Apache License 2.0](LICENSE) 授权该贡献。参与社区时请遵守
[行为准则](CODE_OF_CONDUCT.md)。安全漏洞请按[安全政策](SECURITY.md)私下报告。
