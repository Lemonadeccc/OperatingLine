# ADR 0008：有界刚性骨架与姿态关键帧

- 状态：已接受
- 日期：2026-08-05

## 背景

雪人垂直切片此前能建模、赋材质和渲染，但不能证明 GuidePlan 可以表达时间轴动作，也不能让
`Back` 安全补偿 Blender Armature、Action、对象父子关系和姿态状态。直接开放任意 `bpy`、自动
权重或任意 operator 会越过 ActionCatalog 的安全边界，也难以在用户后续编辑后可靠回退。

## 决策

Blender ActionCatalog `1.1.0` 增加两个可复用、严格校验的 action：

- `blender.rig.create_armature`：创建 1–32 个具名骨骼；父引用必须存在且无环；把 1–64 个既有、
  自有且未被父级占用的 Mesh object 以 rigid bone parenting 绑定，同时保持世界矩阵。
- `blender.animation.create_pose_keyframes`：为一个自有 Armature 创建一个自有 Action，在 2–64 个
  严格递增的显式帧写入具名 pose bone 的 XYZ Euler 旋转；每个通道限制为 ±2π。

`blender.render.execute_preview` 同时增加必填 `frame`，使计划明确决定用于预览和评测的姿态。
`snowman-demo` revision 4 在第 1、20、40 帧写入休止、挥手、休止姿态，并渲染第 20 帧。

执行器只使用计划声明的资源 ID、名称、骨骼、绑定和数值，不接受脚本、表达式、任意 operator、
任意文件路径、权重绘制或 modifier。Armature 编辑模式切换属于适配器内部实现细节，进入前保存并
在退出后恢复活动对象、选择和模式。

## 补偿与冲突边界

receipt 新增 `ARMATURE` 与 `ACTION` 精确资源身份，并记录三类 compare-and-restore mutation：

- 绑定对象的父级、父类型、父骨、`matrix_parent_inverse` 和 `matrix_basis`；
- Armature 的 Action 赋值及此前是否存在空 animation data；
- 每个受影响 pose bone 的 rotation mode 与 Euler 值。

回退先完成零写入预检，再按反序解除 Action、恢复 pose 和对象父级，最后删除自有 Action、Armature
object 与 data。Action 被其他对象引用、Armature data 有外部用户、绑定或 Action 关系已被改变时，
回退保留 receipt 并显式失败。执行中途异常使用同一补偿路径，不留下部分 Action 或 Armature。

## 后果

- 任务树第一次覆盖可检查的时间轴输出，Next/Back 仍保持逐步语义。
- catalog `1.0.0` 保留用于旧证据精确回放；`1.1.0` 成为默认版本。
- Blender 4.5 LTS 与 5.1 使用不同 Action 内部 API，因此 observation 不遍历版本相关的 FCurve
  容器；它验证精确 Action 赋值、骨骼集合与 `frame_range`。
- 当前能力不是 deform rig、自动权重、约束系统、NLA 编辑或任意动画生成。扩展这些能力必须发布
  新目录版本并分别设计观察和补偿契约。
