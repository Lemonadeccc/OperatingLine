# Human Eval scenarios

版本化人工 Eval 数据位于 `protocol/fixtures/v1/eval/`。这些文件是公开、供应商无关的评测输入与证据
信封，不是某个 Provider 的私有测试配置，也不构成训练授权。

## 当前 suite

`blender-core/suite.json` 定义 `blender.core_planning@1.0.0`，当前状态为 `collecting`。它有 7 个案例、
6 条 lineage：

| 案例                                  | Lineage                 | Operation      | 难度         | 关注点                                                             |
| ------------------------------------- | ----------------------- | -------------- | ------------ | ------------------------------------------------------------------ |
| `blender.snowman_animated_preview`    | `blender.snowman`       | `initial_plan` | intermediate | 完整组件、材质、刚性动画、指定帧渲染与教学表达                     |
| `blender.robot_still_preview`         | `blender.robot`         | `initial_plan` | intermediate | 静帧目标、金属/强调材质，并明确禁止多余动画                        |
| `blender.toy_rocket_preview`          | `blender.toy_rocket`    | `initial_plan` | basic        | 基础体轮廓、玩具配色与产品预览                                     |
| `blender.traffic_light_preview`       | `blender.traffic_light` | `initial_plan` | basic        | 结构与红黄绿的顺序、可读渲染                                       |
| `blender.rough_stone_cairn_preview`   | `blender.stone_cairn`   | `initial_plan` | intermediate | 粗糙材质、支持范围内的几何近似与能力诚实                           |
| `blender.unsupported_cloth_flag`      | `blender.cloth_flag`    | `initial_plan` | adversarial  | 不得虚构 cloth、wind、modifier、任意 Python 或 mesh-editing action |
| `blender.snowman_rougher_body_replan` | `blender.snowman`       | `local_replan` | intermediate | 只修改引用的雪材质粗糙度，保持其余 Plan 不变                       |

雪人与机器人 reference 只提供可审查示例，不是唯一 ground truth。Reviewer 按案例 requirements 与
rubric 判断，不比较节点是否逐项复制参考 Plan。

## Rubric 与审核政策

统一 rubric 覆盖：

- 目标拆解；
- 能力诚实；
- 参数语义；
- 教学清晰度；
- 宿主执行结果；
- 视觉对齐。

每个 Run 至少需要两名独立 reviewer。Provider identity 对 reviewer 隐藏；分歧保留，并可通过单独的
adjudication 处理。判断值是 `met`、`partially_met`、`not_met`、`unable_to_judge` 或
`not_applicable`，不会换算为分数、胜率或 Provider 排名。没有执行事件或内容哈希 artifact 时，执行和
视觉 criterion 应标记 `unable_to_judge`。

本地工具强制以下角色分离：每个 Run 在 review 前必须有一份由独立 preparer 写入的 provider-blind
sign-off；preparer 不能担任 reviewer 或 adjudicator；同一 Run 至少使用两个不同 reviewer pseudonym；
adjudicator 只能处理已保留的 reviewer 分歧，且不能是该 Run 的 reviewer。浏览器只收到 opaque Run ID，
不会收到 Provider profile、补充 alias、sign-off sidecar 或真实 Run ID。

## 数据集布局

`@operatingline/eval-kit` 从以下目录读取记录：

```text
blender-core/
  suite.json
  runs/*.run.json
  blind-signoffs/*.provider-blind.json
  annotations/*.annotation.json
  adjudications/*.adjudication.json
  artifacts/sha256/*
```

当前目录只有 `suite.json`，有 7 个 collecting 案例、0 个 Run、0 个 blind sign-off、0 个 annotation
和 0 个 adjudication。不要创建空占位记录，也不要把 test-kit 的 synthetic Run 复制到发布数据中。

