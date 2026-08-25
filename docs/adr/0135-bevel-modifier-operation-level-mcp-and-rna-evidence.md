# ADR 0135：Bevel Modifier operation-level MCP 与 Modifier RNA 证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0029](0029-bounded-edit-modifier-geometry-nodes.md)

## 背景

Bevel Modifier 已有有界 managed action，但当前 InteractionCatalog 没有为它授予 whole-action 或
operation-level MCP。四步语义路径只能显示 Layout、Modifier 面板、Add Modifier 和 Bevel Settings，无法让
ProcedureTree、Guided Control、Runtime 与训练数据共同核对 Modifier 创建、命名和参数写入的实际顺序。

## 决策

InteractionCatalog `1.67.0` 字节冻结 `1.66.0`，只为当前
`blender.modifier.add_bevel.semantic` 增加四项 operation-level MCP：

1. `workspace.layout` 绑定 `targetId`、`modifierId` 并完成有界 preflight；
2. `panel.modifier_properties` 保留可见上下文；
3. `control.add_modifier` 创建 receipt UUID 派生名称的 pending `BEVEL` Modifier；
4. `semantic.bevel_parameters` 依次写入 accepted name、width、segments、固定 `limit_method=ANGLE` 与
   accepted `angleLimit`。

只有 03/04 改变场景。执行器保存连续 fingerprint、一个 partial receipt、LIFO inverse、失败补偿和 native
Undo/Redo rebind；04 完成后才允许发布强 `modifier_ready` Observation 与正式 `step_succeeded`。

03 产生一条严格 `rnaBevelModifierMutations` create 记录。04 产生五条严格记录：先写名称，再按固定顺序写
width、segments、limit method 与 angle limit。每条记录绑定 MCP、source operation、logical
target/modifier identity、值来源、before/accepted/observed 值与稳定 UI 语义路径。协议验证 variant、顺序、
类型、常量和跨记录 identity；Runtime 从 accepted replay 独立重建确定性数组并执行 canonical equality，
同时将最终宽度、段数、角度、固定 ANGLE、源 Mesh 内容保护和有界 evaluated topology 与 Observation 交叉核对。
whole-action 收据也加入 Object data 与 Mesh content no-op guard，避免把意外源数据修改误报为成功。

## 结果与边界

- Blender 4.5.3 LTS 与 5.1.1 的本地 integration 均通过四步 forward/inverse、逐项 replay、完成与整叶 Back。
- 双版本 Companion E2E 均完成四次 delivery/result、四张 operation receipt、强 Observation 与完整 native
  checkpoint lineage；Runtime 拒绝目标、属性值、证据顺序与固定 `ANGLE` 被篡改的结果。
- 当前 whole-action MCP 集合仍为 9 项；operation-level MCP 增至 14 项，Procedure replay 允许集增至
  23 个 action。冻结的 `1.66.0` 对 Bevel Modifier 仍没有 MCP 权限。
- 该证据证明固定 recipe 的 Blender RNA 数据模型 mutation，不声称逐像素点击原生 Modifier 控件，也不开放
  任意 Modifier 类型、任意 RNA 字段或通用 Python 执行。
