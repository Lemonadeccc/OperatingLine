# ADR 0104：经审查证明轨迹的 Guide 执行轨覆盖

- 状态：Accepted
- 日期：2026-08-21

## 背景

[ADR 0103](0103-human-reviewed-execution-failure-replan.md) 已允许可信失败候选经过目标 Blender
Companion 的人工审查后，原子生成下一版 GuideRevisionRequest 与待审 GuideProposal。但 Guide 1.5
不能表达“同一个语义叶节点改用哪条菜单或快捷键证明轨迹”，所以 `strategy_switch` 只能丢弃。

把轨迹 operations、原始按键、工具名或调用参数直接复制进 GuidePlan 会扩大执行输入面，也会把教学证据误当成
宿主执行权。只保存候选中的 `verifiedTrackContentSha256` 也不够：该字段承诺的是带 Observation obligations 的
策略包装，而不是 replay binding 中原始 ProcedureTrack 或其 `proofExecution` 的内容。

## 决策

Guide 协议升级到 `1.6.0`。只有 action leaf 可以声明严格的 `executionTrackOverride`：

- `kind` 固定为 `interaction_catalog_proof`；
- 绑定 InteractionCatalog version 与完整内容 SHA-256；
- 绑定 recipe、`menu | shortcut` modality 和 track identity；
- 分别绑定原始 ProcedureTrack 与 `proofExecution` 的内容 SHA-256。

该对象不携带 trajectory、operation、按键、operator、executor、tool 或 arguments。现有 action 仍保留语义动作与
目录校验；override 只选择已经存在于不可变 replay binding 中且携带 proof execution 的轨迹。

失败重规划 resolver 从精确 replay leaf 独立计算三类摘要：候选策略包装、原始 track 和 proof execution。只有
Guide 1.6 的基线、唯一可用 MCP 当前轨、同叶 proof-backed menu/shortcut 目标、原 action、Observation
obligations、ActionCatalog 与 InteractionCatalog 全部一致时，人工 accept 才能物化：

- 下一 revision 的 GuidePlan，仅在失败叶节点增加 override；
- 带一个 `executionTrackEdits` 的 GuideRevisionRequest；
- plan diff 精确包含同一字段的 pending GuideProposal。

审查事务把 revision request、proposal 和 override 的内容摘要写入 durable reviewed event。Companion 接受
含 override 的 Proposal 前重新读取该终态，并重验当前 Companion 仍处于评审基线 Plan，以及 proposal、
revision request、失败候选、当前安装 Action/InteractionCatalog 和不可变 replay proof 的完整哈希链。缺失或
不一致时在记录 acceptance 之前拒绝。通用 goal/replan/proposal 创建和直接
Guide publish 均禁止引入 override，旧 1.5 `strategy_switch` 继续只能 discard。

## 执行边界

Guide 1.6 只提供安全的、可审查的轨迹选择表达，不提供逐控件执行器。当前 Blender Companion：

- 在 Next 创建原生 Undo checkpoint、推进 session 或执行 action 之前，以
  `execution_track_executor_unavailable` 阻断 overridden leaf；
- 在界面上禁用 Next 并显示缺少 executor；
- action-level MCP delivery Schema 与 Blender delivery 构造器都拒绝 overridden leaf。

因此接受 Proposal 只会安装一个明确锁定的待执行计划，不会让菜单证明轨迹降级走现有 action MCP，也不会把
审查、目录证明或 replay proof 解释为当前 Blender 状态或执行成功证明。

## 结果

- proof-backed `strategy_switch` 可以经过现有双重人工门进入可追溯 Guide revision。
- 每个 override 都能回溯到精确目录、recipe、track、proof execution、失败候选和审查身份。
- Provider、通用 Proposal API 和直接发布无法伪造该权限链。
- 后续逐控件菜单/快捷键 executor 必须另行定义执行收据、状态门、原生 Undo 和恢复协议；在此之前计划安全停在
  被覆盖的叶节点。