`ProviderEvalRun` 必须绑定精确 suite/case/catalog hash、Planner/Replanning Packet、Provider 与模型/API
profile、generation settings、严格 result/error、source event 摘要和内容寻址 artifact。Local replan 的
case 与 Run 还要绑定同一份完整 immutable base Plan。Live Run 必须引用 Eval-export `1.1.0` 的完整冻结
page chain，包含恰好一个 matching Provider requested 与 completed/failed 事件，并可附加同一 scope 的
`companion.state.reported` 宿主事件；记录不得保存凭据、原始 Provider response 或 private reasoning。
工具会从完整 page chain 按 request ID 重算该唯一链路，而不是只相信 Run 挑选出的摘要。只有完全
deterministic 且 model/source/adapter/host identity 均固定的 Run 才能声明 `reproducible`；带 seed 的
best-effort Provider 仍只能声明 `best_effort`。

采集可判断的执行或渲染证据时，冻结 page chain 必须保留下列严格时序：

```text
Provider completed terminal (`result.status: ready`)
  -> exact planContentSha256 authorization
     (guide.plan.published，或 exact Proposal created -> accepted)
  -> companion.state.reported terminal
```

宿主终态摘要和原始报告必须同时绑定 Provider 输出 Plan 的精确 ID/revision、`planContentSha256`、
instance、环境与非空 `executionId`。`met` 的终态需成功覆盖全部 executable steps；`partially_met` 或
`not_met` 可使用同一授权链之后的宿主 error 终态。不同 released Run 不得复用 `executionId`。如果只有
Provider completed、未对精确 Plan 发布/接受授权，或宿主报告发生在授权之前，execution/artifact
criterion 必须保持 `unable_to_judge`。

`planContentSha256` 使用 `operatingline-json-value-v1`，以显式类型/长度、UTF-8 键排序和 IEEE-754
binary64 数字编码保证 TypeScript/Python 一致；相同 Plan ID/revision 的不同内容不是幂等重试，必须拒绝。

Rendered image 必须声明为 `image/png`，并通过
`planContentSha256 + executionId + terminalHostReportId + terminalHostEventSequence` 指回同一宿主终态
报告/事件及已声明的 host project。目录验证会读取实际文件、核对字节 SHA-256、完整解码 PNG chunk、
CRC 和压缩 scanline，验证 palette 与 indexed pixel 引用，并核对解码宽高与
`visualEnvironment.width/height`；改扩展名、只写 PNG signature 或只填声明尺寸都不能通过。

Annotation 必须绑定精确 Run 和 rubric hash、覆盖案例全部适用 criterion，并为每项判断提供允许类型的
证据。更正使用 `supersedesAnnotationId`，不覆盖旧记录。Adjudication 通过 ID 与 content SHA-256 只引用
同一 Run 上达到 suite 配置最低人数的独立 reviewer 当前 annotation（协议允许 2–10 人）。

## 本地采集与盲审入口

固定操作顺序为：版本化 snapshot → runtime-attested manifest 派生或人工 manifest → `provider_only`、
`host_execution_with_manual_artifacts` 或 `host_execution_with_runtime_attested_artifacts` capture → 独立 preparer
blind sign-off → 达到 suite policy 最低人数的独立 reviewer → 仅在存在分歧时由独立 adjudicator 裁决 →
check/report。

```bash
pnpm eval:snapshot \
  --runtime http://127.0.0.1:43123 \
  --token-env OPERATINGLINE_EVAL_ACCESS_TOKEN \
  --adapter blender \
  --plan <plan-id> \
  --instance <blender-instance-id> \
  --out <private-snapshot-directory>

pnpm eval:manifest \
  --suite <dataset-directory>/suite.json \
  --snapshot <private-snapshot-directory> \
  --case <exact-case-id> \
  --request <generation-request-uuid> \
  --run <new-run-uuid> \
  --replicate 1 \
  --recorder-name local-human-eval-capture \
  --recorder-version 1.0.0 \
  --operating-line-version 0.1.0 \
  --source-commit '<40-lowercase-hex-commit-or-none>' \
  --out-root '<private-capture-input-directory>' \
  --out '<private-capture-input-directory>/capture.json'

pnpm eval:capture \
  --dataset <dataset-directory> \
  --snapshot <private-snapshot-directory> \
  --manifest <capture-manifest.json> \
  --repo-root <OperatingLine-repository-root>

pnpm eval:blind \
  --dataset <dataset-directory> \
  --run <run-uuid> \
  --prepared-by preparer.alpha \
  --aliases <provider-aliases.json> \
  --assert no_provider_identity_visible \
  --reviewed-image-sha256 <exact-reviewed-png-sha256> \
  --repo-root <OperatingLine-repository-root>

pnpm eval:review \
  --dataset <dataset-directory> \
  --reviewer reviewer.alpha \
  --qualification blender.eval.v1 \
  --calibration 1.0.0 \
  --locale zh-CN \
  --repo-root <OperatingLine-repository-root>
```

