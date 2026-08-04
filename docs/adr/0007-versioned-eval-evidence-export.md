# ADR 0007：版本化 Eval 证据包与稳定事件序列

- 状态：已接受
- 日期：2026-08-04

## 背景

ActionCatalog、PlanningContext、GuideProposal、人工决策和 Companion 状态已经形成一条可审计链，
但它们只存在于内部事件表和最新状态接口中。训练或评测工具无法按计划、宿主和实例取得同一份可
重放输入，也无法证明分页内容在两次读取之间保持一致。仅导出最终场景会丢失目标、计划版本、失败
观察和回退，不能解释 AI 为什么得到这个结果。

## 决策

定义 `EvalExportBundle` format `1.0.0`，通过 MCP `operatingline.eval.export` 和鉴权 HTTP
`GET /api/v1/eval/export` 提供。请求必须指定 `targetAdapterId + planId`，可选限制到一个
`instanceId`，并使用稳定的 `afterSequence + limit` 游标分页。

一个证据包包含：

- 与计划关联的 PlanningContext（含用户目标和当时的完整目录）、完整 Plan/Proposal、节点修订请求、
  请求—Proposal 关联和人工接受/拒绝决定；
- 对应实例的逐步状态、observation、错误和 `step_rolled_back` 记录；
- 所有被事件引用的精确 ActionCatalog 版本；没有历史引用时包含当前目标宿主的最新目录；
- 整个匹配集合的事件类型、transition 和 decision 计数，以及当前事件页；
- `operatingline-json-sort-v1` 规范化后的 SHA-256 内容摘要。

摘要输入是除 `exportId`、`exportedAt` 和 `integrity` 外的全部顶层内容，因此相同 scope、目录、
事件页和汇总会得到相同哈希，导出信封的随机 ID 与时间不会改变它。对象键按字典序递归排序，数组
顺序保持不变，再以紧凑 JSON 编码计算 SHA-256。

事件表升级为显式、只增的 `sequence INTEGER PRIMARY KEY AUTOINCREMENT`。版本 1–4 数据库按原
`rowid` 顺序迁移，保证重启后的分页游标继续递增。PlanningContext 每次生成都会追加
`planning.context.generated`；受信任直接发布路径从本版本起在 `guide.plan.published` 中保存完整
Plan，而不是只保存 ID/revision。

导出不推断质量分数，也不把 `satisfied: false` 解释为执行失败。它忠实输出已有事实，评分器、成功门
和恢复策略是独立的后续层。

## 数据边界

`0.1.0` 不自动脱敏。包内可能含用户目标、修订消息、动作参数、宿主观察和错误详情，协议明确标记
`redaction: none` 和敏感内容警告。所有导出端点继续使用本地 Bearer Token；调用方在分享、上传或
用于训练前负责审核和取得适当授权。

实例 scope 会排除其他 Companion 的决策与状态。无实例 scope 用于计划级汇总，会包含该计划在目标
adapter 下所有相关实例。尚未绑定 Plan 的 `connected` 报告不会被猜测归入某个计划。Proposal 与
RevisionRequest 的关联通过持久 ID 解析，而不是依赖相邻事件。

## 未选择的方案

- **只导出最新 Companion 快照**：会丢失中间步骤、失败观察和回退。
- **把数据库文件当作公开格式**：会把内部 schema 与跨语言消费者绑定，也无法表达分页和隐私边界。
- **由导出端自动打分**：当前 observation 只是遥测；直接评分会制造未经验证的质量结论。
- **使用导出时间作为游标**：多个事件可以共享时间戳，无法提供无歧义的继续位置。
- **哈希包含随机信封元数据**：同一事实每次导出都会产生不同摘要，不能用于内容对比。

## 后果与后续

- Codex、Claude 或离线工具现在可以按同一协议收集 replay/eval 输入，且响应最多返回 1,000 个事件。
- 当前本地 `0.1.0` 实现为解析跨事件关联会扫描追加式事件账本；数据规模扩大前应增加持久化 scope
  索引或物化关联，但不能改变公开 cursor 与 bundle 语义。
- 后续仍需设计显式脱敏策略、同意/保留策略、评分器、数据集切分和训练流水线；这些能力不得仅凭
  “已经可以导出”宣称完成。
