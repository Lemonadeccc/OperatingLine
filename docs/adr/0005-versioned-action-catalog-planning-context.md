# ADR 0005：版本化 ActionCatalog 与供应商无关 PlanningContext

- 状态：已接受
- 日期：2026-08-04

## 背景

GuideProposal 已经允许 Codex、Claude 或其他 MCP 客户端提交完整 GuidePlan，并由用户在宿主内
审批。但是模型此前只能从 README 或示例计划猜测 Blender Companion 真正实现的动作、参数、
资源依赖、观察和回退能力。协议结构校验不能证明动作存在，因而还不能可靠支持新目标规划。

## 决策

每个宿主适配器发布独立、不可变、语义化版本的 ActionCatalog。目录属于适配器，不属于模型供应商
或 Orchestrator；公共协议只定义目录信封和动作元数据。

```text
adapter-owned ActionCatalog
       │ installed at composition root
       ▼
Orchestrator catalog registry
       ├─ operatingline.action_catalog.get
       └─ operatingline.planning.context
                    │
                    ▼
          Codex / Claude / MCP client
                    │ complete immutable GuidePlan
                    ▼
          operatingline.guide.propose
                    │ catalog + structure validation
                    ▼
              in-host approval
```

`operatingline.action_catalog.get` 支持选择精确 `catalogVersion`，未指定时按语义版本选择该适配器的
最高已安装版本。重复 `adapterId + catalogVersion`、未知适配器和未安装版本都会失败。

`operatingline.planning.context` 返回同一个目录，以及可选用户目标、目标 Plan ID 的建议下一 revision、
该适配器的最新 Companion 状态、GuidePlan 结构约束和唯一的 Proposal 提交入口。它不调用模型，
也不声称自动完成任务拆解；模型客户端可以替换，而相同上下文仍可用于 replay 和 eval。

AI Proposal 在 Orchestrator 端还会依据目录检查：

- action 名称必须存在。
- 顶层必填参数必须存在，未声明参数必须拒绝。
- rollback、anchor 和 observation 必须由该 action 声明支持。
- Blender Companion 继续作为嵌套参数、资源身份和宿主状态的最终执行校验边界。

## 目录所有权和分发

Blender 的规范目录位于 `adapters/blender/catalog/v1/action-catalog.json`，并通过独立 workspace
package 提供给 Orchestrator composition root。打包脚本还会把同一文件同步到 Extension resources，
测试比较目录动作与 Python 允许列表，避免维护两份不同能力描述。

目录版本与 Guide protocol 版本分离：协议版本描述目录的结构，`catalogVersion` 描述某个适配器的
动作集合及契约。目录变更不会静默覆盖旧版本；调用者可以把精确版本记录进后续 Eval 数据。

## 后续目录演进

Blender catalog `1.0.0` 冻结最初验证的 8 个通用动作。catalog `1.1.0` 在不修改历史文件的前提下
加入 `blender.rig.create_armature`、`blender.animation.create_pose_keyframes`，并要求渲染 action
显式选择帧。Orchestrator 同时安装两个版本，默认返回最高语义版本；Eval/replay 仍能按历史记录
解析精确 `1.0.0`。

几何目前仍共享历史逻辑资源 `snowman.collection`；目录明确披露这一约束。拓扑编辑、雕刻、
modifier、权重绘制、deform rig 和任意 Python 执行仍不在目录中，规划器必须把它们保留为
actionless/manual 节点，而不能捏造可执行能力。`1.1.0` 的动画仅覆盖有界的刚性骨骼父子绑定与
Euler 姿态关键帧，详细边界见 ADR 0008。

## 后果

- 模型可以先查询事实，再生成可安装的 Plan，而不是从雪人 fixture 反推私有参数。
- Orchestrator 仍然是无界面、模型供应商无关的协议服务。
- 新宿主必须交付真实目录，才能参与 AI Proposal 规划；只有 capability profile 不足以证明动作。
- 任意目标的质量仍取决于外部模型和目录覆盖范围。节点引用与不可变重规划已由 ADR 0006 落地；
  线性多轮 thread 与 Plan diff 已由 ADR 0009 落地；完整消息历史/参数编辑、Eval 评分与治理和
  第二宿主仍是独立后续里程碑。
