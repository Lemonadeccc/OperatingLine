# ADR 0097：已验证媒体准备到人工审阅 ProcedureTree 存储

- 状态：Accepted
- 日期：2026-08-21

## 背景

ADR 0096 只把已验证媒体 manifest 转成确定性的 authoring packet。它刻意不调用 Provider、不生成或存储
ProcedureTree。若后续调用把 packet、Provider 候选、materialization 结果和人工决定分散处理，进程重启可能重放
费用不确定的 Provider 调用，或把审阅过的对象替换为不同内容。

## 决策

新增独立 media authoring run，输入必须携带 `ready` preparation 全量结果以及显式确认过的 Provider descriptor。
run identity 同时绑定 analysis request id、analysis job id、analysis fingerprint、preparation fingerprint 和 packet hash。

流水线固定为 `provider_generation -> materialization -> storage`。每个边界写入持久 evidence；Provider 完成 evidence
和候选树 checkpoint 必须先持久化，才可进入确定性 materialization。重启时，找不到下层 completion evidence 的
Provider stage 直接失败，不会自动调用 Provider；若下层 generation completion 已持久化、但外层 stage completion
尚未来得及写入，恢复会严格校验 event identity、请求指纹、Provider descriptor、packet 和完整 result 的精确绑定，
此后即使外层 checkpoint append 失败也不得写入 Provider terminal failure；重启会补回外层 generation checkpoint，
再进入显式 local materialization recovery，绝不重调 Provider。若 generation 与 materialization checkpoint 均已持久化、
仅 review gate append 失败，则不得倒退写入 materialization recovery；重启直接从两阶段 checkpoint 补回 review gate。
进程内若 checkpoint、recovery 或 terminal evidence 无法持久化，会保留 volatile persistence fault；后台任务立即观察该错误，
后续 status 返回明确的 `authoring_persistence_failed`，不会回落成 `accepted`。storage stage start 持久化失败只可进入
合法的 storage recovery，discard finalization 失败则由重启依据已持久化 review 补齐。
所有 append
都要求存储层返回 sequence/id/type/time/payload 完全一致的 envelope；恢复状态机拒绝重复、乱序和跨阶段事件，并能从
materialization checkpoint 确定性补回 review gate，而不会退回空的 accepted 状态。

materialization 后必须暂停并返回 preparation、generation 和 materialization 的精确 preview。`store` review 必须确认
preparation、packet、candidate tree、materialized tree 四个 hash；任一不一致都拒绝。存储接口在同一原子事务内写入
ProcedureTree、binding 和 completion event，并可用完全相同的 binding/event 做崩溃后 reconciliation。

本地 `/procedure-tutorial-authoring` 界面只在 sessionStorage 保留 fragment token。Provider 确认绑定当前模式与 descriptor
指纹；review 确认绑定 run/review identity 及四个内容 hash。输入、模式或 preview 变化都会清除旧确认，成功存储后可用
tree id 直接打开 revision 编辑器。

成功结果固定声明 `proposalCreated=false`、`hostExecutionStarted=false`。本流程不会自动创建 Guide proposal，也不会执行
Blender；这些仍需独立、显式的后续用户动作。

## 结果

媒体 authoring 从可验证 packet 延伸为可恢复、可审计、人工把关的 ProcedureTree 存储流程。外部 Provider 副作用
不会因服务重启而不确定地重复，人工审阅也不能被 hash 不同的候选或 materialization 结果替代。
