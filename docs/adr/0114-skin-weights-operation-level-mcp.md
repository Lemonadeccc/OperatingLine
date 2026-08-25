# ADR 0114：Skin Weights 逐操作 MCP、显式权重与 Modifier 状态证明

- 状态：Accepted
- 日期：2026-08-24

## 背景

`blender.rig.bind_skin_weights` 已能原子写入完整、归一化的逐顶点权重并创建受管 Armature Modifier，但历史
whole-action MCP 不能把权重表、Preserve Volume 和 Modifier Name 放在各自实际生效的叶内步骤，也不能让
Blender 中的 `01→09` Guided Control 与远程 MCP 使用同一条 operation rail。

真实提案 E2E 还发现 ActionCatalog `1.26.0` 把 `modifierId` 声明为 `mutate`，而执行器实际创建该资源。这会让
planning quality gate 错误要求一个预先存在的 Modifier creator。历史目录必须保持不可变，因此不能原地修改。

## 决策

冻结 `action-catalog-1.26.0.json`，发布 ActionCatalog `1.27.0`，唯一行为差异是把 Skin Weights 的
`ARMATURE_MODIFIER` resource effect 从 `mutate` 修正为 `create`。冻结 `interaction-catalog-1.57.0.json`，发布
绑定 ActionCatalog `1.27.0` 的 InteractionCatalog `1.58.0`。当前 Skin Weights recipe 的 menu 与 shortcut 仍为
unavailable；MCP materialization 改为固定的 `catalog.operation_level_mcp`：

- `operatingline.blender.rig.skin-weights.execute-next`
- `operatingline.blender.rig.skin-weights.status`

公开 execute 请求只接受 `formatVersion`、`requestId`、`replayId` 和 `expectedState`。Runtime 从不可变 accepted
replay、当前目录和已认证前缀派生下一 ordinal、operation ID 与参数；调用方不能提交 action、leaf、ordinal、权重、
骨骼、Modifier、RNA、Python、坐标或 Blender operator。

固定轨迹为：

1. 验证 Layout 以及 `targetId`、`armatureId`、`modifierId`；
2. 呈现 Object Data / Vertex Groups 上下文；
3. 呈现 Weight Paint 上下文；
4. 验证完整归一化权重上下文；
5. 以 `json_identity` 写入覆盖每个顶点的权重并启用被引用骨骼的 `use_deform`；
6. 呈现 Armature Modifier 上下文；
7. 创建 pending 名称的 receipt-owned Armature Modifier，并应用 `preserveVolume`；
8. 写入已接受的 `modifierName` 并刷新 receipt identity；
9. 运行最终强 `skin_weights_ready` Observation。

只有 05、07、08 改变 Blender 数据；01–04 保持 receipt-free。05 之后保存包含顶点组、权重、骨骼 deform flags 和
Mesh content guard 的 partial receipt。07/08 把 Modifier 状态合并进同一叶 receipt。每个 ordinal 都产生连续的
pointer-free fingerprint、`guided_skin_weights_operation` Observation 和严格前缀；变更失败必须补偿回执行前状态。

## Undo、恢复与状态证明

本地 Guided Control 支持 Operation Back、Abort、整叶 Back 与 Blender 原生 Undo/Redo。反向操作严格 LIFO：先恢复
Modifier 名称，再移除 Modifier，最后清除顶点组并恢复骨骼 `use_deform`。原生恢复后通过 receipt ownership 标记重新
绑定目标、Armature、Mesh、骨骼和 Modifier，并重新验证阶段、完整权重覆盖与指纹。

远程最终结果必须携带从 accepted replay 授权起点经过九项操作的唯一 native Undo checkpoint lineage。Runtime 校验
profile 长度、唯一边和终态 checkpoint。已派发但结果不确定的操作不自动重放，继续使用共享 leaf-operation recovery
协议证明前缀已恢复、操作已应用，或隔离丢失进程内证据的 document incarnation。

## 验证

协议、目录、物化、MCP runtime、Companion、session 与 Blender 测试固定九个 operation ID、参数位置、05/07/08
mutation ordinals、连续指纹、错误执行器/profile/status 拒绝、强 Observation 和 checkpoint lineage。

Blender 4.5.3 LTS 与 5.1.1 均完成：

- 本地九步前进、逐步逆向、确定性重放、最终 promotion 和整叶 Back；
- 远程 accepted Proposal、三个依赖叶和连续九次 MCP delivery/result/ACK；
- 八顶点完整覆盖、两个精确骨骼顶点组、`use_deform`、Preserve Volume 和精确命名 Armature Modifier；
- 九项 operation receipt、强 `skin_weights_ready`、ownership/content proof 与原生 Undo lineage；
- 隐藏 ordinal、whole-action executor、错误 operation profile 和错误 status 查询全部被拒绝。

## 结果与边界

MCP 客户端现在可以沿可视 ProcedureTree 执行 Skin Weights `01→09`，并在实际消费位置看到完整权重、Preserve
Volume 与 Modifier Name。这仍是受管 mesh、完整显式归一化权重和单一 Armature Modifier 的有界 recipe；它不冒充
Object Data、Weight Paint 或 Modifier 面板的逐像素原生点击，也不覆盖自动权重、刷权重、任意顶点选择、多 Modifier
堆栈、复杂蒙皮修正或完整 Blender 菜单空间。
