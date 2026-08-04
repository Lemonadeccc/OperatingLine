# ADR 0006：不可变节点引用与实例定向重规划

- 状态：已接受
- 日期：2026-08-04

## 背景

用户已经可以在 Blender 内审查 AI 生成的完整 GuideProposal，但仍无法从任务树精确表达“修改
`1.2.3` 头部节点”之类的反馈。若只把一段自由文本发给模型，模型无法可靠知道用户引用的是哪一版
计划、哪个稳定节点或哪一版 ActionCatalog；若直接原地 patch 活动计划，又会破坏审批、回放与 Eval
所需的不可变历史。

## 决策

宿主 Companion 提供节点 `Ref` 与一个明确命名为 **Revision request** 的输入区。发送时生成完整的
`GuideRevisionRequest`：

- `requestId`、`adapterId + instanceId` 与精确 `catalogVersion`；
- 完整且不可变的 `basePlan`；
- 1–8 个 `nodeId + nodeNumber` 引用；
- 用户消息与带时区时间戳。

Orchestrator 以 `requestId` 对完全相同的重试去重，同一 ID 的不同 payload 返回冲突。MCP 客户端使用
`operatingline.replan.requests.list` 读取待处理请求，再调用 `operatingline.replan.propose` 提交一个
完整的新 GuidePlan。新计划必须保持相同 Plan ID、使用请求绑定的目录版本，并具有更高 revision。

```text
Blender user
  │ Ref @1.2.3 + Revision request
  ▼
immutable base Plan + stable references
  │ authenticated loopback HTTP
  ▼
Orchestrator persistence
  │ operatingline.replan.requests.list
  ▼
Codex / Claude / another MCP client
  │ operatingline.replan.propose (complete newer Plan)
  ▼
instance-scoped GuideProposal
  │ read-only preview
  ▼
Blender Accept / Reject
```

请求关联的 Proposal 带 `revisionRequestId`、`catalogVersion` 与 `targetInstanceId`，只投递给发起请求的
Companion 实例。创建请求、生成 Proposal 和预览 Proposal 都不能改变活动 Session 或 Blender 场景；
仍然只有宿主内明确 Accept 才能安装新版计划，且安装后停在第一个 action 之前。

## 产品边界

当前输入区不是伪装的流式聊天，也没有内置模型。它发送不可变修订请求；模型在外部 MCP 客户端中
运行，返回一个完整 Proposal。后续协议 `1.1.0` 已用持久化线性 thread 和 Plan diff 关联多轮请求，
但仍不会把未持久化的聊天上下文当作计划事实，见 ADR 0009。

节点号用于用户阅读，稳定 `nodeId` 用于身份；Orchestrator 会根据请求携带的完整 base Plan 重新
计算并核对节点号，拒绝未知、重复或编号不一致的引用。

## 未选择的方案

- **原地 JSON Patch**：会隐藏未经重新审批的变化，并使 replay 无法确定执行的是哪一版计划。
- **只发送 `1.2.3`**：编号会随新版树结构改变，不能作为跨 revision 的稳定身份。
- **只发送 `nodeId`**：机器可定位，但用户无法核对自己在 UI 中引用的编号。
- **Orchestrator 内置特定模型**：会把核心协议绑定到单一供应商，并使离线与 Eval 边界变得含糊。
- **按 adapter 广播局部 Proposal**：多开同一宿主时会把个人修改请求泄漏到无关实例。

## 后果与后续

- 节点引用、请求、目录版本、完整重规划、审批与执行证据现在拥有可追溯关联。
- Blender 的活动树和待审树都可作为请求基线，但一次请求不能混合两个基线。
- 当前 UI 使用 Blender 原生单行字符串属性；ADR 0009 已增加线性多轮 thread 与 Plan diff，尚无
  完整聊天记录、分支/合并或参数表单编辑器。
- 版本化 Eval 导出已经可以消费这些持久事件，见
  [ADR 0007](0007-versioned-eval-evidence-export.md)；评分、数据脱敏与训练治理仍是后续里程碑。
