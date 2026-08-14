# ADR 0047：有序的 Procedure 参数控件物化

- 状态：已接受
- 日期：2026-08-14

## 背景

ADR 0046 的首个目录绑定切片能把 UV Sphere 的 `Layout → Add → Mesh → UV Sphere` 配方物化为菜单
轨迹，但 `accepted_action_arguments` 会把 `resourceId`、`objectName`、`radius` 和 `location` 一次性挂在
最终 operator 上。该结构保留了 Action 参数，却不能表达用户随后应在哪个控件、以什么顺序填入位置、
缩放与名称，也不适合作为逐操作教学或后续训练数据。

把完整参数继续留在 operator、再追加相同值的控件步骤会产生双重权威来源。未来消费者可能重复应用
`location` 或 `radius`，也无法判断 operator 参数与控件参数哪一份才是教学顺序。因此需要一个无重复、
可安装期验证且不包含任意表达式的封闭 DSL。

## 决策

InteractionCatalog 新增 available-menu 分支
`parameterBinding: ordered_parameter_operations`。该分支包含：

- `operatorParameters`：显式的 operator 参数赋值数组；
- `controlOperations.insertAfterStepId`：整组控件唯一的插入锚点，当前必须等于 native execution step；
- `controlOperations.operations`：数组顺序就是权威物化/教学顺序，每项固定为 `configure + control`，并携带
  绝对 UI path 与参数赋值数组；
- `omittedActionArguments`：没有用户可见控件的 Action 参数及非空理由。

参数来源只允许 JSON literal，或一个 ActionCatalog 顶层参数。Action 参数来源只支持 `identity` 与
`uniform_vector3` 两种转换，不允许嵌套路径、算术、模板、条件或任意代码。目录安装时要求每个 Action
参数恰好映射一次或带理由省略，并拒绝未知/重复/同时映射与省略的参数、非数值的
`uniform_vector3`、重复 operation/parameter ID、非 control target、空 path 或错误插入点。Blender Python
解析器执行相同的封闭校验。目标参数名必须是便携 ASCII 标识符，并禁用 `__proto__`、`prototype`、
`constructor`；两端也按严格 JSON 拒绝 `NaN`、`Infinity` 与其他非有限数值。

Blender InteractionCatalog `1.11.0` 仍绑定 ActionCatalog `1.12.0`，仅把 UV Sphere 菜单物化升级为七步：

1. `Layout`
2. `Add`
3. `Mesh`
4. `UV Sphere`，参数 `{ radius: 1 }`
5. `Location`，`value ← location`
6. `Scale`，`value ← uniform_vector3(radius)`
7. `Object Name`，`value ← objectName`

`resourceId` 明确省略于菜单 operation，但仍完整保留在 leaf 的 `action.arguments` 中作为 Action provenance。
MaterializationResult 对旧 `accepted_action_arguments` 算法继续使用格式 `1.0.0`，使用新 ordered 分支时返回
`1.1.0`；公共 Schema 同时严格接受这两个已发布格式。ProcedureTree 格式不变。

## 教学投影边界

`radius → uniform_vector3` 是候选教学投影，不是 Blender 宿主状态等价证明。当前 Action executor 把
`radius` 烘焙进 Mesh 顶点并保持 Object scale 为 1，而教学路径创建单位球后设置统一缩放；两者视觉半径
一致，但 Mesh 坐标、Object transform 以及后续 modifier/observation 的输入可能不同。

因此输出必须继续保持 leaf `candidate`、空 `validatedHostVersions`、通用 compile
`interactionTracks: structural_only`，不得自动执行、晋升 verified 或进入发布级训练数据。若未来要求可执行
等价，应在 Blender 4.5/5.1 中验证并绑定 Adjust Last Operation 的真实 Radius 控件，而不是沿用 scale 投影。

## 兼容性与后果

上一版 InteractionCatalog `1.10.0` 逐字冻结，精确请求仍产生四步、MaterializationResult `1.0.0`，最终
operator 保留完整 Action 参数。`1.9.0` 仍无物化声明并 fail closed 为 unavailable。本 ADR 发布的 `1.11.0`
使用七步 ordered 输出与结果格式 `1.1.0`，并在 ADR 0048 发布 `1.12.0` 时逐字冻结。

本切片不实现 shortcut/MCP 参数配方、更多 action 的逐控件声明、真实 Blender 回放、持久化 attestation、
Provider/RAG、教学视频采集、编辑器或训练数据治理；后续 ADR 0048 仅补充 candidate shortcut 配方，真实
回放与 verified 证明仍未完成。完整 MaterializationResult 信封仍是目录 grounding 证明；单独抽取或经通用
store 保存的 tree 只能按 `structural_only` 使用。
