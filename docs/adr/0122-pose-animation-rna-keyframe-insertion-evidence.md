# ADR 0122：Pose Animation 逐调用关键帧插入证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0112](0112-pose-animation-operation-level-mcp.md)

## 背景

Pose Animation operation 07 已把完整 keyframes 参数交给受管执行器，并通过最终 Action signature、29 条 FCurve、
87 个关键帧点和强 Observation 证明结果正确。Guided Control 仍只显示一块完整 JSON；中间实际执行的每次
`PoseBone.keyframe_insert` 没有按 frame、pose、channel 保存顺序，也没有把 accepted component 值与 Blender
创建的 FCurve 点逐项绑定。因此树能说明“写入关键帧”，但还不能呈现叶内 `07.01 → 07.27` 的具体操作轨迹。

## 决策

operation 07 现在按 accepted keyframes 的原始顺序执行并保存 `rnaKeyframeInsertions`。顺序固定为：

1. keyframe 数组顺序；
2. 每帧内 pose 数组顺序；
3. 每个 pose 内 rotation 通道优先，其后是存在的 location、scale。

每次 `PoseBone.keyframe_insert` 形成一条记录，包含全局 order、frame/pose/channel order、固定 MCP 与源 operation、
armature/action logical ID、实际 Action Name、frame、bone、Blender data path、完整 accepted values、实际回读的
FCurve component index/frame/value、成功标记和稳定 UI 语义路径。执行器在调用返回后查找精确 bone data path、
全部 component FCurve 和当前 frame 的唯一点；缺曲线、缺 component、重复点或值漂移都会使该 operation 失败并
回到空 Action。

协议限制 data path、每通道 3/4 个 component、component 顺序、accepted/observed 一致性、UI path、跨记录资源
identity 以及连续 frame/pose/channel 顺序；最大 6,144 条对应 accepted action 的 64 frames × 32 poses ×
3 channels 上界。Runtime 只从 accepted replay 的 keyframes 与 action identity 独立派生期望数组，并执行
canonical equality。字段对历史结果保持可选，但所有新派发 operation 07 必须提供非空精确数组，其他 operation
必须为空；调用方不能提交关键帧 evidence、ordinal、RNA 或任意 Python。

Guided Control 在 operation 07 聚焦时显示 `KEYFRAME RNA`，逐行呈现 `.01…` 的 bone、data path、frame 与
accepted values。它是 OperatingLine 自有教学控件中的数据模型轨迹，不声称在 Dope Sheet、Action Editor、
Pose Mode 或 Insert Keyframe 菜单中执行了逐像素点击。

## 结果与边界

- 当前三骨骼测试轨迹形成 27 次真实 `PoseBone.keyframe_insert` 调用，逐项回读 29 条 FCurve 上的 87 个点；
  Euler、Quaternion、Axis-Angle、location 与 scale 均在同一严格数组内表达。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均通过 12 次正向/逆向、重放和完成；双版本 Companion
  E2E 均通过 Runtime 派生核对、完整 checkpoint lineage 与强 Observation，并拒绝结构合法但 action identity
  被篡改的关键帧收据。
- 本决策只覆盖固定 Pose Animation recipe 的 operation 07；Action 创建/改名、任意骨架动画、约束、驱动器、
  NLA、Graph Editor 操作、真实菜单和快捷键仍需分别扩展。operation 09/11 的 interpolation/extrapolation 已由
  [ADR 0123](0123-pose-animation-rna-property-write-evidence.md) 单独展开。
