# ADR 0087：证据绑定的流式 ProcedureTree 局部精修

- 状态：已接受
- 日期：2026-08-19

## 背景

ADR 0086 已能从 latest verified ProcedureTree 叶节点产生不含向量、可审计的语义检索结果，但检索入口本身
不会与用户继续对话，也不会修改树。既有 GuidePlan dialogue/replan 的数据结构、作用域和结果治理不同，不能
充当 ProcedureTree 编辑器。把检索结果直接拼进任意模型提示，或在 Provider 返回后自动保存树，会失去精确
revision、Provider treatment、局部作用域、人工审阅和外部调用 at-most-once 证据。

## 决策

新增 `ProcedureRefinement 1.0.0`。调用方先读取 Provider disclosure，再提交一条显式授权的 run。请求必须绑定：

- latest immutable base tree 的完整 stored receipt 和下一 revision；
- 一个已完成、非空的 Procedure semantic retrieval receipt；
- 一至八个已存在 scope roots、最新 instruction 和最多十二条 dialogue history；
- 同一 Provider 的 dialogue/refinement runtime treatment、数据处理和费用策略；
- 精确输入策略，以及本轮最多两次 Provider 调用、自动 refinement 和不执行宿主的确认。

第一轮 Provider 调用是流式 dialogue。Runtime 只接受累计助手文本增量，按有界字符数或时间窗口刷新 durable
status，最终文本必须与结构化结果完全一致。`answer` 可用 `null` 表示保守地不声明数值置信度；若为数值则
必须低于固定 `0.8`。只有 `refine` 达到或超过该阈值时，Runtime 才发起第二次也是最后一次调用。第二轮必须返回完整 ProcedureTree，不得保存树、创建
Proposal 或执行 Blender。

Provider 原始完整树与本地可审 target 分开保存和摘要。Runtime 在受权 scope 内进行确定性 sanitization，保持
scope 外节点、顶层 identity、scope root attachment 和跨 scope dependency 不变；变化或新增叶节点降为
`candidate`，菜单、快捷键和 MCP tracks 保持 `unavailable`。只有 locality report 有效且本地 compile gate
通过时，run 才进入 `awaiting_review`。

Review request 绑定 base、sanitized target、scope、semantic receipt、assistant message、refinement packet、
原始 Provider output 和 locality report 的九个 SHA-256。Store 把新 immutable tree、operation index、
`procedure.tree.stored`、`procedure.refinement.reviewed` 和 completed run 放在同一 `BEGIN IMMEDIATE` transaction；
discard 则原子写入 reviewed evidence 和 discarded run。并发 store/discard 只有一个结果能获胜，精确重试返回
duplicate，不同证据冲突。

## 证据、恢复与安全边界

每次可能计费的 Provider 调用必须先持久化 requested evidence，精确绑定 run/request、Provider/version、packet、
treatment 和 fingerprint；completed/failed evidence 必须随后出现并保持相同绑定。重启恢复只消费 durable
evidence：requested-only 或不确定结果转为 interrupted，绝不自动重放外部调用；completed 结果只在重新构造
prompt、scope、sanitized preview、locality、compile 和 review binding 全部一致后恢复。一个 run 最多存在唯一
dialogue 和唯一 refinement 调用证据。

持久层只接受协议 parser 验证后的公开 create/status/review/event DTO，并拒绝 credential、hidden reasoning 和
raw Provider payload 字段。所有 Provider 输入都使用已披露的精确 base tree、semantic result、instruction 和
history；credential 由 Provider 自身管理，不进入任务 payload、run 或事件。

## 公共入口

- HTTP：`GET /api/v1/procedure/refinement/providers`、
  `GET /api/v1/procedure/refinement/semantic-context/:requestId`、
  `POST /api/v1/procedure/refinement/runs`、
  `GET /api/v1/procedure/refinement/runs/:runId`、
  `POST /api/v1/procedure/refinement/reviews`；
- MCP：`operatingline.procedure.refinement.providers.list`、
  `operatingline.procedure.refinement.semantic-context.get`、
  `operatingline.procedure.refinement.run.create`、
  `operatingline.procedure.refinement.run.status`、
  `operatingline.procedure.refinement.run.review`。

## 后果与边界

- 用户可以从一棵已存树和明确 scope 开始，用语义检索上下文进行流式解释或自动局部精修，并在保存前审阅
  完整结构、参数和证据。
- 这是 ProcedureTree revision workflow，不是从一句话零基线生成完整树，也不是可视化树编辑器、训练数据发布、
  Proposal、宿主执行或 Observation 成功证明。
- Provider 的语义判断不绕过确定性本地门；candidate interaction tracks 不会被升级成 verified。
- 失败恢复优先保留外部调用 at-most-once，不能以自动重试换取不可审计的重复费用或不一致结果。

## 验证

- 协议与公开 JSON Schema 覆盖 disclosure、授权、stream decision、Provider result、locality、preview、review、
  run status 和 requested/completed/failed/reviewed evidence；
- persistence tests 覆盖畸形嵌套 payload、敏感字段、scope/time regression、原子 store/discard、duplicate、竞争、
  baseline drift 和 rollback；
- coordinator tests 覆盖真实流式 flush、两调用阈值、scope sanitization、compile gate、九摘要 review、事件顺序、
  interrupted/completed restart、无 Provider replay 和篡改恢复拒绝；
- HTTP/MCP 集成覆盖 Provider discovery、create/status/review 和进程重启恢复。
