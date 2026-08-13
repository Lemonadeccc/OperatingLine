# ADR 0041：有界连通面区域 Extrude

- 状态：已接受
- 日期：2026-08-13

## 背景

ActionCatalog `1.11.0` 已能对整网格执行 Subdivide 和 Triangulate，但不能表达 Blender 建模中常见的
面区域挤出。直接开放 Edit Mode 当前选择、任意 operator 参数或屏幕上下文，会使 Provider 输出依赖
不可重放的宿主状态，也无法在执行前证明拓扑、观察和回退边界。

## 决策

ActionCatalog `1.12.0` 新增 `blender.mesh.edit_extrude_region`。调用方必须提供 `targetId`、
`resultMeshId`、`resultMeshName`、`polygonIndices` 和 `translation`。`polygonIndices` 是 1–256 个唯一、
零起始的源 Mesh polygon index；执行器要求它们形成一个 edge-connected region，至少存在一条区域
边界边，且选中边不能是 non-manifold。`translation` 是 Mesh 局部空间三维向量，各分量限制在
`-1000..1000`，欧氏长度限制在 `0.0001..1000`。严格参数方言新增通用
`vectorLengthMinimum` / `vectorLengthMaximum`，因此 Orchestrator 在 Proposal 校验阶段即可拒绝零向量
和总长度超限向量。

目标必须是自有 Mesh、处于 Object Mode、没有 Modifier 或 Shape Key。源和结果都不得超过 8192
vertices、16384 edges 和 8192 polygons。执行器复制源 Mesh，在副本 BMesh 上解析稳定面索引，把选中
面、边、点作为一个 region 执行 `extrude_face_region`，只对操作返回的新顶点执行固定 translation，
再把对象换链到新的自有 Mesh。所有动作创建的 Mesh 都记录内容基线，初始 Object→Mesh 关系也进入
receipt；蒙皮权重会发布同一 Mesh 的后继内容签名。因此执行前若源 Mesh 内容或对象 data link 已被
计划外修改，动作会在读取 polygon index 前失败。源 datablock 保持不变；任何阶段失败都必须删除临时
Mesh，且不能留下对象 mutation 或逻辑 ID。

Blender 的 `extrude_face_region` 返回顺序在相同版本的不同进程间也不稳定。执行器用一个临时整数层保存
源 vertex index；操作后先验证所有新顶点一一继承所选源顶点 provenance，再按“旧/新 + provenance”
规范化 vertex 顺序，按无向端点规范化 edge 顺序，按排序后的 vertex set 规范化 face 顺序。重复 key
视为歧义并失败；临时层在写回 Mesh 前删除。这保证后续 action 的 `polygonIndices` 在支持的 Blender
4.5/5.1 范围内稳定，连续 Extrude 仍可重放。等价 edge 方向与 face loop 起点不承诺逐字相同。

动作声明 OBJECT mutation 与 MESH creation，支持 `resource_exists` 和 `mesh_region_extruded` observation。
专用 observation 要求结果 Mesh 由唯一匹配的 Extrude receipt 创建、仍挂到目标、三类 topology 都比
源 Mesh 增长、结果在上限内且内容签名未被外部修改。它可作为 `success_gate + rollback_step`；正常
`Back` 使用 compare-and-restore，外部改动则 fail closed。相同 receipt/session snapshot 进入 Blender
原生 Undo/Redo 历史。

InteractionCatalog `1.9.0` 一一绑定 ActionCatalog `1.12.0`，为该动作提供独立 `semantic_path`，明确展示
Owned Mesh → Edit Mode → Face Region → Extrude Region，而不把上下文敏感的 Blender operator 伪装成
完整事务。

## 兼容性与后果

ActionCatalog `1.11.0` 与 InteractionCatalog `1.8.0` 逐字冻结保存，历史 Plan 继续精确回放。新目录
共有 22 个 action 和 14 项 semantic capability；InteractionCatalog 共有 22 个 recipe，其中 7 个
`native_path`、15 个 `semantic_path`。

此动作不读取当前选择，不接受 vertex/edge 选择、互不连通面组、封闭整网格、non-manifold 选中边、
法线方向距离、比例编辑、Individual Faces、已有 Modifier 或 Shape Key，也不开放任意 BMesh/operator
参数。需要这些行为的目标必须保留为 actionless/manual，或由后续独立目录版本增加新的有界动作。
