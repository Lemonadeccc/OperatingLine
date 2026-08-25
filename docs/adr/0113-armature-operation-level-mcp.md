# ADR 0113：Armature 逐操作 MCP、精确绑定与原生 Undo 证明

- 状态：Accepted
- 日期：2026-08-24

## 背景

`blender.rig.create_armature` 已有受管 whole-action 执行器，能一次创建 Armature object/data、骨骼层级和刚性
bone parenting，也能通过 receipt 与 `armature_ready` 验证最终状态。但这种原子调用不能让 MCP 客户端沿 Blender
内的可视 ProcedureTree 逐项推进，也不能把对象名、data 名、完整骨骼 JSON 和 binding JSON 放到消费它们的确切
步骤之后。

Armature rail 的变更同样稀疏：工作区、Edit Bones 上下文、Parent Parts 上下文和最终验证必须留在教学轨迹中，
但不能伪造为逐像素原生菜单点击。对象与 data 还会在中途改名，所以 operation receipt 必须在每次改名后重新绑定
精确的 Blender resource identity，不能依赖失效的名称或 RNA pointer。

## 决策

冻结 `interaction-catalog-1.56.0.json`，发布仍绑定 ActionCatalog `1.26.0` 的 InteractionCatalog `1.57.0`。
当前 Armature recipe 的 menu 与 shortcut 保持 unavailable；MCP materialization 改为
`catalog.operation_level_mcp`，固定工具为：

- `operatingline.blender.rig.armature.execute-next`
- `operatingline.blender.rig.armature.status`

公开 execute 请求严格只有 `formatVersion`、`requestId`、`replayId` 和 `expectedState`。Runtime 从不可变 accepted
replay、当前目录声明和已认证成功前缀派生唯一下一 ordinal、operation ID 与参数。调用方不能提交 action、leaf、
ordinal、骨骼、bindings、RNA、Python、屏幕坐标或任意 Blender operator。

固定轨迹为：

1. 验证 Layout、`armatureId`、`collectionId` 与 binding targets；
2. 创建 receipt-owned 的 pending Armature object/data；
3. 写入已接受的 Object Name，并重绑 object identity；
4. 写入已接受的 Data Name，并重绑 armature-data identity；
5. 呈现 Edit Bones 上下文；
6. 以 `json_identity` 创建完整有序 bones、head/tail 和 parent hierarchy；
7. 呈现 rigid-parent 上下文；
8. 以 `json_identity` 应用全部 target/bone bindings，同时保持 target world transform；
9. 运行最终强 `armature_ready` Observation。

只有 02、03、04、06、08 改变 Blender 数据。01、05、07、09 是真实预检、教学上下文或验证，不声明原生控件点击。
01 保持 receipt-free；02 创建资源后才保存 partial aggregate receipt。每个 ordinal 都产生连续 before/after fingerprint、
`guided_armature_operation` Observation 和严格的 operation prefix。变更步骤失败会补偿到执行前指纹；无法证明恢复时
进入原子性故障并停止后续变更。

## Undo、恢复与状态证明

本地 Guided Control 支持 Operation Back、Abort、整叶 Back 与 Blender 原生 Undo/Redo。反向操作严格 LIFO：先移除
bindings，再清除 bones、恢复 pending 名称，最后删除 object/data。原生恢复后，receipt 通过稳定 ownership 标记重新
绑定真实 Blender 资源，再验证精确阶段和指纹。

远程最终结果必须携带从 accepted replay 授权起点经过全部九项操作的唯一 native Undo checkpoint lineage。Runtime
校验起点、链长、唯一性和末端边。已派发但结果不确定的操作不会自动重放，只能通过共享 leaf-operation recovery
协议证明已恢复前缀、已应用终态，或隔离已经失去进程内证据的 document incarnation。

历史 InteractionCatalog 保留其冻结时的 Armature whole-action 权限，不继承 `1.57.0` 的逐操作轨迹；当前 Armature
replay 也不能降级到 `operatingline.blender.action.execute`。

## 验证

协议、目录、物化、MCP runtime、Companion、session 和 Blender 测试固定九个唯一 operation ID、参数位置、
`json_identity` 结构、稀疏 mutation ordinals、连续指纹、错误 profile/status 拒绝、最终 Observation 和 checkpoint
lineage。

真实 Blender 4.5.3 LTS 与 5.1.1 均完成：

- accepted Proposal、Start 和依赖对象后连续九次 MCP delivery/result/ACK；
- 两根精确命名骨骼、head/tail/parent hierarchy 和一个刚性 bone binding；
- 九项 operation receipt、强 `armature_ready`、resource ownership、bones/bindings 内容和原生 Undo lineage；
- 隐藏 ordinal、whole-action executor、错误 operation profile 和错误 status 查询全部被拒绝；
- 本地双版本测试另覆盖九步正向、九步逆向、确定性重放、最终 promotion 和整叶 Back。

## 结果与边界

Codex 或其它 MCP 客户端现在可以沿可视 ProcedureTree 远程执行 Armature `01→09`，具体名称、bones 与 bindings 保留
在消费它们的步骤中，而不是一次性运行任意 Blender Python 后只展示结果。这仍是一个有界、多骨骼、刚性 parenting
recipe；它不证明 Layout、Add Armature、Edit Mode 或 parenting 控件的逐像素原生点击，也不覆盖自动权重、Weight
Paint、复杂约束、IK、驱动器、任意 rig 或完整 Blender 菜单空间。
