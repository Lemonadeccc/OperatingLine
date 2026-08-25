# ADR 0116：Transform Geometry 有序 RNA 分量写入证据

- 状态：Accepted
- 日期：2026-08-24
- 补充：[ADR 0108](0108-transform-geometry-operation-level-mcp.md)

## 背景

ADR 0108 已把固定 Transform Geometry 叶子开放为十一项 operation-level MCP，但 05、06、07 分别以一次
RNA vector 赋值写入 Translation、Rotation 和 Scale。Observation 只证明最终向量和节点图指纹，不能保存用户
要求的“哪个分量先写、具体值、对应 socket、MCP 工具和 Blender UI 位置”数组，也无法区分逐分量执行与一次
整体向量替换。

Blender 4.5/5.1 没有可依赖的任意内置控件矩形或通用点击 API。这里不能把直接 RNA 变更描述成鼠标点击，也不能
允许 MCP 调用方提交任意节点、socket、property 或 Python。

## 决策

Transform Geometry 的 05–07 现在分别按 `X → Y → Z` 对目标 socket 的 `default_value[index]` 执行三次真实
Blender RNA 分量写入。每次写入后立即重新读取完整向量；只有目标分量接近 accepted value、其它分量保持预期值，
该次写入才形成证据。任一步失败仍进入原有整项补偿，把该 socket 恢复到操作前的默认向量并证明原 fingerprint。

每项成功 Observation 固定包含 `rnaControlWrites`。05–07 各有三条，其他 Transform operation 必须为空数组。
每条记录包含：

- 数组顺序、分量 index/label，以及写入前、accepted、实际 observed 数值；
- accepted action argument、源 operation ID 和 `node.transform_geometry` 语义动作；
- node-group logical ID/name、节点 name/type、socket identifier 与 RNA property；
- 固定 MCP 工具 `operatingline.blender.geometry-nodes.transform.execute-next`；
- `Geometry Nodes → node group → OperatingLine Transform → socket → X/Y/Z` 的稳定 UI 语义路径；
- 明确的 `blender_rna_property_write` execution method。

Blender 内的 Guided Control 同时把三个向量展开为 `05.01 X → 05.02 Y → 05.03 Z`、`06.01…06.03` 和
`07.01…07.03`，每行显示 accepted value。支持 receipt-bound native targeting 的宿主可从同一行触发
`EXACT NATIVE`；4.5/5.1 仍显示完整编号和值，但不会伪造不可用的原生控件激活。

协议对出现的数组执行 strict object、固定映射和 `X/Y/Z` 顺序校验，并把 accepted/observed 数值绑定到 delivery 的
operation parameters。为保持历史持久结果可读取，旧记录可以没有该字段；但 Runtime 为所有新派发的 Transform
operation 派生精确期望数组，并对整个 Observation evidence 做 canonical equality，因此新结果缺失、改序、改目标、
改值或改 UI path 都会被拒绝。Blender float32 observed value 由 Runtime 用 `Math.fround` 派生，不能用宽松的最终
向量近似替代逐次证据。

## 结果与边界

- Translation、Rotation、Scale 的具体值和顺序现在位于叶内可持久、可训练、可检索的执行数组中，而不只存在于
  最终节点图。
- Blender 4.5.3 LTS 与 5.1.1 的真实 integration suite 验证三项 `X/Y/Z` RNA 写入、实际 float32 回读、图状态、
  Back/Abort 和 Undo/Redo；Runtime integration 验证结构合法但 forged 的写入证据会被拒绝。
- 该能力是 receipt-bound RNA component executor，不是鼠标、键盘或逐像素 UI replay。当前 UI path 用于树、引导
  和训练 provenance；只有宿主公开可验证的 native targeting 能力存在时才可额外高亮实际控件。
- 任意 Geometry Nodes 图、节点搜索、拖线、其它 socket、Light Trails 的全部参数、Edit Mode、Modifier、骨骼和
  动画仍需逐项扩展，不能从本决策推导权限。
