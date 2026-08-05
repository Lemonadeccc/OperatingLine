# ADR 0018：版本化人工 Eval 证据与无分数 Provider 对照

- 状态：已接受
- 日期：2026-08-05

## 背景

ADR 0011 和 ADR 0017 已建立确定性的结构质量门与
`requirement -> capability -> executable leaf` 覆盖证据。这些检查能够拒绝未知动作、错误参数、缺失
阶段、资源依赖错误和不诚实的能力引用，但不能判断需求抽取、参数语义、教学表达或最终视觉结果是否
符合用户意图。ADR 0007 的 Eval export 则忠实导出 packet、provider 结果、Proposal、人工决策、宿主
观察和回退事件，不把原始事实升级为语义分数。

要比较真实 Provider，仓库需要一套可复核的人工评测格式，同时必须避免三个错误结论：参考 Plan 是
唯一正确答案、结构门通过等于语义正确，以及一组未经校准的数字可以直接形成 Provider 排名。人工
判断还必须绑定精确的案例、packet、运行结果、证据和 rubric 版本，不能依赖会漂移的文件名或自由文本。

## 决策

定义独立的 Human Eval format `1.0.0`，由五类版本化记录组成：

- `HumanEvalSuite`：定义 suite identity、状态、rubric、案例、数据处理和发布策略；
- `ProviderEvalRun`：保存一次初始规划或局部重规划的精确条件、Provider treatment、结果和 provenance；
- `HumanEvalAnnotation`：保存一个盲审 reviewer 对一个精确 Run 的逐 criterion 判断与证据；
- `HumanEvalAdjudication`：在至少两名独立 reviewer 的当前 annotation 上保留并裁决分歧；
- `HumanEvalComparisonReport`：按可比条件并列原始人工判断和完整性缺口，绑定源记录哈希并携带自身
  integrity，不计算分数或 Provider 排名。

这些记录与 `EvalExportBundle` 分层。Eval export 继续是 Orchestrator 事件账本的原始事实快照；Human Eval
记录引用精确 packet、result、事件摘要和内容哈希，在离线数据集层增加人工语义判断。二者不能相互
冒充。

## Suite、rubric 与案例

`HumanEvalSuite` 使用 `collecting | released | retired` 状态。每个案例有稳定 `id + lineageId`、难度、
语言、标签、`must | must_not | should` 需求、适用 rubric criterion、精确 ActionCatalog 内容哈希和内容
寻址的参考 artifact。参考 Plan 只是 `example_not_ground_truth`；评审必须判断目标要求，不得要求
Provider 逐节点复制参考树。

案例分为：

- `initial_plan`：绑定精确 adapter、ActionCatalog、自然语言目标和 Plan ID；
- `local_replan`：绑定不可变 base Plan artifact、Plan revision、修订消息和最多八个引用节点。

首个 `blender.core_planning@1.0.0` suite 位于
`protocol/fixtures/v1/eval/blender-core/suite.json`，状态为 `collecting`。它包含 7 个案例、6 条 lineage：

- 雪人动画、机器人静帧、玩具火箭、交通灯和粗糙石堆五个常规初始规划案例；
- 一个要求诚实暴露 cloth/wind/simulation 能力缺口的 adversarial 初始规划案例；
- 一个只允许修改雪人材质粗糙度的 local replan 案例。

统一 rubric 覆盖目标拆解、能力诚实、参数语义、教学清晰度、宿主执行结果和视觉对齐。执行或视觉
证据缺失时，reviewer 必须使用 `unable_to_judge`，不能从 generation 成功、Schema 合法或 PNG 文件存在
推断语义质量。

Suite policy 固定：

- 禁止 numeric scoring 和 Provider ranking；
- 每个 Run 至少需要两份独立 annotation；
- 每个 released 案例在同一 condition 下至少需要两个不同 treatment；
- reviewer 不可见 Provider identity；
- 分歧必须保留，并可由单独的 adjudication 处理；
- 缺失 Run 必须原样报告；
- synthetic test fixture 禁止进入 published comparison。

## Provider Run 与可比性

`ProviderEvalRun` 捕获完整、带可复现性声明的运行信封：

- suite/case 内容哈希、operation、replicate 和可选 parent Run；
- Provider descriptor、vendor、实现版本、请求模型、可选 resolved revision、API/SDK/region/service tier；
- OperatingLine commit、协议、adapter、host 和精确 ActionCatalog 环境；
- 规范化 generation parameters、seed 与 determinism 声明；
- 原始公开 generate/replan request、完整 packet 及其 SHA-256；
- 严格解析后的 completed result 或清洗后的 failed error；
- 对应 requested/terminal 事件摘要、可选内容寻址 artifact、时间与 recorder provenance。

Run 不保存凭据、Provider 原始响应或私有推理。`conditionSha256` 只覆盖案例、operation、packet 和宿主
环境；`treatmentSha256` 覆盖 Provider profile 与 generation settings。Comparison 只把相同 condition
的 Run 放入同组，并明确显示 treatment，不把不同 catalog、packet 或宿主版本伪装成可直接对照。

