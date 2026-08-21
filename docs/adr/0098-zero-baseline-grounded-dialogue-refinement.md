# ADR 0098：零基线候选的语义 grounding、流式对话与一次局部精修

- 状态：Accepted
- 日期：2026-08-21

## 背景

ADR 0095 能从一句自然语言产生 revision 1 candidate，但明确不使用已有树检索。ADR 0086/0087 已提供带
完成事件收据的语义检索，以及已存 immutable tree 上的流式局部精修；后者的 base receipt 明确表示“已存”，
不能用伪造 sequence/storedAt 的临时候选替代。因此零基线 candidate 必须先通过精确人工 review 并成为真实
immutable revision，才可安全复用 semantic RAG、流式 Procedure 对话和置信度门控的自动局部改写。

## 决策

新增独立的 `ProcedureZeroBaselineRefinement 1.0.0` 分阶段编排器，严格复用四个既有可信边界：零基线
generation、原子 ProcedureTree persistence、真实 semantic retrieval，以及原生 Procedure refinement coordinator。
工作流不得对未存 candidate 做检索或精修，也不得构造伪造的 `sequence`、`storedAt` 或 semantic completion receipt。

工作流固定为以下顺序：

1. `create` 记录完整请求 fingerprint，调用零基线 generation，并停在 `awaiting_baseline_review`；此时只有 revision 1
   candidate，没有存储副作用。
2. `review` 必须回传 workflow、generation、baseline result 与 candidate tree 的四个精确 SHA-256。`discard` 直接终止；
   `store` 把 revision 1 与 reviewed evidence 放进同一数据库事务，并记录预先可计算的
   `{treeId, revision, contentSha256, storedAt}` storage binding。
3. `semantic.start` 只接受上一步精确存储的 revision，并强制检索 filters 与它的 adapter、ActionCatalog、
   InteractionCatalog 完全一致。结果必须非空，且必须能从原生 refinement coordinator 取得完全一致的 durable semantic
   completion receipt。
4. `refinement.start` 必须引用当前 latest stored revision、同一 semantic receipt，并使用彼此不同的 workflow、generation、
   review、semantic、run、dialogue 与 refinement request ids。之后状态直接投影原生 refinement coordinator，因此复用其
   流式 delta 持久化、Provider treatment drift 检查、固定 `0.8` confidence gate、局部 scope/locality gate、候选 preview
   与最终人工 review/store。

分阶段接口通过 MCP 与 HTTP 同时暴露。任何阶段都不创建或接受 Guide Proposal，也不执行 Blender；只有两处明确的人审
store 可以产生 ProcedureTree revision：基线 review 的 revision 1，以及原生 refinement review 的后续 revision。

## 恢复与失败关闭

每个阶段在可能产生外部调用前先写 durable started/requested evidence，并沿用下层 coordinator 的 no-replay 规则。
恢复时事件必须严格按 sequence 排序，stored envelope 的 id、type、createdAt 与 payload 必须逐项匹配；重复、乱序、
缺少前驱或时间倒退均 fail closed。已存基线通过 storage binding 精确读取 revision 1，再复算完整 tree hash、integrity
hash 与 storedAt；只读取 latest 不足以恢复历史证据。基线 store 由单一事务同时提交 tree 和 review event，因此不会出现
“树已存但工作流仍待 review”或相反的半提交状态。语义检索失败会把精确 request hash、安全错误和时间写成 wrapper
`semantic-failed` evidence，并进入 terminal `semantic_failed`；恢复只投影该终态，不会再次调用检索 Provider。同一
workflow/request 不允许重试。调用方若要继续，必须对已经存储的 immutable revision 启动独立、重新授权的 semantic/
refinement 流程，或以全新 workflow 与全套新身份重新开始。语义与原生 refinement 的其余中断恢复继续服从各自既有
no-replay 约束。

`semantic_failed` 只表示真实的 retrieval 或 exact grounding 失败，不表示 wrapper checkpoint 存储失败。下层已经写入
durable completed evidence 且 refinement completion receipt 可精确复算时，如果 wrapper 的 `semantic-ready` event 首次写入
失败，工作流不得追加 `semantic-failed`。由于 append 返回失败无法证明 event 未落盘，coordinator 会为该 workflow 设置仅存于
当前进程的 persistence outcome-unknown fault；同进程的 status 与所有 transition 均 fail closed，只能重启后按 durable evidence
恢复。若 durable log 中没有 `semantic-ready`，重启后提交同一请求时，wrapper 先把当前完整请求重新交给下层 `search` 做
request fingerprint 冲突检查；下层只会对 exact completed request 幂等返回，不会再次调用 embedding Provider，而同 request id
的不同 query/authorization 会 fail closed。wrapper 随后读取 `completedResult(requestId)`，与幂等返回值及 completion receipt
做 exact binding，再补写 `semantic-ready`；若 durable log 已包含 ready，则直接恢复 `awaiting_refinement`。

相同 outcome-unknown 熔断适用于 workflow created、baseline ready/reviewed、semantic started/ready/failed 与 refinement started
证据，以及可能已经原子提交 tree 与 reviewed evidence、但返回或提交后读取失败的 baseline store。熔断状态不伪造新的 durable
failure；重启只以实际落盘的 evidence 和 tree 为准恢复。

## 后果与边界

- 首棵 candidate 在进入 RAG 前必须先由人确认并成为真实 immutable revision，牺牲一次 review 换取正确的存储与检索语义。
- 自动局部精修继续受原生 `0.8` confidence、scope/locality、compile 与第二次 review/store 门约束。
- 语义结果为空时工作流拒绝进入 refinement；不伪造命中，也不自动放宽 verified/catalog filters。
- 每个阶段均可按 `workflowId` 读取，调用者可以逐步可视化并调整下一阶段请求，而无需把所有权限合并为一次隐式操作。

## 验证计划

- 协议：严格阶段 request、四哈希 review binding、storage binding、phase/side-effect/terminal 交叉约束。
- coordinator：create 并发合并、精确 store/discard、非空 semantic receipt、latest baseline 门、id 隔离，以及所有非法
  顺序/漂移/恢复证据 fail closed。
- persistence：reviewed evidence 与 revision 1 原子提交；恢复时精确 revision 缺失、hash/storedAt 不一致均拒绝。
- 集成：MCP/HTTP 依次走到 review、semantic 和 native streamed refinement，并证明人工 review 前没有树存储或宿主执行。