上述 `eval:manifest` 命令默认生成 `provider_only` manifest。若 snapshot 的精确 terminal host report 含
Guide/Companion `1.5.0` artifact attestation，并且对应文件位于 manifest 输出目录内，在同一命令增加：

```bash
  --host-execution <exact-execution-id> \
  --host-report <exact-terminal-report-id> \
  --host-project <relative-scene.blend> \
  --rendered-image <relative-render.png>
```

四个参数必须全部提供或全部省略；完整提供时生成
`host_execution_with_runtime_attested_artifacts`。路径相对输出 manifest 目录解析，artifact ID、PNG 尺寸和
渲染元数据从精确终态 attestation 派生。工具会在写入前核对实际文件哈希与 PNG 尺寸，并拒绝部分参数、
重复或歧义报告、篡改文件以及绝对路径、`..` 或 symlink 路径逃逸。自动生成器不生成
`host_execution_with_manual_artifacts`；该降级模式仍需人工编写并复核 manifest。

`provider-aliases.json` 必须是完整审核过的 JSON string array，例如：

```json
["Provider display name", "model alias", "product alias"]
```

若 Run 包含 PNG，preparer 必须先查看每个精确文件的像素，确认没有 Provider 名称、模型名、Logo 或水印，
再为每个 PNG 重复一次 `--reviewed-image-sha256`。只有完全没有 PNG 的 Run 才省略该参数；工具会拒绝
缺少、多余、重复或不匹配的哈希。结构化投影会自动扫描，但图片像素依赖这份逐哈希人工声明。

为第二名 reviewer 使用不同 pseudonym 重新启动 `eval:review`。只有页面列出分歧后，才用
`--adjudicator adjudicator.alpha` 替代 `--reviewer ...` 启动裁决 session；三个角色 pseudonym 必须彼此
独立。服务输出带 fragment token 的 `reviewUrl`，操作者在本机普通浏览器打开；这是回环 headless
service，不是 Electron 应用。

Manifest derivation、capture、blind、review、check 和 report 默认不需要模型 Provider 凭据，不调用模型
API，也不产生模型 API 费用。`eval:manifest` 只接受 runtime-attested frozen evidence，显式选择 case/request，
自动派生 profile/settings；默认生成 provider-only `best_effort`，成组提供四个宿主参数时则从精确终态
证明派生 runtime-attested host artifact manifest，并拒绝 credential-like 参数。Snapshot 只从
`--token-env` 指定的环境变量读取本地 OperatingLine Runtime access token，且
不会把 token 写入文件；该 token 不是模型 Provider key。只有在上游生成新的真实 Provider 输出时才需要
该 Provider 的凭据与预算。Blender render 在本机执行，只消耗本地计算资源。

`host_execution_with_manual_artifacts` 会验证 terminal host event，但工程与 PNG 是 operator-provided；
该降级模式不使用终态文件哈希，因此两者不存在运行时绑定。PNG 可供本地 reviewer 查看，但不能满足
released visual artifact evidence。它以 `manual_review_image` 保存并由 blind sign-off 绑定哈希，但不能
携带 `visualEnvironment`；工程 `host_project` 与 PNG metadata 都标记
`manual_artifact_not_runtime_bound`。Capture 中的 Provider profile/settings 也可走 operator-attested
降级，Run 必须保持 `not_reproducible`。若 frozen events 含 runtime treatment/output proof，可使用
`runtime_attested` treatment；若 Companion `1.5.0` terminal report 含文件证明，可使用
`host_execution_with_runtime_attested_artifacts`，由 capture 重新核对 `.blend`/PNG 字节后进入 released
证据门。两条路径都不替代真实双人盲审和数据审核。

