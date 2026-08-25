# ADR 0127：Solidify operation-level MCP 与 Modifier RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0037](0037-bounded-solidify-modifier.md)

## 背景

Solidify 已有有界 whole-action executor，但整叶调用无法让树、Guided Control 和训练数据看到 Modifier 创建与
参数写入的实际顺序，也无法让 Runtime 独立核对 Blender 返回的每项 RNA 证据。当前需求要求叶内的
`01 → 02 → 03 → 04` 与执行、回退、Observation、原生 Undo 和可视化保持同一条轨迹。

## 决策

InteractionCatalog `1.59.0` 冻结 `1.58.0`，把当前
`blender.modifier.add_solidify.semantic` 切换为四项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId`、`modifierId` 并完成有界 preflight；
2. `panel.modifier_properties` 保留可见上下文；
3. `control.add_modifier` 创建 receipt UUID 派生名称的 pending `SOLIDIFY` Modifier；
4. `semantic.solidify_parameters` 写入 accepted name、thickness、offset 和固定的完整 Solidify 属性集。

只有 03/04 改变场景。执行器使用一个 partial receipt、连续 fingerprint、LIFO inverse、失败补偿和 native
Undo/Redo rebind；04 完成后才允许发布强 `modifier_ready` Observation 与普通 `step_succeeded` 报告。

03 产生一条 `rnaSolidifyModifierMutations` 创建记录；04 产生严格的 26 条数组：先写名称，再按固定顺序写
25 个属性。每条记录绑定 MCP、source operation、logical target/modifier identity、值来源、accepted/observed
值与稳定 UI 语义路径。协议验证 variant、顺序、类型、常量和跨记录 identity；Runtime 从 durable receipt 与
accepted replay 独立重建完整数组并执行 canonical equality。Guided Control 以
`SOLIDIFY RESOURCE RNA`、`SOLIDIFY PROPERTY RNA` 和 `03.01`/`04.01…04.26` 显示同一证据。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过四步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成四次 delivery/result、强 Observation 与原生 checkpoint lineage；Runtime 拒绝
  schema 合法但 modifier identity 或 accepted thickness 被篡改的收据，再接受原始 Blender 结果。
- 当前 action-level whole-action 集合减少为 16 项；冻结目录仍保留原有 Solidify whole-action 权限。
- 该证据证明固定 recipe 的 Blender 数据模型 mutation，不声称逐像素点击了 Modifier 面板，也不开放任意
  Modifier 类型、任意 RNA 字段或通用 Python 执行。
