# ADR 0068：Torus 受管 Procedure 叶节点回放证明

- 状态：Accepted
- 日期：2026-08-17

## 背景

ADR 0065–0067 已把受管 replay 结果证明扩展到四种 primitive。Torus 的 Action 已有确定性构网、版本化
ordered menu、补偿回退和双版本 Blender 测试，但参数形状与既有球体和定边长 primitive 不同：拓扑由
`majorSegments × minorSegments` 决定，几何同时受 `majorRadius` 和 `minorRadius` 控制。

只核对拓扑无法发现半径错误；只使用隐式圆环方程又会在 `minorRadius > majorRadius` 的合法自交形状上失效。
此外，当前 InteractionCatalog 没有经过验证的 Torus shortcut，replay 合同不能为了扩大覆盖而把它写成候选。

## 决策

`ProcedureLeafReplay 1.0.0` 的封闭白名单增加：

- `blender.mesh.create_torus` → `torus_ready`。

提案仍要求单 leaf、目录重新物化、人工 GuideProposal 审批、`success_gate + rollback_step`、补偿回退和
同 lease receipt 顺序。Observation 参数必须恰好等于 Action 的 `resourceId`、`objectName`、
`majorSegments`、`minorSegments`、`majorRadius`、`minorRadius` 与 `location`。

ActionCatalog 冻结 `1.20.0` 并发布 `1.21.0`，只为 Torus 增加强 Observation；InteractionCatalog 冻结
`1.30.0` 并发布 `1.31.0`，recipe 内容逐字不变，只更新 ActionCatalog binding。

## 强 Observation

共享 evaluator 继续核对唯一 receipt、Collection/Object/Mesh ownership、三项精确 mutation、Object→Mesh、
managed Collection link、名称、location、单位 rotation/scale、隔离 transform、无 modifier/shape key/material、
有限坐标和 Mesh 内容签名。

Torus 另要求：

- 顶点与面数量等于 `majorSegments × minorSegments`，边数量为其两倍；
- 按执行器相同的 major/minor 角度顺序逐顶点复算局部坐标；
- 每个坐标分量在与模型尺度成比例的有界误差内匹配 accepted 两组 radius。

逐顶点参数化验证覆盖普通、horn、spindle/self-intersecting 形状，不依赖仅适用于环形 Torus 的隐式距离公式。
Blender 4.5.3/5.1.1 集成测试覆盖正常执行、缺失/额外/布尔参数、错误半径、坐标篡改、action tag 与 receipt
action 篡改，以及 Back 补偿。

## Shortcut 证据状态

replay binding 和 attestation 的 shortcut 字段改为严格跟随 materialization：已有候选轨迹时保留
`candidate_not_executed`，目录明确 unavailable 时保留 `unavailable`。Binding Schema 会校验 claim 与 leaf
coverage 一致。Torus 因没有已验证 shortcut 使用 `unavailable`，不会生成或暗示键盘轨迹。

## 证明范围

证据仍只验证 Companion 上报的受管 Action 结果。menu 为 `catalog_grounded_not_executed`，shortcut 为
上述未执行/不可用状态，MCP 为 `unavailable`。本切片不证明逐控件 UI、真实键盘事件、action-level MCP、
原生 Undo checkpoint 或 attestation 后的当前场景状态。

## 兼容性与后续

- 历史 ActionCatalog `1.20.0` 与 InteractionCatalog `1.30.0` 保存为逐字冻结快照。
- replay 数据库 schema 与 envelope format 不变，无需迁移。
- 后续仍需覆盖 Cone/Cylinder 与复合动作，并独立实现 UI/MCP executor、Undo checkpoint、失败恢复和
  current-state 证明。

## 未选择方案

- **只检查拓扑**：相同 segments 可以生成错误 radius 的 Mesh。
- **只检查隐式 Torus 方程**：会错误拒绝合法的 spindle/self-intersecting 参数。
- **虚构 Torus shortcut candidate**：目录没有真实验证证据，必须保持 unavailable。
