# ADR 0011：跨目标规划阶段画像与确定性质量门

- 状态：已接受
- 日期：2026-08-05

## 背景

ActionCatalog 与 PlanningContext 已经让 Codex、Claude 或其他 MCP 客户端知道宿主真正允许的动作，
但“动作存在”仍不能保证候选计划形成适合教学和监督的阶段树，也不能发现材质先于几何、渲染缺少
场景依赖、可执行步骤没有锚点等结构问题。此前唯一完整验收计划又是雪人，容易把一个 fixture 的
质量误写成“任意目标已经可靠”。

OperatingLine 不能在没有模型和人工语义标签的情况下判断自然语言目标是否被理解，也不能为了
看起来可量化而生成一个主观总分。因此需要一个可重放、模型供应商无关、边界诚实的结构质量门。

## 决策

Blender ActionCatalog `1.2.0` 增加可选 `planningPhases`，把每个动作恰好归入一个有序阶段：

1. `geometry`
2. `materials`
3. `animation`
4. `render_setup`
5. `output`

旧的 `1.0.0` 和 `1.1.0` 文件保持不可变并继续安装，用于精确 replay。没有阶段画像的历史目录仍可
评估基础结构，但报告必须产生 `phase.profile_unavailable` warning；调用方要求具体阶段时则失败。

标准 MCP 工作流是：

```text
operatingline.planning.context
              │ catalog + planningPhases
              ▼
      external model drafts a full Plan
              │ declares goal-relevant phase ids
              ▼
operatingline.planning.evaluate
              │ deterministic findings
              ▼
operatingline.guide.propose
              │ repeats the same gate
              ▼
        in-host human review
```

`planning.evaluate` 与 `POST /api/v1/planning/evaluate` 使用版本化 `1.0.0` baseline，检查：

- 每个可执行叶子位于根节点下的阶段组，单个组不混合阶段，阶段顺序不倒退。
- 调用方从目标中声明的 `requiredPhaseIds` 都有可执行动作。
- 读取或修改的字符串逻辑资源由计划内动作创建，并通过 `dependsOn` 的传递闭包连接。
- 非共享逻辑资源没有多个创建者。
- 可执行步骤具有语义锚点；目录支持观察时，步骤提供至少一个预期观察。
- 既有 GuidePlan 结构、单宿主、action/顶层参数、anchor/observation/rollback 目录约束仍通过。

报告只含 `error`、`warning`、阶段覆盖和计数，不含 `score`。外部模型负责根据自然语言目标选择
所需阶段；Orchestrator 不解析关键词来假装理解目标。Proposal 提交可携带相同的 `planning.goal +
requiredPhaseIds`，服务端会重跑质量门并在有 error 时拒绝。每次评估作为
`planning.quality.evaluated` 追加事件进入现有 Eval/replay 证据链。

通用 `planningBenchmarkCase` 把目标、目录版本、所需阶段和完整参考 Plan 存成可重放数组。首个
跨目标案例是 `robot-preview`：不选择 animation，只执行 geometry、materials、render_setup 和
output；它在 Blender 4.5.3 与 5.1.1 中真实完成 6 个动作、生成 320 × 320 PNG，并完整回退文件和
全部自有 Blender 数据。

## 边界

- 这是结构与资源流质量门，不判断“机器人是否好看”或自然语言目标是否被完整满足。
- ActionCatalog 的嵌套参数仍由 Blender Companion 的动作验证器作为最终执行边界；质量报告不是
  宿主执行成功证明。
- 目录未声明的拓扑、雕刻、modifier、权重绘制或任意 Python 仍必须是 actionless/manual 节点。
- 人工接受 Proposal 与逐步 Next/Back 不变；质量门不能代替宿主内审批。

## 后果

- 不同模型可以针对同一个候选 Plan 得到字节级稳定的 finding，而不依赖供应商私有评分器。
- 阶段画像直接帮助模型生成用户要求的“建模 → 材质 → 动画 → 渲染”树，并允许目标省略不需要的
  阶段。
- Eval 导出现在能关联目标上下文、质量报告、Proposal、人工决定与执行结果，为以后人工标注和
  评分器提供原始证据。
- 仍需扩展更多人工审核目标、接入可选 planner、定义数据治理并验证第二宿主；这些完成前不得宣称
  任意目标语义规划已经解决。
