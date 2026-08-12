# ADR 0038：有界整网格 Triangulate

- 状态：已接受
- 日期：2026-08-13

## 背景

ActionCatalog `1.10.0` 已能对自有 Mesh 做一次整网格 Subdivide，但不能把四边面或 N-gon 显式转换为
三角面。把任意 Edit Mode 选择、operator 参数或上下文直接交给 provider，会扩大状态空间并削弱
确定性、观察与回退边界。

## 决策

ActionCatalog `1.11.0` 新增 `blender.mesh.edit_triangulate`，位置紧随
`blender.mesh.edit_subdivide`。调用方只能提供 `targetId`、`resultMeshId` 与 `resultMeshName`。目标必须
是自有 Mesh、处于 Object Mode、没有 Modifier 或 Shape Key，并至少包含一个非三角面；源 Mesh 不得
超过 8192 vertices、16384 edges 和 8192 polygons。

实现复制源 Mesh，在副本上对全部面执行固定 `quad_method=FIXED` 与 `ngon_method=EAR_CLIP` 的
Triangulate，然后把目标对象换链到新的自有 Mesh。源 datablock 保持不变并进入 receipt，因此正常
`Back` 可以 compare-and-restore；中途失败不得留下新 Mesh、逻辑 ID 或对象 mutation。动作声明
OBJECT mutation 与 MESH creation，使用 `resource_exists` 和 `mesh_triangulated` observation，以及
compensating rollback。

InteractionCatalog `1.8.0` 一一绑定 ActionCatalog `1.11.0`，为该动作提供独立
`semantic_path`。`geometry.edit_triangulate` capability 让 provider 能把需要显式三角拓扑的目标映射到
确定动作，而不开放任意 Edit Mode operator 或组件选择。

## 兼容性与后果

ActionCatalog `1.10.0` 与 InteractionCatalog `1.7.0` 逐字冻结保存，历史 Plan 继续精确回放。新目录
共有 21 个 action 和 13 项 semantic capability；InteractionCatalog 共有 21 个 recipe，其中 7 个
`native_path`、14 个 `semantic_path`。

此动作不接受部分面选择、不修改原 Mesh datablock、不处理已有 Modifier 或 Shape Key，也不开放
BEAUTY、ALTERNATE、SHORT_EDGE 等 quad 方法或 BEAUTY ngon 方法。需要这些行为的目标必须保留为
actionless/manual。
