# ADR 0037：有界 Solidify Modifier

- 状态：已接受
- 日期：2026-08-13

## 背景

ActionCatalog `1.9.0` 已开放 Bevel，但不能表达从薄表面生成可见壁厚。直接开放 Blender Solidify 的全部
属性会扩大计划参数面、版本差异和回退比较范围，也会让 provider 决定容易产生开口或不均匀厚度的实现细节。

## 决策

ActionCatalog `1.10.0` 新增 `blender.modifier.add_solidify`，位置紧随 Bevel。调用方只能提供
`targetId`、`modifierId`、`modifierName`、`thickness` 和 `offset`；`thickness` 范围为
`0.0001..100`，`offset` 范围为 `-1..1`。目标必须是自有 Mesh，所有已有 Modifier 必须来自完整
receipt；源 Mesh 与前置 Modifier stack 的求值输入都不得超过 8192 vertices、16384 edges 和
8192 polygons。

实现固定 `solidify_mode=EXTRUDE`、`use_even_offset=true`、`use_rim=true` 和
`use_rim_only=false`。这些值属于动作契约，不是计划参数。动作创建一个不应用的自有 Modifier，声明
OBJECT mutation 与 MODIFIER creation，使用 `modifier_ready` observation 和 compensating rollback；
外部修改继续由既有 compare-and-restore 边界保护。

InteractionCatalog `1.7.0` 一一绑定 ActionCatalog `1.10.0`，为该动作提供独立
`semantic_path`。`geometry.solidify_modifier` capability 让 provider 能把“表面需要壁厚”映射到明确动作，
而不把任意 modifier 类型纳入允许列表。

## 兼容性与后果

ActionCatalog `1.9.0` 与 InteractionCatalog `1.6.0` 冻结保存，历史 Plan 继续精确回放。新目录共有
20 个 action 和 12 项 semantic capability。Solidify 仍不应用 modifier，也不开放 arbitrary mode、rim、
material index、clamp、normal 或 vertex-group 控制；需要这些行为的目标必须保留为 actionless/manual。
