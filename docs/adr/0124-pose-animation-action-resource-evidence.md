# ADR 0124：Pose Animation Action 创建、绑定与改名证据

- 状态：Accepted
- 日期：2026-08-25
- 补充：[ADR 0112](0112-pose-animation-operation-level-mcp.md)、[ADR 0122](0122-pose-animation-rna-keyframe-insertion-evidence.md)、[ADR 0123](0123-pose-animation-rna-property-write-evidence.md)

## 背景

Pose Animation operation 04 创建受管 pending Action 并绑定到 Armature，operation 05 再把它改为 accepted
Action Name。原有 resource receipt、ownership、fingerprint 与 Undo lineage 能证明整体副作用和恢复关系，但没有
把 `Action create → Armature bind → Action.name write` 的真实顺序、pending identity、返回资源类型与 UI 语义路径
保存为严格叶内数组。

## 决策

operation 04/05 现在产生 `rnaActionResourceMutations`：

1. operation 04 `.01` 使用 `blender_rna_action_create` 创建由 leaf receipt UUID 前八位确定的
   `OperatingLine.PendingPose.<token>` Action，并回读 RNA resource type `Action`；
2. operation 04 `.02` 使用 `blender_rna_armature_action_bind`，证明目标 Armature 的 active Action 是同一返回对象；
3. operation 05 `.01` 使用 `blender_rna_action_name_write`，保存 pending before、accepted Action Name 与实际
   observed name。

每条记录绑定固定 MCP、源 operation、armature/action logical ID、实际名称、成功标记与稳定 UI path。协议固定
create-before-bind 两条序列或单条 rename variant，并校验 pending name 格式、跨记录 identity、accepted/observed
名称与 UI path。Runtime 从 durable operation progress 的唯一 receipt ID 和 accepted replay 的 action arguments
独立派生当前数组，再执行 canonical equality。为此连续 operation result 还必须保持同一 receipt ID；恢复校验复用
同一已持久化 ID。字段对历史结果保持可选，但新派发 operation 04/05 必须提供精确数组，其他 operation 必须为空。

Guided Control 在 operation 04 显示 `ACTION RESOURCE RNA` 下的 `.01 ACTION RNA → .02 BIND RNA`，在 operation
05 显示 `.01 NAME RNA` 与 accepted 名称。执行前 pending UUID 尚未产生时，UI 明示 managed pending Action；实际
UUID 名称完整保存在执行收据中。该轨迹证明 Blender 数据模型 mutation，不声称点击了 Action Editor、Action
selector 或 Name 控件。

## 结果与边界

- 固定 Pose Animation recipe 的五个真实变更 operation 04/05/07/09/11 现在都具有各自的严格叶内 RNA 数组；
  receipt、数据模型 mutation 和最终强 Observation 形成连续证据链。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 均逐项验证 Action 返回对象、绑定、名称、12 次正向/
  逆向、重放和完成；双版本 Companion E2E 均通过 Runtime 派生核对、完整 checkpoint lineage，并拒绝结构合法
  但 action identity 被篡改的资源收据。
- 本决策只覆盖固定 Pose recipe 的 Action create/bind/name；Action slots/layers、NLA、约束、驱动器、任意动画、
  真实菜单、快捷键和逐像素控件仍需分别扩展。