完整 manifest 字段、三种 capture mode、锁恢复和审计步骤见
[Human Eval 本地采集与盲审指南](../../../docs/guides/human-eval-collection.md)。

数据集报告 busy 且 writer 已异常退出时，只使用安全恢复命令；不要手工删除锁：

```bash
pnpm eval:recover-lock --dataset <dataset-directory>
```

`.human-eval-write.lock/` 是私有 ticket 目录。命令只删除当前用户拥有、记录完整且 PID 已不存在的唯一
stale ticket；活进程、权限不足或畸形 ticket 都会被拒绝，后来的 writer 不会复用旧 ticket 路径。

## 验证与报告

在仓库根目录运行：

```bash
pnpm eval:check
pnpm eval:report
```

也可以把其他同布局目录作为第一个参数：

```bash
pnpm eval:check path/to/dataset
pnpm eval:check path/to/dataset --worklist
pnpm eval:report path/to/dataset
```

`eval:check` 验证 Schema、跨记录引用、内容哈希、受控 artifact 路径/大小/字节、完整 base Plan、冻结
Eval-export pages、Provider outcome、宿主事件、annotation supersession、adjudication 和 released
readiness。`eval:report` 向标准输出生成 published-audience、内容寻址、无分数 comparison；它只接受
完成 artifact 验证的目录数据集，按相同
`conditionSha256` 分组，保留每名 reviewer 的原始 judgment，并报告缺失 live Run 或 annotation。
`--worklist` 进一步列出真实记录驱动的 capture/sign-off/review/adjudication 缺口；它不会虚构未来 Run、
Provider 分配或真人审查。Review 是全数据集 sign-off 门：任一 Run 未签署时，`reviewStage`
明示列出阻断 Run 且 review/adjudication 队列为空。`collectionPolicyMinimumsMet` 与
`releaseReadiness: "not_assessed"` 分开，因此队列为空也不表示公开数据审核等 release readiness 已经完成。

当前默认数据集的已验证状态为：

```text
caseCount: 7
runCount: 0
blindSignoffCount: 0
annotationCount: 0
adjudicationCount: 0
numericScoring: false
providerRanking: false
```

因此七个案例在当前 report 中都显示 `missingLiveRun: true`。这证明采集缺口被如实报告，不代表任何
Provider 已通过评测。

## 发布与数据边界

- Suite、Run、annotation 和 adjudication 都必须保持 `trainingUse: not_authorized`；研究或本地 Eval
  许可不是训练授权。
- Synthetic Run 只能用于开发验证，禁止进入 `published` comparison。
- Eval export 仍是未脱敏的原始事件快照；引用它不会自动完成脱敏、同意或公开发布审核。
- `released` validator 要求每个 case 在同一 condition 下至少两个 live treatment、每个 Run 最低独立
  annotation 数、所有分歧的独立 adjudication、逐记录公开审核，并为每个声明的 execution/artifact
  criterion 保留至少一份符合上述因果顺序的精确 host terminal / environment-bound render 覆盖。
  Provider failed、`needs_revision` 或缺少授权/下游证据的 treatment 以 `unable_to_judge` 原样保留；
  具备精确授权链的宿主 error 可按证据使用 `not_met` 或 `partially_met`，避免只发布成功样本。

公开 JSON Schema 不能读取实际文件或验证跨记录关系；外部工具不能以“单个 JSON 通过 Schema”代替
`@operatingline/eval-kit` 的目录验证。

协议与边界决策见
[ADR 0018](../../../docs/adr/0018-versioned-human-eval-evidence.md) 与
[ADR 0019](../../../docs/adr/0019-local-human-eval-capture-and-blind-review.md)。
