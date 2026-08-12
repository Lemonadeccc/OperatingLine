# ADR 0032：有界显式蒙皮权重与 Pose Transform 动画

- 状态：已接受
- 日期：2026-08-12

## 背景

[ADR 0008](0008-bounded-rigid-rig-animation.md) 只允许 rigid bone parenting 和 XYZ Euler rotation
关键帧。它能验证时间轴、Armature、Action 与安全补偿，但不能表达 Mesh deformation；目录也明确
排除了权重绘制、自动权重、location/scale channel 和插值策略。

直接调用 Blender 自动权重或开放任意 Weight Paint/operator 会让结果依赖选择、模式、拓扑与隐式
启发式，无法由 Plan 复现，也无法在用户编辑后安全补偿。因此本次扩展只接受完整、显式、受上限约束
的数据，并继续把自动推断留在允许列表之外。

## 决策

Blender ActionCatalog `1.9.0` 新增 `blender.rig.bind_skin_weights`：

- 目标必须是既有自有、未父级的 Mesh，且不超过 8192 个顶点；Armature 必须由更早的目录动作创建。
- `weights` 必须恰好覆盖 `0..vertex_count-1`，每个索引只出现一次。
- 每个顶点允许 1–8 个唯一具名骨骼影响；骨骼必须存在，每个权重位于
  `[0.000001, 1]`，权重和以 `1e-6` 绝对容差等于 1。
- 执行器按骨名创建 Vertex Group，把引用骨骼设为 `use_deform=true`，并创建一个自有 Armature
  Modifier。`preserveVolume` 是显式布尔参数；Vertex Group deformation 开启，bone envelope 关闭。
- 不调用 automatic weights、Weight Paint、任意脚本、任意 operator 或未声明 modifier。

现有 `blender.animation.create_pose_keyframes` 在新目录版本中向后兼容扩展：

- `rotationEuler` 仍必填且限制为 ±2π；每个 pose 可选 local `location` 与正 `scale`。
- action 可选统一 `BEZIER | LINEAR | CONSTANT` interpolation，默认 `BEZIER`；可选
  `CONSTANT | LINEAR` extrapolation，默认 `CONSTANT`。
- 仍只允许 2–64 个严格递增帧、1–32 个具名 pose bone，并创建一个自有 Action。

InteractionCatalog `1.6.0` 为显式权重增加 `semantic_path`。它解释 Vertex Group、Weight Paint 概念和
Armature Modifier，但不伪装成一个可精确点击的原生事务。

## Receipt、观察与回退

Skin receipt 记录三类 mutation：

- 每个引用骨骼原来的 `use_deform`；
- action 创建的 Vertex Group 顺序、名称、lock 状态、顶点数和每个实际存储的 `(vertex, weight)`；
- Armature Modifier 的 stack、名称、类型、全部可写标量属性与精确 Armature identity。

`skin_weights_ready` 从 receipt 定位权重和 modifier，验证目标/Armature identity、完整顶点组快照、
deform bone、Vertex Group deformation、关闭的 envelope 与 `preserveVolume`。外部改变任一权重、组顺序、
modifier 属性或骨骼标志都会让 compare-and-restore 失败；`Back` 保留现场和 receipt，不覆盖用户修改。

Pose receipt 现在保存每个受影响 bone 的 rotation mode、location、rotation 和 scale；Action signature
继续冻结全部 FCurve、frame、handle、interpolation 与 extrapolation。回退先做零写入预检，再解除
Action、恢复完整 pose transform，并删除自有 Action。

中途失败使用同一补偿路径。权重组尚未形成正式 mutation 时由局部事务精确删除；mutation 已形成后
统一交给 receipt rollback。Blender 原生 Undo/Redo 继续复用 Scene checkpoint：Vertex Group 快照不依赖
RNA pointer，Armature Modifier 和 ID identity 则由现有 native-history rebind 恢复。

## 验证

Blender 4.5.3 LTS 与 5.1.1 的真实集成测试覆盖：

- 非归一化、重复顶点与不完整覆盖拒绝；
- 注入第二次权重写入失败后零残留；
- 8 顶点、两骨骼、混合权重、Armature Modifier 与 observation；
- 两骨骼 × 三 transform channel × 三轴共 18 条 FCurve，Linear interpolation/extrapolation；
- frame 1 → 10 的真实 evaluated mesh deformation 与 frame 20 回到 rest；
- 外部权重修改阻止回退，恢复后可重试；
- 完整反向遍历恢复 deform 标志并删除全部 action-owned 资源。

## 后果与边界

- Provider 可以生成可审查、可复现的 deform rig 数据，而不是要求宿主运行启发式自动权重。
- 历史 ActionCatalog `1.8.0` 与 InteractionCatalog `1.5.0` 保持不可变并可精确回放。
- 8192 × 8 是当前内存 receipt 与同步执行上限，不是 Blender 本身的上限。
- 当前仍不提供自动权重、任意 Weight Paint stroke、bone envelope 混合、constraints、drivers、shape
  keys、NLA、动作分层/混合或任意动画曲线编辑；这些能力需要新的目录、观察和补偿契约。
