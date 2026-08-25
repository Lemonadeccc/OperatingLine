# ADR 0123：Pose Animation 插值与外推 RNA 写入证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0112](0112-pose-animation-operation-level-mcp.md)、[ADR 0122](0122-pose-animation-rna-keyframe-insertion-evidence.md)

## 背景

Pose Animation operation 09 会逐个设置 Action 中所有 keyframe point 的 interpolation，operation 11 会逐条设置
FCurve extrapolation。此前 Observation 只保存两个完成布尔值和最终 Action signature；它能证明最终曲线一致，却
不能表达循环内部每个真实 RNA property write 的目标、顺序、before/accepted/observed 值，也不能在 Guided
Control 中显示对应的叶内 `.01…` 操作。

## 决策

operation 09 与 11 统一产生严格 `rnaAnimationPropertyWrites`，但使用两个互斥 mutation kind：

- `keyframe_interpolation_write`：按 accepted keyframes 首次出现的 bone/channel/component 曲线顺序，再按 frame
  顺序保存每个关键帧点；记录默认 `BEZIER`、accepted/observed interpolation 和实际点值。
- `fcurve_extrapolation_write`：沿同一曲线顺序保存每条 FCurve；记录默认 `CONSTANT`、accepted/observed
  extrapolation 和该曲线的实际关键帧点数量。

每条记录还绑定固定 MCP、源 operation、armature/action logical ID、实际 Action Name、bone、Blender data path、
component index 与稳定 UI 语义路径。执行器在写入前验证默认基线，在写入后立即回读；基线或回读漂移会触发既有
补偿和指纹恢复门。

协议固定两种 variant 的字段、component 范围、before 值、accepted/observed 一致性、连续 order、单一
operation/resource identity 和 UI path。Runtime 只从 accepted replay 的 keyframes、interpolation、extrapolation
及 action identity 独立派生当前数组，并执行 canonical equality。字段对历史结果保持可选，但所有新派发
operation 09/11 必须分别提供非空、同 kind 的精确数组，其他 operation 必须为空。调用方不能提交曲线、点、
属性值、RNA 或任意 Python。

Guided Control 在对应 operation 聚焦时显示 `ANIMATION RNA`：operation 09 逐行显示 bone、channel component、
frame 与 interpolation，operation 11 显示 curve component 与 extrapolation。该轨迹证明 Blender 数据模型写入，
不声称执行了 Dope Sheet、Graph Editor、Channel 菜单或逐像素控件点击。

## 结果与边界

- 当前三骨骼测试轨迹在 operation 09 形成 87 条真实 keyframe point interpolation 写入，在 operation 11 形成
  29 条真实 FCurve extrapolation 写入，并与 operation 07 的 27 次插入/87 点证据使用同一 accepted curve 顺序。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 逐项验证所有 write；双版本 Companion E2E 均通过
  Runtime 派生核对、完整 checkpoint lineage 与强 Observation，并拒绝结构合法但 action identity 被篡改的
  动画属性收据。
- 本决策只覆盖固定 Pose Animation recipe 的 operation 09/11；handle/easing、曲线编辑、NLA、约束、驱动器、
  真实菜单与快捷键仍需分别扩展。Action 创建/绑定/改名已由
  [ADR 0124](0124-pose-animation-action-resource-evidence.md) 单独展开。
