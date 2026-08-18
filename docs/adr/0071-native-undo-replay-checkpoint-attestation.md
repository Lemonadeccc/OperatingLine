# ADR 0071：受管 Procedure 回放的原生 Undo checkpoint 证明

- 状态：Accepted
- 日期：2026-08-18

## 背景

Blender Extension 已按 ADR 0031 为 Start、Next、Recheck、Back 和原生菜单动作维护真实宿主 Undo
checkpoint：Scene marker 指向进程内 journal，journal 保存完整 Session 快照和文件产物备份。此前
Companion report 没有携带该事实，因此 Procedure replay attestation 只能证明受管 Action、receipt 与强
Observation，不能证明 terminal report 对应一个可由 Blender 原生 Undo/Redo 选择的历史点。

直接根据“该 Operator 支持 Undo”或“Extension 存在原生历史模块”推断 replay checkpoint 会越过证据边界；
仅上报 checkpoint UUID 又无法证明它属于当前 Plan、执行、叶节点 receipt 和报告时 Session。

## 决策

Companion report 增加可选的 `nativeUndoCheckpoint`。Blender 在成功提交宿主历史之后读取当前 checkpoint，
并只对与 transition 匹配的 `walkthrough_started/start`、`step_succeeded/next`、
`observation_recovered/recheck` 或 `step_rolled_back/back` 报告附加证据。证据固定包含：

- checkpoint UUID、前驱 UUID、操作和 UTC commit 时间；
- 精确 Scene marker key 及当前匹配声明；
- journal entry、Session snapshot 和全部 receipt 文件产物备份的验证声明；
- Plan ID/revision/content hash、execution ID、active/completed step 及 receipt step 的有序身份。

协议拒绝 operation 与 transition 不一致、checkpoint 晚于 report、receipt 不属于 completed step，或
checkpoint Session 与 report 的 Plan、hash、execution、active/completed steps 不完全一致。Extension
若没有完整执行身份、当前 marker/journal 不一致、Session 已变化或产物备份缺失，则不生成可用证明或直接
fail closed。

新的 `procedure.replay.finalize` 还要求 terminal `step_succeeded` report 携带 `next` checkpoint，且其
receipt 恰好是这一个 replay leaf。生成的 attestation 增加：

- `nativeUndoCheckpoint: companion_reported_current_at_report`；
- `currentHostStateAfterReport: not_verified`。

后一字段是主动限制：checkpoint 只证明 Companion 生成该 report 时 Scene marker、journal 和 Session 一致。
之后的 Undo、Redo、Back、用户编辑或文件重载不会删除追加式 attestation，因此不能据此声称当前场景仍保持
被证明的对象和状态。

## 兼容性

- `nativeUndoCheckpoint` 在通用 Companion report 中保持可选，既有 report 继续解析。
- 已保存、未携带新字段的 replay attestation 继续按历史合同解析和导出。
- 新的 replay finalization 必须取得 checkpoint 证据；旧客户端提交的新终态 report 会以 409 fail closed，
  不会产生降级 attestation。
- 证据不序列化完整 Session 或产物字节，只保存 journal 已验证声明和严格身份；ADR 0031 的进程内、单活动
  Session、文件重载边界不变。

## 验证

- 协议测试覆盖 operation、execution、时间、Session 与 receipt 绑定，以及新旧 attestation 兼容性。
- Orchestrator 集成测试覆盖缺失 checkpoint 的 finalization 拒绝，并验证七种 primitive 的新证明范围。
- Python 测试覆盖 journal attestation 构建与不完整身份降级。
- Blender 4.5.3 与 5.1.1 前台回归验证 Start、Next、Back 报告中的真实 marker、checkpoint、Plan、execution、
  completed step 和 receipt 身份。

## 未选择方案

- **把 Scene marker UUID 当作完整证明**：不能绑定 journal 内容、Session、receipt 或文件产物备份。
- **让新字段成为所有 Companion report 的必填项**：会破坏旧协议、非 Blender 适配器和不产生宿主历史的
  transition。
- **把报告时 checkpoint 扩写成当前场景证明**：追加式证据不会随之后的宿主状态变化而失效。

## 后续

该切片仍不执行逐控件菜单或快捷键，也不提供 action-level MCP executor。失败/恢复事件需要独立的 replay
attestation，复合、Edit Mode、Modifier、Geometry Nodes、蒙皮与动画叶节点也必须逐类增加强 Observation
和回放覆盖；如需证明查询时的当前场景，必须另行发起新的宿主状态 recheck，而不能复用历史 report。
