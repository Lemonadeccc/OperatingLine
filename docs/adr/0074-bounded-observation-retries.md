# ADR 0074：有界 Observation 自动重试与耗尽证明

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0030 允许 `rollback_step` 在 Observation 失败并成功补偿后由用户再次点击 `Next`，ADR 0073 则能保存
最终自动回退或人工修复证明。但“再点一次”不是可声明的执行策略：计划没有尝试上限，失败报告无法区分
即将重试和已经耗尽，成功报告也不能说明本次成功经过了几次实际 Action 执行。

无限重试、在回退失败后继续执行，或把同一动作重试伪装成语义重规划，都会扩大宿主副作用并削弱审计边界。

## 决策

Guide/Companion protocol `1.5.0` 为 `success_gate + rollback_step` 增加可选策略：

```json
{
  "retryPolicy": {
    "mode": "automatic_bounded",
    "maxAttempts": 2
  }
}
```

`maxAttempts` 表示总尝试次数，只允许 `2` 或 `3`。历史协议 `1.0.0–1.4.0`、`telemetry`、
`retain_for_repair` 和没有显式策略的成功门保持原行为。

Blender 在一次 `Next` 原生历史事务内按下列顺序执行：

1. 执行同一个已审批 Action；
2. 只读求值该 leaf 的完整 Observation；
3. 失败时必须先用本次 receipt 成功补偿；
4. 尚有次数时报告 `retry_scheduled`，携带当前 attempt、总上限、剩余次数和 `scheduled` disposition；
5. 下一次尝试只能紧接上一条 `retry_scheduled`，不能跳号；
6. 成功时只提交一个最终 `next` Undo checkpoint，并在 `step_succeeded` 报告中携带
   `succeeded_after_retry` 摘要；
7. 最后一次仍失败时报告 `failed_rolled_back + exhausted`，取消准备中的历史事务，不产生伪 checkpoint。

`rollback_failed` 会保留 receipt 并进入既有阻塞恢复路径，绝不自动重试；`retain_for_repair` 也只允许
Recheck/Back。Action 抛错不属于 Observation 重试。

## 证明边界

每次 `retry_scheduled` 都是独立、带序号的 Companion 状态报告，但它是中间遥测，不能交给成功或
failure/recovery finalizer 形成终态证明。成功 finalizer 会把 `observationRetry.maxAttempts` 与已接受 Plan
绑定；自动回退 finalizer 只接受与 Plan 上限一致、remaining 为零的 `exhausted` 证据。

成功 attestation 仍以最终强 Observation 和当前 `next` checkpoint 为结果证据。重试摘要由同一受协商
Companion 报告；它不把中间失败报告升级为 UI 轨迹、MCP 调用或报告之后的当前宿主状态证明。

## 兼容性

- 没有 `retryPolicy` 的 `rollback_step` 继续在一次失败并补偿后返回 `failed_rolled_back`，用户可再次执行。
- 自动重试字段只允许 Guide/Companion `1.5.0`，避免严格旧协议接受未知语义。
- 上限固定为三次，不提供指数退避、任意循环、Provider 调用或新的授权复用。

## 验证

- 协议与公开 JSON Schema 覆盖版本门、严格策略形状、attempt 算术、scheduled/exhausted 状态和成功摘要。
- 纯 Python Session 测试覆盖禁止跳号、第二次成功、三次耗尽、快照恢复，以及 rollback failure 不重试。
- Runtime 集成测试覆盖中间报告不可 finalization、成功/耗尽证据与已接受 Plan 上限绑定。
- Blender 4.5.3/5.1.1 集成测试真实执行“失败 → 补偿 → 成功”和“全部失败 → 全部补偿”，并验证最终
  Undo checkpoint 只在成功终态出现。

## 后续

该策略只重放同一个确定性 Action，不根据诊断更换参数、选择不同菜单路径或修改 ProcedureTree。基于失败
分类的恢复策略选择、语义局部重规划、跨 Action fallback 和逐控件 UI executor 仍是后续工作。
