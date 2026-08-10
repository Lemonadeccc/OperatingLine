# 场景 001：创建完整雪人预览

这是 OperatingLine 的第一条可执行产品场景规范。规范对应
`protocol/fixtures/v1/snowman-teaching.plan.json` 的 `snowman-demo` revision 5，用来冻结任务树、动作参数、
观察证据和回退边界；它不是要求 AI 每次都照抄的固定建模教程。
原 `snowman.plan.json` revision 4 只作为既有 Human Eval 套件的不可变历史输入保留。

## 用户目标

用户输入“创建雪人”后，可以按顺序理解、执行和回退以下过程：准备地面，建立三段身体，补充
面部、纽扣和手臂，应用材质，创建刚性骨架和挥手关键帧，创建隔离的渲染场景与灯光相机，
最后生成 PNG 预览。

```text
1 创建雪人
  1.1 准备场景
    1.1.1 创建地面
  1.2 建立基础模型
    1.2.1 创建身体下部
    1.2.2 创建身体上部
    1.2.3 创建头部
  1.3 添加角色细节
    1.3.1 创建脸部
      1.3.1.1–1.3.1.2 分别创建左右眼
      1.3.1.3 创建锥形鼻子
      1.3.1.4–1.3.1.8 分别创建五个嘴点
    1.3.2 创建纽扣
      1.3.2.1–1.3.2.3 分别创建三个纽扣
    1.3.3 创建手臂
      1.3.3.1–1.3.3.2 分别创建左右手臂
  1.4 应用材质
    1.4.1 应用雪材质
    1.4.2 应用煤、胡萝卜和木头材质组
    1.4.3 应用地面材质
  1.5 绑定并动画化雪人
    1.5.1 创建四骨骼 Armature 并刚性绑定头部组件与手臂
    1.5.2 在第 1、20、40 帧创建休止、挥手、休止姿态
  1.6 设置灯光与相机
    1.6.1 创建隔离的 Scene、World 和 Collection
    1.6.2 创建两个 Area Light 和一台相机
  1.7 渲染
    1.7.1 生成第 20 帧的 320 × 320 Eevee PNG 预览
```

## revision 5 已完成的协议范围

- 25 个可执行叶节点组成严格线性 DAG；每个叶节点只依赖前一个叶节点。
- 每个眼睛、鼻子、嘴点、纽扣和手臂都有独立 action、观察、receipt 与补偿边界；教学模式不再把
  多个可理解部件藏进一个 batch。
- 动作全部绑定 `blender` 适配器的通用 catalog，不包含雪人专用执行函数。
- 几何、材质、骨架、Action、场景、灯光、相机和渲染产物都通过稳定的逻辑资源 ID 关联。
- 所有 Blender datablock 名使用 `OperatingLine.` 命名空间，避免静默覆盖用户资源。
- 每个可执行叶节点都有语义锚点、可序列化的 `operatorId + menuPath` 操作参考、预期观察和
  `compensating_action` 回退声明；操作参考用于教学，不冒充数据 API 实际点击记录。
- 观察类型限定为 `resource_exists`、`material_assigned`、`armature_ready`、
  `pose_animation_ready`、`render_scene_ready`、`render_rig_ready` 和
  `render_artifact_exists`。
- 渲染参数只允许扩展管理的 `extension_temp` 目标，不接受任意文件路径。
- Fixture 同时经过 GuidePlan schema 和领域 DAG 校验；单元测试冻结步骤 ID、遍历顺序、阶段覆盖、
  动作 catalog、操作路径数组、观察类型、命名空间和无文件路径约束。

Blender Companion 对这些通用动作的实际执行与补偿必须由 Blender 集成测试验证。协议 fixture
只声明可执行契约，不以“JSON 能通过 schema”替代宿主侧行为验收。

## 本场景的运行验收

1. Blender Sidebar 和 Overlay 按上述编号显示当前步骤；蓝色完成、红色 Back、绿色 Next 和
   灰色锁定状态在前进与回退后保持同步。
2. 默认启动文件中的 Cube、Camera 和 Light 不因执行本场景被隐式删除。
3. 每次 `Next` 只执行当前叶节点；失败时停止后续步骤并回传错误证据。
4. `Back` 只补偿当前运行产生且 receipt 身份一致的资源，不按名称删除用户对象。
5. 完成第 25 步后，扩展管理的临时目录中存在第 20 帧 PNG 预览，并能通过逻辑 `renderId` 观察到。
6. 自有 Mesh/Material/Collection/Armature/Action 出现计划外用户或内容时，`Back` 在修改任何资源前拒绝执行，
   保留当前步骤与 receipt；解除冲突后可重试并完整回退。
7. 节点引用可以连续提交两轮：第二轮必须继承首轮 thread、以首轮 Proposal 为完整 base，并在
   Blender 接受前显示精确 Plan diff；两轮请求与预览都不改变场景。

## 后续产品能力（本次不包含）

- **任意目标的完整 Blender 能力**：当前 Planner 可以生成目录约束的任务树，但目录尚未覆盖
  Cube/Icosphere/Torus、Edit Mode、Modifier、Sculpt、UV 和 Geometry Nodes 等工作流。
- **修订工作区增强**：在已完成的线性多轮 thread 与 Plan diff 上增加完整消息历史、分支/合并策略
  和参数编辑。
- **人工确认策略**：对高风险动作、失败重试和无法补偿的步骤提供明确审批点。
- **Eval 评分与训练治理**：在已完成的原始证据导出之上增加脱敏、同意、保留、质量指标和数据集
  切分。
- **跨宿主复用**：在第二个开源软件适配同一协议，验证通用 action/anchor/observation 边界。

上述能力完成前，不应把本 revision 5 fixture 描述为“AI 已能自动完成任意 Blender 任务”。
