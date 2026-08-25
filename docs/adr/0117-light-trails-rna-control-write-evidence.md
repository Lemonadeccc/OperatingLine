# ADR 0117：Light Trails 参数投影与有序 RNA 控件证据

- 状态：Accepted
- 日期：2026-08-24
- 补充：[ADR 0111](0111-light-trails-operation-level-mcp.md)

## 背景

ADR 0111 已把 no-bake Light Trails 固定为 54 项 operation-level MCP。十二个 accepted 标量位于各自参数
operation，最终 Observation 也保存 `controlledValues`，但过去没有持久化每次写入的节点、socket、分量、投影
公式、前值、实际 Blender 回读和稳定 UI 路径。`trailCount`、`trailSpacing` 与 `tileRepeatCount` 各会改变两个
RNA 控件；只保存一个主控件会隐藏真实顺序。旧 UI 还把 `tileLength` 的 native target 指向后续 Loop Tiles
Offset，而 operation 05 实际写入 Half Tile Line 的 Start.X，二者不能继续混称为同一步。

## 决策

Light Trails 的 05、07、09、10、15–18、21、27、28、31 共十二项参数 operation 现在通过固定 RNA 写入函数
改变 `default_value`。其中 09、10、31 各有两次写入，所以一轮完整执行形成十五条写入证据。每次写入都立即
回读 Blender 属性；只有 projected value 与 observed value 在固定容差内相符，且 vector 的其它分量保持不变，
该 operation 才能提交。失败仍由既有逐项补偿恢复上一 fingerprint。

每个新派发 operation 的 Observation 必须包含 `rnaControlWrites`；非参数 operation 为空数组。每条记录固定保存：

- 数组顺序、源 operation ID、accepted action argument、语义动作与固定 Light Trails MCP 工具；
- node-group logical ID/name、精确节点 name/type、socket identifier、`default_value` 和标量或向量分量；
- before、accepted、projected、Blender float32 observed 数值；
- `identity`、`negative_half_x`、居中行/平铺等受限投影名称；
- `Geometry Nodes → node group → node → socket → Value/X/Y/Z` 的稳定 UI 语义路径。

协议把每个 argument 绑定到唯一的一项或两项目标序列，拒绝混合 executor、缺项、改序、错节点、错 socket、
错分量、错投影或 accepted value 漂移。Runtime 从不可变 replay 重新派生完整数组并对整个 evidence 执行 canonical
equality；`Math.fround` 对齐 Blender RNA float32 回读。字段在持久化 schema 中保持可选以读取历史结果，但所有
新派发 Light Trails operation 都必须提交精确数组。

Blender Guided Control 使用同一目标表显示 `05.01` 等编号。09、10、31 明确展开为 `.01/.02`，每行显示实际节点、
socket/component 与 projected value。receipt-bound native targeting 可用时，每行独立触发 `EXACT NATIVE`；
`tileLength` 现在正确指向 Half Tile Line.Start.X。没有该宿主能力时仍显示完整轨迹和值，但不伪造鼠标点击。

## 结果与边界

- 十二个 accepted 参数及十五次直接 RNA 写入现在形成可持久、可训练、可检索的有序数组，而不只存在于最终图。
- Blender 4.5.3 LTS 与 5.1.1 的真实测试逐字段验证 54 次正向、54 次逆向、故障补偿、Abort、完成和十五次
  float32 回读；两版本 Companion E2E 均通过完整 54 次 delivery/result 和 Runtime 成功门。
- 这是固定 Light Trails recipe 的 receipt-bound RNA executor，不是任意 Geometry Nodes、鼠标/键盘事件或
  像素级 UI replay。九个节点创建 operation 的三十九条稳定初始化写入已由
  [ADR 0118](0118-light-trails-node-initialization-rna-evidence.md) 继续显式化；Resample Curve mode 的跨版本
  RNA 差异和一个参数跨后续 operation 的隐式消费仍需后续逐项处理。十九条直接 RNA link creation 已由
  [ADR 0119](0119-light-trails-rna-link-creation-evidence.md) 显式化，但真实 UI 拖线/节点搜索仍不在证明范围内。
