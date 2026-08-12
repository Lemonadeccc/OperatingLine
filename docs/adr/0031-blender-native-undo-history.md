# ADR 0031：Blender 原生 Undo/Redo 与 Session checkpoint 同步

- 状态：已接受
- 日期：2026-08-12

## 背景

OperatingLine 原有 `Back` 以 action receipt 做 compare-and-restore 补偿，能够拒绝覆盖用户修改，
但 `Start`、`Next`、`Recheck Observations` 与 `Back` 没有进入 Blender 原生 Undo 栈。仅给 Operator
增加 `UNDO` 标志并不安全：Blender 会恢复 ID datablock，却不会恢复 Python 模块内的
`active_index`、execution ID、receipt、observation gate 或渲染文件；Undo/Redo 还会重建 RNA
对象，使 receipt 中的 pointer 失效。

因此原生 Undo 需要一个宿主历史层，不能替代 Plan 声明的 rollback mode，也不能从可复制的自定义
属性重新推断资源所有权。

## 决策

`Start`、`Next`、`Recheck Observations`、原生菜单叶子和 `Back` 声明 Blender `UNDO`。每次操作前，
Extension 捕获当前 `DemoSession` 的不可变快照；操作成功或留下可恢复的 blocked/partial 状态后，
在一个既有 Scene 的自定义属性中写入随机 checkpoint ID，并把操作后的 Session 快照保存在进程内
journal。Blender 恢复该 Scene 属性后，`undo_post`/`redo_post` handler 用精确 ID 找回快照并恢复
Python 状态。

checkpoint 包含 plan identity、活动步骤、started/execution ID、receipt、observation gate 和最后一次
成功门证据。它不序列化到 `.blend`，也不从场景标签重建。收到完整文件加载事件时，Extension 删除
残留 marker、放弃进程内执行状态并关闭当前 Guidance；保存重开仍是明确的会话边界。

## Blender 身份与非 ID 状态

Blender Undo/Redo 可能让同一资源获得新的内存 pointer。所有 action-owned `ResourceIdentity` 因而同时
记录 Blender `session_uid`；恢复时先按 `session_uid` 找到当前 ID，再重新核对 owner、receipt token、
logical ID、step ID 和 action name，最后刷新 pointer。未归 OperatingLine 所有、但需要在 Back 时恢复
的 ID 引用使用单独的 `DataBlockReference`，只按稳定 `session_uid` 重绑定，不借用所有权标签。

Modifier 不是独立 ID，不能写自定义 owner 标签。handler 只在一个已知 checkpoint 被 Blender 恢复后，
按所属对象、原 stack index、名称、类型和完整允许属性重新绑定；任一字段不匹配即失败关闭。
Geometry Nodes modifier 内的 Node Group 仍按 action-owned ID 规则解析。

普通用户操作的 Undo/Redo 可能保持 OperatingLine marker 不变，但仍重建所有 RNA pointer。因此 handler
在 marker 不变时也会静默重绑定并验证当前 receipt，只是不改变步骤、也不发送伪造的 Companion
transition。marker 改变时才报告恢复后的 `step_succeeded`、`step_rolled_back`、observation 状态或
walkthrough 状态。

## 文件产物

Blender Undo 不管理 PNG 等文件系统产物。checkpoint journal 按 receipt 的 SHA-256 保存有界字节备份：

- 单文件最多 64 MiB，进程内去重缓存最多 256 MiB；
- Undo 离开产物 checkpoint 时，仅在当前文件哈希仍匹配 receipt 时删除；
- Redo 恢复时，仅在路径不存在，或当前内容精确等于 source/target checkpoint 时原子写回；
- 用户修改、路径冲突、备份缺失或目录消失都会停止同步，不覆盖当前文件；
- 多文件变更先完整预检，后续验证失败会恢复变更前字节。

## Back 与失败恢复

Plan 的 `Back` 继续执行原有 receipt 补偿并保留 compare-and-restore 安全语义；它现在本身也是一个
Blender Undo checkpoint，所以 Ctrl-Z 可以恢复刚刚补偿的步骤，Redo 再次回到补偿后的状态。原生
Undo 是宿主交互能力，不把 ActionCatalog 的 `rollback.mode` 从 `compensating_action` 改写成
`native_undo`。

若 marker 未知、资源无法精确重绑定、receipt 验证失败或文件产物冲突，handler 保留 Python 当前
状态并锁住新的 walkthrough 操作。用户可用相反方向的 Undo/Redo 回到最后一致 checkpoint；marker
即使未变化也会重新验证并在成功时解除锁定。无法回到一致状态时需要重新加载文件。安装新 Plan 会
丢弃当前进程 journal；若用户随后跨越到旧 Plan 的 Blender 历史，未知 marker 同样失败关闭。

Blender 的全局 Undo 偏好必须在操作发生时启用，Ctrl-Z/Redo 才有对应宿主历史；关闭时 `Back`
补偿仍可使用，但不会承诺此前操作可由原生历史恢复。

## 验证

- 纯 Python 测试覆盖 Session 快照往返、放弃状态和跨 Plan 拒绝。
- Blender 4.5.3 与 5.1.1 的 foreground E2E 真实执行
  `Cube → Subdivide → Bevel → Geometry Nodes → Material`，逐次 Undo/Redo 并验证 Session、对象、
  Modifier、Node Group、未归 action 所有的原材质引用和 receipt pointer 重绑定。
- 同一 E2E 插入一个不写 marker 的普通用户 `UNDO` Operator，证明 handler 静默重绑定且不增加
  Companion report sequence。
- `Back → Undo → Redo` 证明补偿操作本身进入宿主历史。
- 文件测试覆盖删除、恢复、原子替换、事务回滚和用户修改冲突的零覆盖失败。
- 完整 Blender background suite、Companion E2E、视觉 smoke 与 Extension 打包继续覆盖既有行为。

## 未选择的方案

- **只添加 Operator `UNDO` 标志**：会让场景与 Python Session 脱节，Redo 后 receipt pointer 失效。
- **把完整 Session JSON 写入 Scene**：receipt 含严格身份、文件备份与非 JSON 状态，也会把进程内权限
  边界错误地持久化到可复制场景数据。
- **按名称重建 receipt**：名称可修改、复制和复用，不能证明资源身份或所有权。
- **让原生 Undo 取代 Back**：会丢失 Plan 级补偿、外部修改检测和显式恢复语义。
- **忽略 marker 未变化的 Undo**：Blender 仍可能重建 pointer，下一次完整性检查会错误失败。

## 后果与后续

当前支持的是单一活动 Blender Session 的进程内原生历史同步。跨 `.blend` 重开、Extension 重载、
跨 Plan 历史迁移和持久化执行恢复仍未实现；未来若要支持，必须设计版本化、不可伪造且可验证的
持久 checkpoint，而不能复用本 ADR 的临时 Scene marker。
