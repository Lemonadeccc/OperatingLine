# ADR 0128：Mirror operation-level MCP 与 Modifier RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0064](0064-bounded-mirror-modifier.md)

## 背景

Mirror 已有有界 whole-action executor 和原生菜单别名证据，但整叶调用无法让树、Guided Control 和训练数据看到
Modifier 创建、单轴选择与完整属性写入的实际顺序，也无法让 Runtime 独立核对 Blender 返回的每项 RNA 证据。
当前需求要求叶内的 `01 → 02 → 03 → 04 → 05 → 06 → 07` 与执行、回退、Observation、原生 Undo 和可视化
保持同一条轨迹。

## 决策

InteractionCatalog `1.60.0` 冻结 `1.59.0`，把当前
`blender.modifier.add_mirror.semantic` 切换为七项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId`、`modifierId` 并完成有界 preflight；
2. `semantic.select_owned_mesh` 显示并验证 receipt-owned 目标；
3. `panel.modifier_properties` 保留可见上下文；
4. `control.add_modifier` 显示 Add Modifier 入口；
5. `category.generate` 显示 Generate 分类；
6. `modifier.mirror` 创建 receipt UUID 派生名称的 pending `MIRROR` Modifier；
7. `semantic.mirror_contract` 写入 accepted name、单一本地轴与固定的完整 Mirror 属性集。

只有 06/07 改变场景。执行器使用一个 partial receipt、连续 fingerprint、LIFO inverse、失败补偿和 native
Undo/Redo rebind；07 完成后才允许发布强 `modifier_ready` Observation 与普通 `step_succeeded` 报告。

06 产生一条 `rnaMirrorModifierMutations` 创建记录；07 产生严格的 28 条数组：先写名称，再写 X/Y/Z 三个
轴分量，随后按固定顺序写 24 个属性。每条记录绑定 MCP、source operation、logical target/modifier identity、
值来源、accepted/observed 值与稳定 UI 语义路径。协议验证 variant、顺序、类型、常量、恰好一个启用轴和跨记录
identity；Runtime 从 durable receipt 与 accepted replay 独立重建完整数组并执行 canonical equality。Guided
Control 以 `MIRROR RESOURCE RNA`、`MIRROR PROPERTY RNA` 和 `06.01`/`07.01…07.28` 显示同一证据。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过七步 forward/inverse、逐项 replay、完成和整叶 Back。
- 双版本 Companion E2E 均完成七次 delivery/result、强 Observation 与原生 checkpoint lineage；Runtime 拒绝
  schema 合法但 modifier identity 或轴组合被篡改的收据，再接受原始 Blender 结果。
- 当前 action-level whole-action 集合减少为 15 项；冻结目录仍保留原有 Mirror whole-action 权限。
- 该证据证明固定 recipe 的 Blender 数据模型 mutation，不声称逐像素点击了 Modifier 面板，也不开放任意
  Modifier 类型、任意 RNA 字段或通用 Python 执行。