记录级内容完整性继续使用 `operatingline-json-sort-v1`。Plan 身份则固定使用跨语言
`operatingline-json-value-v1`：类型和长度显式编码，字符串/键使用 UTF-8，键按 UTF-8 字节排序，有限
数字使用 IEEE-754 binary64 大端字节且 `-0` 归一为 `0`。Orchestrator、Eval kit 与 Blender Python
必须对同一 JSON Plan 产生相同 `planContentSha256`；同一 `id + revision` 的不同内容必须 fail closed。

`live_provider_invocation` 必须引用冻结 Eval-export `1.1.0` 的完整 page chain，并包含恰好一个 Provider
requested 事件和一个匹配的 completed/failed 终态；该唯一性从完整原始 page chain 按精确 request ID
重算，不能通过选择性 event summary 隐藏冲突终态。同一快照还可记录额外宿主事件。事件摘要使用
`provider_request` 或 `host_execution` correlation，不能给宿主事件伪造 Provider request ID。
`synthetic_test_fixture` 只用于 validator 与报告逻辑测试。开发报告可显示 synthetic Run，published
报告会排除它们。

只有 resolved model revision、不可变 source/adapter/host identity 和 `deterministic` generation 同时存在时，
Run 才能声明 `reproducible`。即使提供 seed，`seeded_best_effort` 也只能声明 `best_effort`，不能把
Provider 的非确定性保证升级为完全可复现。

## Annotation、分歧与裁决

`HumanEvalAnnotation` 绑定精确 Run content SHA-256 和精确 rubric content SHA-256。Reviewer 只保存
pseudonym、qualification、calibration version 与 locale，不保存真实身份。每个适用 criterion 恰好产生
一个 `met | partially_met | not_met | unable_to_judge | not_applicable` 判断、理由和允许类型的证据引用。
总建议只允许 `accept | revise | unable_to_judge`，仍不是数值分数。

更正 annotation 时创建新记录并通过 `supersedesAnnotationId` 指向同一 reviewer、同一 Run 的旧记录；
旧记录保留。`HumanEvalAdjudication` 只能引用同一案例与 Run 上至少两名独立 reviewer 的当前记录，并
逐项给出裁决判断。每个引用同时保存 annotation ID 与 content SHA-256，防止同 ID 内容被改写后继续
冒充已裁决证据。Comparison 在裁决前保留 `disagreement_preserved`，裁决后显示 run-level
`adjudicated` 和原始 annotation，不会静默平均或多数表决。

## 离线工具与目录布局

内部 workspace package `@operatingline/eval-kit` 提供：

- JSON Schema 解析、跨记录引用、完整性哈希，以及受控 root、路径逃逸、符号链接、文件类型、大小与
  artifact 原始字节哈希验证；
- 精确 catalog/base Plan（包括尚无 Run 时的 case-level base Plan）、live Eval-export page chain、Provider
  request/outcome、宿主事件、案例
  operation、packet/request、条件/treatment 哈希和数据处理边界验证；
- annotation supersession、独立 reviewer、完整 rubric coverage 与 adjudication 验证；
- `released` 状态的 live treatment、公开审核、独立 reviewer、分歧裁决，以及 case-level 宿主执行与渲染
  来源覆盖门禁；Provider failed、`needs_revision` 或缺少下游证据的 Run 以 `unable_to_judge` 原样保留，
  不从发布数据中选择性删除；
- 只能从 artifact-verified dataset 生成的无分数 published comparison。

可判断的执行 judgment 必须证明以下因果顺序，不能只证明三个事件分别存在：

1. 与 Run request 和 outcome 匹配、且结果为 `ready` 的 Provider completed 终态先发生；
2. 随后对该 completed outcome 中精确 Plan 的 `planContentSha256` 授权执行：或者发布同一内容哈希的
   `guide.plan.published`，或者先创建包含该精确 Plan、目标 adapter/instance 匹配的 Proposal，再记录
   该 Proposal 的 `accepted` 决策；
3. 授权之后才出现 `companion.state.reported` 宿主终态。该报告必须绑定同一 Plan ID/revision 与
   `planContentSha256`、精确 instance、协议和 host/adapter build，并携带非空 `executionId`。

`met` 需要该终态报告成功覆盖所有 executable steps；`partially_met` / `not_met` 也可引用同一证据链上的
宿主 error 终态，从而保留真实执行失败。Released 数据集中不同 Run 不能复用同一个 `executionId`，
避免一场宿主执行为多个 treatment 提供证据。

可判断的视觉 judgment 必须引用实际读取且内容寻址的 `image/png`。Rendered image 的
`planContentSha256 + executionId + terminalHostReportId + terminalHostEventSequence` 必须逐项匹配上述
同一个宿主终态报告/事件，并引用已声明的 host project；其 host version 与 adapter version 必须和 Run
环境一致。目录验证器会读取真实字节、核对 SHA-256，并实际解码 PNG 的 chunk/CRC、压缩 scanline 与
filter，同时验证 palette 顺序、容量和 indexed pixel 引用，随后把解码宽高和
`visualEnvironment.width/height` 比较；文件扩展名、media type、PNG signature 或声明宽高单独都不构成
视觉证据。每个 released case 对声明的 execution/artifact criterion 至少保留
一份这样的精确证据覆盖。Provider failed、`needs_revision` 或缺少授权/下游证据的 treatment 仍必须以
`unable_to_judge` 进入 comparison；具备精确授权链的宿主 error 则可按证据使用 `not_met` 或
`partially_met`。两类失败都不能因不可判断或未成功而被删除。

