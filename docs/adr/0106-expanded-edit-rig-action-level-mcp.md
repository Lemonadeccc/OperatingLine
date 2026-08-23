# ADR 0106：扩展 Edit、骨骼、权重与动画 Action-level MCP

- 状态：Accepted
- 日期：2026-08-23

## 背景

ActionCatalog `1.22.0` 已包含六个受管 replacement-mesh Edit 动作，以及创建骨架、显式蒙皮权重和姿势关键帧
动作；它们都有有界参数、补偿回退和 Companion Observation。InteractionCatalog `1.42.0` 仍只允许七个
Primitive、Mirror 与 Solidify 进入通用 action-level MCP executor。

这些受管动作不能被 Blender 原生菜单或快捷键直接等同替换：Edit 动作复制、标记并交换 Mesh datablock，骨架、
权重和动画动作则把多个 RNA 变更作为一个受管事务提交。原生 UI 通常就地修改当前数据，也不携带 OperatingLine
logical identity、receipt、Observation gate 或补偿合同。

## 决策

冻结 `interaction-catalog-1.42.0.json`，发布仍绑定 ActionCatalog `1.22.0` 的 InteractionCatalog `1.43.0`。
新版本只新增以下九个 action-level MCP projection：

- `blender.mesh.edit_subdivide`
- `blender.mesh.edit_triangulate`
- `blender.mesh.edit_extrude_region`
- `blender.mesh.edit_bevel_edges`
- `blender.mesh.edit_inset_faces`
- `blender.mesh.edit_poke_faces`
- `blender.rig.create_armature`
- `blender.rig.bind_skin_weights`
- `blender.animation.create_pose_keyframes`

公开的 `operatingline.blender.action.execute` 仍只接收 replay identity 与当前 Companion state CAS。Runtime 从不可变、
已人工接受且已 Start 的 replay binding 派生动作和完整参数；调用方不能提交 Action 名、参数、Python、operator、Plan
ID 或 step ID。Companion 和 Runtime 使用显式 action→recipe 映射，不再按命名前缀猜测 `.native` 或 `.semantic`。

九个动作的 replay Observation 使用完整 accepted action 参数，并增加固定、严格的证据形状：

- Edit：唯一 receipt、target→result Mesh 绑定、受管名称、源/结果 topology、内容摘要、操作专属 topology invariant
  与有界计数；
- Armature：对象和 data ownership、完整 bone head/tail/parent、binding 和 receipt；
- Skin weights：逐顶点完整权重、deform bone、Armature modifier 固定属性、Mesh 内容 guard 和 receipt；
- Pose animation：稀疏 keyframe/pose/channel 的精确 FCurve、值、插值、外推、Action ownership、内容 guard 和
  receipt。

额外字段、旧的弱参数形状、缺失/假 invariant、错误 identity、内容篡改、非有限值或 topology 越界均不能形成 replay
attestation。成功仍必须连接人工 decision、可信 Companion receipts、精确 executable prefix 和 Start/Next 原生 Undo
checkpoint；失败继续进入既有补偿、恢复与重规划边界。

## Blender 源码参考策略

菜单、快捷键和 operator/RNA 映射必须参考与目标 Host 版本一致的 Blender 官方来源：

- [`space_view3d.py` 4.5.3](https://github.com/blender/blender/blob/v4.5.3/scripts/startup/bl_ui/space_view3d.py)
  与 [`space_view3d.py` 5.1.1](https://github.com/blender/blender/blob/v5.1.1/scripts/startup/bl_ui/space_view3d.py)
  等 UI 声明用于核对菜单层级和上下文；
- [`blender_default.py` 4.5.3](https://github.com/blender/blender/blob/v4.5.3/scripts/presets/keyconfig/keymap_data/blender_default.py)
  与 [`blender_default.py` 5.1.1](https://github.com/blender/blender/blob/v5.1.1/scripts/presets/keyconfig/keymap_data/blender_default.py)
  用于核对默认 keymap 与别名；
- operator 实现、RNA 定义、官方 Python API 和运行时 RNA/keymap introspection 共同确定参数、默认值及上下文限制。

目录当前验证范围保持 `>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0`，具体探针以 Blender `4.5.3` 和 `5.1.1` 为基线。
项目不复制或内置整套 Blender 源码；只保存版本化目录事实、来源链接、运行时探针和测试证据。这样既保持许可证与仓库
边界，也避免把某一 Blender 版本的菜单或 keymap 当成永久事实。

## 结果

- 通用 action-level MCP 的有界集合从九个动作扩大到十八个，历史 InteractionCatalog 不继承新权限。
- Subdivide、Bevel、Inset 和 Poke 的原生快捷键轨迹仍是 `candidate_only` 教学投影；它们不证明受管事务等价。
- 其余新动作的 menu/shortcut 继续 unavailable，直到有独立的逐控件执行和 Observation 证据。
- 本决策没有开放任意 Blender 菜单、快捷键、MCP、骨骼动画或 Geometry Nodes；未列入显式 allowlist 的动作继续
  fail closed。
