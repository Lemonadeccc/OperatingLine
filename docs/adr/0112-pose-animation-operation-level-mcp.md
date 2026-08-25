# ADR 0112：Pose Animation 逐操作 MCP 与稀疏变更收据

- 状态：Accepted
- 日期：2026-08-24

## 背景

InteractionCatalog `1.52.0` 已把 Pose Animation 表达为八个有序语义步骤和四个就地值，`1.54.0` 又加入
Axis-Angle。完整 keyframe JSON 已保存 frame、bone、旋转表示、location 和 scale，Action Name、Interpolation
与 Extrapolation 也位于各自消费位置；但当前目录仍通过一次 whole-action MCP 执行全部动画。MCP 客户端因此无法
沿 Blender 内可见的 `01→12` rail 逐项推进、后退或核对中间状态。

Pose rail 与 Transform Geometry、Light Trails 的区别是变更稀疏。工作区、编辑器、模式、operator/control 提示和
最终验证必须继续出现在教学轨迹中，却不能伪造为原生按钮点击，也不应为没有改变 Blender 数据的步骤制造资源变更。

## 决策

冻结 `interaction-catalog-1.55.0.json`，发布仍绑定 ActionCatalog `1.26.0` 的 InteractionCatalog `1.56.0`。
当前 Pose Animation recipe 的 menu 与 shortcut 保持 unavailable；MCP materialization 改为
`catalog.operation_level_mcp`，固定工具为：

- `operatingline.blender.animation.pose-keyframes.execute-next`
- `operatingline.blender.animation.pose-keyframes.status`

公开 execute 请求严格只有 `formatVersion`、`requestId`、`replayId` 和 `expectedState`。Runtime 从不可变 accepted
replay、目录 materialization 和已经认证的成功前缀派生唯一下一 ordinal、operation ID 与参数。调用方不能提交
action、leaf、ordinal、Action/Armature identity、关键帧、插值、外推、RNA、Python 或原生 UI 坐标。

固定轨迹为：

1. Animation workspace 上下文与 `actionId`/`armatureId` authority 预检；
2. Action Editor 上下文；
3. Pose Mode 上下文；
4. 创建由 receipt 管理的空 Action；
5. 写入已接受的 Action Name；
6. Insert Keyframe operator 上下文；
7. 以 `json_identity` 原样写入完整有序 keyframes；
8. Interpolation control 上下文；
9. 把已接受 interpolation 应用于全部关键帧点；
10. Extrapolation control 上下文；
11. 把已接受 extrapolation 应用于全部 FCurve；
12. 运行最终强 Observation。

只有 04、05、07、09、11 改变 Blender 数据。01–03、06、08、10、12 是真实校验或教学上下文，不声明逐像素
菜单/快捷键/控件执行。会话在 01–03 不持久化 partial aggregate receipt；04 创建 Action 后才开始保存资源收据。
每个 ordinal 仍形成连续 operation result、before/after fingerprint 和 `guided_pose_operation` Observation，后退时按
LIFO 逆序撤销，跨越 receipt-free 前缀时从已证明状态确定性重放这些无变更操作。

07 写入失败时清空回到受管 Action，09/11 失败时恢复 Blender 默认 interpolation/extrapolation，04/05 分别删除或
恢复 pending Action 名称；若补偿不能恢复原指纹，执行进入原子性故障而不是继续。12 只有在完整
`pose_animation_ready` 同时证明参数、资源 ownership、曲线、值、Action 内容与 receipt 一致后，才把 partial
receipt 提升为正式 leaf receipt 并发布唯一 `step_succeeded` report。

## 原生 Undo 与恢复

本地 Guided Control 支持 Operation Back、Abort、整叶 Back 与 Blender 原生 Undo/Redo。远程最终结果必须携带从
accepted replay 授权起点经过全部 12 项操作的唯一 checkpoint lineage；Runtime 校验起点、链长、唯一性和末端边。
已经派发但尚未确认的 ordinal 不会自动重放，只能沿共享 leaf-operation recovery 协议证明前缀已恢复、操作已应用，
或在同一 document incarnation 且 Companion session 已更换时隔离失去进程内证据的文档。

历史 InteractionCatalog 保留其原有 atomic Pose action-level 权限，不继承 `1.56.0` 的逐操作轨迹；当前 Pose replay
也不能降级发送到通用 action executor。

## 验证

协议、目录、MCP runtime、Companion transport、session 与 Blender operator 测试固定 12 个唯一 operation ID、
严格参数位置、`json_identity` keyframe 结构、稀疏 mutation ordinals、连续前缀、错误 profile/status 拒绝、最终
Observation 和 checkpoint lineage。

真实 Blender 4.5.3 LTS 与 5.1.1 测试均完成：

- accepted Proposal、Start、依赖对象和 Armature 叶后，连续 12 次 MCP delivery/result/ACK；
- 三根骨骼的 Euler、Quaternion、Axis-Angle、location 与 scale 生成 29 条 FCurve、87 个关键帧点；
- 全部关键帧点使用 LINEAR interpolation，全部曲线使用 LINEAR extrapolation；
- 12 项 operation receipt、强 `pose_animation_ready`、receipt ownership、Action 内容和完整 Undo lineage 均通过；
- 隐藏 ordinal、错误 operation profile 和错误 status 查询均被拒绝；本地测试另覆盖 12 步逆序、重放和整叶 Back。
- operation 07 已进一步拆为 27 条严格 `rnaKeyframeInsertions`，逐次保存 frame/pose/channel 顺序和 87 个实际
  FCurve 点回读，见 [ADR 0122](0122-pose-animation-rna-keyframe-insertion-evidence.md)。
- operation 09/11 已进一步拆为 87 条 keyframe interpolation 与 29 条 FCurve extrapolation 严格 RNA 写入，见
  [ADR 0123](0123-pose-animation-rna-property-write-evidence.md)。
- operation 04/05 已进一步拆为 Action create/bind 与 accepted-name write 严格资源 mutation，见
  [ADR 0124](0124-pose-animation-action-resource-evidence.md)。

## 结果与边界

Codex 或其它 MCP 客户端现在可以沿可视 ProcedureTree 远程执行 Pose Animation `01→12`，具体参数留在消费它们的
步骤中，而不是一次性生成任意 Blender Python 后只展示结果。该能力只授权当前有界 Pose Action recipe；它不证明
Animation workspace、Action Editor、Pose Mode、Insert Keyframe 或属性控件的原生点击，不覆盖任意骨架、权重、
NLA、约束、驱动器、复杂动画编辑，也不扩大其它 menu/shortcut 或 Geometry Nodes 的执行权限。