数据集目录固定为：

```text
<dataset>/
  suite.json
  runs/*.run.json
  annotations/*.annotation.json
  adjudications/*.adjudication.json
```

仓库命令默认为 `protocol/fixtures/v1/eval/blender-core`，也接受一个显式数据集目录：

```bash
pnpm eval:check path/to/dataset
pnpm eval:report path/to/dataset
```

`eval:check` 验证整个数据集并报告案例、Run、annotation 和 adjudication 数量；`eval:report` 向标准输出
写入 published-audience comparison。当前 fixture 的真实结果是 7 个案例、0 个 Run、0 个 annotation、
0 个 adjudication，所有案例都明确标记 `missingLiveRun: true`。

公开 JSON Schema 只负责单记录形状和可静态表达的同记录约束。规范化哈希重算、跨记录关系、实际文件
字节、完整 page chain、base Plan 内容和 release readiness 必须由 `@operatingline/eval-kit` 执行。结构
解析结果标记为 `structure_only`；只有目录加载器完成文件验证后才升级为 `artifact_verified`，并保存与
精确记录内容绑定、复制或事后改写都会失效的内部 runtime verification mark。

## Eval export 1.1 冻结快照

Human Eval Run 需要引用不会在翻页期间漂移的原始证据。Eval export format 因此升级到 `1.1.0`：第一页
在读取时冻结事件账本的 `snapshotUpperSequence`，并根据 format、scope、上界和精确 catalogs 生成稳定
`snapshotId`。后续页必须同时提交上一页的 `snapshotId + snapshotUpperSequence`，且
`afterSequence <= snapshotUpperSequence`。

导出只在冻结上界内解析 Proposal/RevisionRequest 关联、匹配事件、选择目录和计算汇总。第一页之后
追加的新事件不会进入该快照，也不会改变 `matchedEventCount`、关系集合或后续页内容。若 continuation
更换 scope/catalog、伪造 snapshot ID、使用超过账本或快照上界的 cursor，Orchestrator 显式拒绝，而不
静默开启另一份数据视图。

读取端保留历史 Eval export format `1.0.0` parser，避免已存证据因 minor 升级不可读；只有当前
`1.1.0` schema 带冻结字段并可作为 live Human Eval source。旧式无快照 continuation 仍必须从第一页
重新开始。

## 数据与授权边界

Suite、Run、annotation 和 adjudication 都携带 `trainingUse: not_authorized`。这表示 authored suite、
未来捕获的 Run、人工 annotation 和 adjudication 均未授予训练权利；`local_eval` 或 `research` 许可
不能被解释为训练授权。
公开发布还需要逐记录数据审核。Eval export `redaction: none` 的原始内容不能因被 Run 引用而变成已
脱敏数据。

本里程碑没有调用真实 Provider，没有产生人工 annotation 或 adjudication，也没有发布任何 Provider
对照结论。`collecting` suite 和验证工具只是采集基础设施，不能把“更大的人工 Eval”整体标记为完成。

## 未选择的方案

- **把人工 judgment 写进 Eval export summary**：会污染原始事实层，并让相同执行证据因 reviewer 改动而
  改写。
- **输出总分、胜率或 Provider 排名**：当前没有已发布数据、校准证据或评分治理；数字会掩盖缺失与
  分歧。
- **把 synthetic fixture 当成已采集 Provider 结果**：synthetic 只验证代码路径，不是外部模型证据，
  published comparison 明确排除。
- **把参考 Plan 当作唯一 ground truth**：多个合法计划可以满足同一目标；rubric 判断需求与证据，而非
  节点级复刻。
- **保存 Provider 原始响应、凭据或私有推理**：严格结果和事件摘要已足够建立可复核运行证据，额外数据
  会扩大敏感边界。
- **用实时数据库代替版本化文件记录**：当前目标是可审查、可移植的数据集 contract；采集 UI、服务端
  annotation API 和长期存储属于后续工作。

## 后果与后续

OperatingLine 现在有独立、内容寻址、无分数的人工 Eval 数据模型和离线验证/报告工具，也有 7 个待
采集 Blender 案例。它可以诚实报告“没有真实 Run”与“annotation 不足”，而不是把空数据或 synthetic
测试变成结论。

后续仍需按披露与费用边界采集真实 Provider initial/local-replan Run，取得至少两名校准 reviewer 的
盲审 annotation，保留并裁决分歧，附加真实 Blender 执行/渲染 artifact，再经过数据审核把 suite 从
`collecting` 推进到 `released`。数值评分、训练授权、脱敏、同意、保留和可追溯训练流水线仍是独立、
未完成的治理里程碑。
