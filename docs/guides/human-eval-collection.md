# Human Eval 本地采集与盲审

本文说明如何把一次已经发生的真实 Provider generation 及可选 Blender 宿主执行，采集为版本化
Human Eval Run，并完成独立 preparer、两名 reviewer、按需 adjudicator 的本地盲审。

当前仓库的默认 `blender.core_planning@1.0.0` suite 仍处于 `collecting`：7 个案例、0 个 Run、0 个
blind sign-off、0 个 annotation、0 个 adjudication。下列工具已经实现并受测试覆盖，但仓库没有可供本文
实际执行端到端 capture/review 的真实 Run；不要把命令示例解释为已经完成评测。

## 固定工作流

```text
versioned Eval snapshot
  -> runtime-attested provider_only manifest (automatic), or reviewed manual manifest
  -> capture: provider_only | host_execution_with_manual_artifacts
            | host_execution_with_runtime_attested_artifacts
  -> independent preparer provider-blind sign-off
  -> reviewer A annotation
  -> reviewer B annotation
  -> independent adjudicator, only when judgments disagree
  -> eval:check
  -> eval:report
```

每个 Run 在 review 前都必须有一份有效 sidecar。角色使用稳定 pseudonym，并满足：

- preparer 不能是该数据集的 reviewer 或 adjudicator；
- 同一 Run 的两名 reviewer 必须使用不同 pseudonym；
- adjudicator 不能是该 Run 的 reviewer，也不能是 preparer；
- 没有 reviewer 分歧时不得创建 adjudication。

## 凭据、网络与费用边界

`eval:manifest`、`eval:capture`、`eval:blind`、`eval:review`、`eval:check` 和 `eval:report` 默认完全离线：
它们不读取模型 Provider 凭据、不调用模型 API，也不产生模型 API 费用。

`eval:snapshot` 只访问 `127.0.0.1`、`localhost` 或 `::1` 上的 OperatingLine Runtime。它从
`--token-env` 指定的环境变量读取本地 Runtime access token，并明确不把 token 写入 snapshot；该 token
不是模型 Provider API key。只有在采集链上游选择生成一份新的真实 Provider 输出时，才需要那个
Provider 的凭据、网络访问和预算。`host_execution_with_manual_artifacts` 使用的 Blender render 在本机产生，只消耗
本地 CPU/GPU、内存和磁盘资源。

Snapshot、Run 与 artifact 可能包含未脱敏目标、动作参数和宿主事件。保持目录私有；所有记录仍是
`trainingUse: not_authorized`，也没有自动获得公开发布授权。

## 准备私有工作目录

从仓库根目录开始。不要直接把未审核的真实采集写入受版本控制的 fixture；创建私有 working dataset，
并让 `repo://` reference 继续指向当前仓库：

```bash
export EVAL_REPO_ROOT="$(pwd)"
export EVAL_WORK_ROOT="$(mktemp -d /private/tmp/operatingline-human-eval.XXXXXX)"
export EVAL_DATASET="$EVAL_WORK_ROOT/blender-core"
export EVAL_SNAPSHOT="$EVAL_WORK_ROOT/snapshot"
export EVAL_CAPTURE_INPUT="$EVAL_WORK_ROOT/capture-input"

mkdir -p "$EVAL_DATASET" "$EVAL_CAPTURE_INPUT"
cp protocol/fixtures/v1/eval/blender-core/suite.json "$EVAL_DATASET/suite.json"
chmod 700 "$EVAL_WORK_ROOT" "$EVAL_DATASET" "$EVAL_CAPTURE_INPUT"
```

不要在 shell history、manifest、snapshot 或 dataset 中写入模型 Provider key。为本地 Runtime token 使用
单独环境变量：

```bash
export OPERATINGLINE_EVAL_ACCESS_TOKEN='<local-runtime-access-token>'
```

## 1. 冻结版本化 snapshot

先确保本地 Runtime 已经包含目标 Provider request、唯一 terminal outcome，以及可选的 Proposal/Plan
授权和宿主 terminal event。然后抓取同一个冻结 Eval-export `1.1.0` page chain：

```bash
pnpm eval:snapshot \
  --runtime http://127.0.0.1:43123 \
  --token-env OPERATINGLINE_EVAL_ACCESS_TOKEN \
  --adapter blender \
  --plan '<exact-plan-id>' \
  --instance '<exact-blender-instance-id>' \
  --out "$EVAL_SNAPSHOT"
```

没有宿主实例范围时省略 `--instance`。命令拒绝非回环 HTTP、URL 中的 credentials/query/fragment、哈希
不匹配的页面、漂移的 snapshot identity、重复事件和不完整 page chain。输出目录必须尚不存在；
`snapshot.json` 最后写入并作为完成标记。

## 2. 生成或编写 capture manifest

若 snapshot 的精确 requested/completed 事件包含 Runtime treatment/output attestation，优先让离线工具
派生 `provider_only` manifest，避免手抄 Provider profile、generation settings 和版本身份：

```bash
pnpm eval:manifest \
  --suite "$EVAL_DATASET/suite.json" \
  --snapshot "$EVAL_SNAPSHOT" \
  --case '<exact-suite-case-id>' \
  --request '<exact-generation-request-uuid>' \
  --run '<new-run-uuid>' \
  --replicate 1 \
  --recorder-name local-human-eval-capture \
  --recorder-version 1.0.0 \
  --operating-line-version 0.1.0 \
  --source-commit '<40-lowercase-hex-commit-or-none>' \
  --out-root "$EVAL_CAPTURE_INPUT" \
  --out "$EVAL_CAPTURE_INPUT/capture.json"
```

需要 lineage 时增加 `--parent-run '<uuid>'`，已知供应商 request identity 时增加
`--vendor-request '<public-request-id>'`；两者都可显式传 `none`。命令不会读取环境变量或访问网络，要求
明确选择 case 和 generation request，验证完整冻结 page chain、suite/case/scope、request/terminal、
packet/output hash 及 runtime attestation，并拒绝 `normalizedParameters` 中递归出现的明显 credential-like
键。`--case`、`--request`、`--run`、replicate/lineage、recorder identity、OperatingLine version、source
commit 与可选 vendor request 是操作者提供的数据，不是从 snapshot 推导的事实。输出固定为
`provider_only`、`runtime_attested` 和保守的 `best_effort`：缺少精确宿主 build identity 时不会声明
`reproducible`。`--out-root` 是显式私有写入边界，必须预先存在、不是 symlink；`--out` 必须位于其中。
文件以私有权限原子创建且不覆盖已有路径，边界内的任何既存祖先都不得是 symlink。

如果 runtime attestation 缺失，只能使用下面的人工降级模板。此路径的公开 descriptor/settings 必须由
操作者复核，不保存 credential、原始 Provider response 或 private reasoning。替换所有 `REPLACE_*` 值，
并确保 `generationRequestId` 与 snapshot 中唯一 requested/terminal 事件完全一致：

```json
{
  "formatVersion": "1.0.0",
  "captureMode": "provider_only",
  "suiteId": "blender.core_planning",
  "suiteVersion": "1.0.0",
  "caseId": "REPLACE_CASE_ID",
  "generationRequestId": "REPLACE_GENERATION_REQUEST_UUID",
  "runId": "REPLACE_NEW_RUN_UUID",
  "replicateIndex": 1,
  "parentRunId": null,
  "profile": {
    "descriptor": {
      "contractVersion": "1.0.0",
      "id": "REPLACE_PROVIDER_ID",
      "version": "REPLACE_PROVIDER_VERSION",
      "displayName": "REPLACE_PROVIDER_DISPLAY_NAME",
      "description": "REPLACE_PUBLIC_PROVIDER_DESCRIPTION",
      "availability": { "available": true },
      "limits": { "maxConcurrency": 1 },
      "dataHandling": {
        "executionLocation": "remote",
        "dataTransmission": "provider_managed",
        "credentialManagement": "provider_managed"
      }
    },
    "vendor": "REPLACE_VENDOR",
    "implementation": {
      "name": "REPLACE_IMPLEMENTATION_NAME",
      "version": "REPLACE_IMPLEMENTATION_VERSION"
    },
    "model": {
      "requested": "REPLACE_REQUESTED_MODEL",
      "resolvedRevision": null,
      "resolution": "provider_did_not_disclose"
    },
    "api": {
      "surface": "REPLACE_API_SURFACE",
      "version": "REPLACE_API_VERSION",
      "sdkName": "REPLACE_SDK_NAME",
      "sdkVersion": "REPLACE_SDK_VERSION",
      "endpointClass": "vendor_public",
      "serviceTier": null,
      "region": null
    }
  },
  "generationSettings": {
    "normalizedParameters": {},
    "seed": null,
    "determinism": "unknown"
  },
  "reproducibility": "not_reproducible",
  "treatmentAttestation": {
    "evidenceClass": "operator_attested_not_runtime_verified",
    "assertion": "profile_and_settings_reviewed_no_credentials",
    "preparedBy": "capture.operator",
    "reviewedAt": "2026-08-09T00:00:00.000Z"
  },
  "provenance": {
    "recorderName": "local-human-eval-capture",
    "recorderVersion": "1.0.0",
    "vendorRequestId": null
  },
  "environment": {
    "operatingLineVersion": "0.1.0",
    "sourceCommit": "REPLACE_40_HEX_GIT_COMMIT"
  }
}
```

将文件保存为 `$EVAL_CAPTURE_INPUT/capture.json`。`provider_only` 保存 Provider request/outcome 的冻结证据，
不会假装 execution 或 visual criterion 可判断。

如果不使用自动生成器而手工表达 snapshot 中已有的 Orchestrator 运行时证明，应把 `reproducibility`
保守设为 `best_effort`，并用：

```json
"treatmentAttestation": {
  "evidenceClass": "runtime_attested",
  "assertion": "profile_and_settings_match_runtime_evidence"
}
```

Capture 不会信任这句声明本身：它会逐字段核对 manifest profile/settings、requested treatment、completed
output、request fingerprint、packet hash 和 draft hash。任一处缺失或漂移都会拒绝采集。旧式
`operator_attested_not_runtime_verified` 路径继续可用于本地审阅，且必须保持 `not_reproducible`。
不要只因 model revision 和 generation setting 看似固定就把 `provider_only` 改成 `reproducible`；当前
Provider-only manifest 没有精确 adapter/host build identity。

若 snapshot 还包含同一输出 Plan 的精确授权及目标宿主 terminal report，并且已经在本机保存对应 Blender
工程与真实 PNG，把 mode 改为 `host_execution_with_manual_artifacts` 并增加：

```json
{
  "captureMode": "host_execution_with_manual_artifacts",
  "hostExecutionId": "REPLACE_EXACT_EXECUTION_ID",
  "terminalHostReportId": "REPLACE_EXACT_TERMINAL_REPORT_ID",
  "hostProject": {
    "artifactId": "blender.host-project",
    "path": "scene.blend"
  },
  "renderedImage": {
    "artifactId": "blender.rendered-image",
    "path": "render.png",
    "frame": 20,
    "renderEngine": "BLENDER_EEVEE_NEXT",
    "colorManagement": "AgX"
  }
}
```

这是增量片段，不是独立 manifest；把这些字段合并到完整对象。`path` 相对 manifest 所在目录解析。
Capture 会用成对必填的 `hostExecutionId` 与 `terminalHostReportId` 精确选择一个 terminal host report，
并验证该 report 晚于相应 Plan 授权、Plan 内容哈希、host/adapter 版本，以及人工提供的
artifact 字节、PNG 解码结果和尺寸；缺少精确宿主事件链时使用 `provider_only`，不要补写推断值。
同一 execution 在 `Back` 后再次 `Next` 可以产生多个 completed report；此时必须填写与所选工程/PNG
对应的那个 report ID，不能只靠 execution ID 猜测。

这不是 Runtime-attested artifact capture。当前 host event 不记录 Blender 工程或 PNG 的内容哈希，因此
系统无法证明人工提供的文件就是该 execution 产生的文件。项目保存为 `host_project`；PNG 保存为
`manual_review_image`，由 blind sign-off 绑定内容哈希并可在本地 reviewer 界面查看。两者的 metadata 都
标记 `manual_artifact_not_runtime_bound`，且协议禁止 `manual_review_image` 携带 `visualEnvironment`，因此
它绝不会满足 `released` artifact criterion。Provider profile 和 generation settings 也由操作者根据公开调用信息
填写还是从 runtime attestation 派生，是与 artifact 来源独立的维度。若 treatment 只能由操作者复核，manifest
必须使用精确 `operator_attested_not_runtime_verified` evidence class 与
`profile_and_settings_reviewed_no_credentials` assertion，并记录 attestor pseudonym/time；此时 Capture 强制
Run 为 `not_reproducible`，输出 `runtimeTreatmentEligible: false`。若同一 snapshot 已含完整 runtime treatment/
output attestation，则也可将该证明与 manual artifacts 组合，输出 `runtimeTreatmentEligible: true`，但工程/PNG
仍保持 `manual_artifact_not_runtime_bound`。两种组合的 `releasedComparisonEligible` 都为 `false`：capture
完成仍不等于满足运行时 artifact 证明、盲审、公开审核和整套 released readiness。

若 Blender 终态报告包含 Guide/Companion `1.5.0` 的非空 `artifactAttestation`，可以改用：

```json
{
  "captureMode": "host_execution_with_runtime_attested_artifacts",
  "hostExecutionId": "REPLACE_EXACT_EXECUTION_ID",
  "terminalHostReportId": "REPLACE_EXACT_TERMINAL_REPORT_ID",
  "hostProject": {
    "artifactId": "REPLACE_ATTESTED_PROJECT_ARTIFACT_ID",
    "path": "scene.blend"
  },
  "renderedImage": {
    "artifactId": "REPLACE_ATTESTED_IMAGE_ARTIFACT_ID",
    "path": "render.png"
  }
}
```

此模式要求两个 artifact ID 与所选终态报告完全一致，并重新哈希 `.blend`/PNG、解码 PNG 尺寸，核对 frame、
render engine、color management、Plan hash 与 execution。成功后才创建 `application/x-blender` 的
`host_project` 和带精确 `visualEnvironment` 的 `rendered_image`，可进入 released artifact 门禁。
哈希证明不代表文件已脱敏、获得公开发布或训练授权。

## 3. 捕获 Run

```bash
pnpm eval:capture \
  --dataset "$EVAL_DATASET" \
  --snapshot "$EVAL_SNAPSHOT" \
  --manifest "$EVAL_CAPTURE_INPUT/capture.json" \
  --repo-root "$EVAL_REPO_ROOT"
```

`--repo-root` 是验证 suite 中 `repo://` artifact 的必要绑定。Capture 在数据集锁内重新验证 suite、snapshot
和全部 artifact；Run 和内容寻址 artifact 以禁止覆盖的原子写入提交。成功输出 `runId`，并明确
`providerBlindSignoffRequiredBeforeReview: true`。

## 4. 由独立 preparer 签署盲审 sidecar

Preparer 必须完整列出自动推导 marker 之外仍可能暴露身份的产品名、模型别名、旧名称和品牌别名。创建
严格 JSON string array，例如 `$EVAL_CAPTURE_INPUT/provider-aliases.json`：

```json
["Provider display name", "requested model alias", "resolved model alias", "product alias"]
```

然后使用与所有 reviewer/adjudicator 不同的 pseudonym，并提供精确 assertion。若 Run 包含 PNG，先按
Run 中的 URI 打开每一个实际文件，检查像素中没有 Provider 名称、模型名、Logo 或水印，再为每个已查看
文件传入它的精确 `contentSha256`：

```bash
pnpm eval:blind \
  --dataset "$EVAL_DATASET" \
  --run '<captured-run-uuid>' \
  --prepared-by preparer.alpha \
  --aliases "$EVAL_CAPTURE_INPUT/provider-aliases.json" \
  --assert no_provider_identity_visible \
  --reviewed-image-sha256 '<exact-reviewed-png-sha256>' \
  --repo-root "$EVAL_REPO_ROOT"
```

每个 PNG 重复一次 `--reviewed-image-sha256`；只有 Run 完全没有 PNG 时才省略。命令要求传入的哈希集合与
Run 中的 PNG 集合精确一致，不能少、不能多、不能重复。`--assert` 必须逐字等于
`no_provider_identity_visible`。工具自动扫描任务、requirements、rubric、生成 Plan、planning quality、
证据 label 和结构化 rendered artifact projection；PNG 像素不能靠文本扫描判断，必须由 preparer 查看
上述精确哈希对应的文件。成功后写入 `blind-signoffs/<run-id>.provider-blind.json`。Sidecar 绑定 Run
content hash、盲审 projection hash、每个已人工检查像素的 rendered artifact hash 和完整 alias 清单，且
不能覆盖。

对数据集中的每个 Run 重复此步骤。只要有一个 Run 缺少有效 sidecar，review workspace 就拒绝启动。

## 5. 两名独立 reviewer

为第一名 reviewer 启动一个本地 session：

```bash
pnpm eval:review \
  --dataset "$EVAL_DATASET" \
  --reviewer reviewer.alpha \
  --qualification blender.eval.v1 \
  --calibration 1.0.0 \
  --locale zh-CN \
  --port 0 \
  --repo-root "$EVAL_REPO_ROOT"
```

命令输出 `reviewUrl`。在同一台机器的普通浏览器打开该 URL，完成每个适用 criterion 的 judgment、理由和
至少一份允许的 evidence，然后提交。完成后按 `Ctrl-C` 停止服务。

为第二名 reviewer 使用不同 pseudonym 重新启动：

```bash
pnpm eval:review \
  --dataset "$EVAL_DATASET" \
  --reviewer reviewer.beta \
  --qualification blender.eval.v1 \
  --calibration 1.0.0 \
  --locale zh-CN \
  --port 0 \
  --repo-root "$EVAL_REPO_ROOT"
```

这是只监听 `127.0.0.1` 的 headless HTTP service 加普通浏览器，不是 Electron 应用。浏览器 session 只
得到 opaque Run/evidence/annotation token、签署后的任务投影和可访问证据。它得不到 Provider profile、
alias 清单、私有 sidecar 或真实 Run ID。不同 adjudicator session 看到的 reviewer 也只标记为
`Reviewer A`、`Reviewer B`。

Reviewer 更正会新增 annotation 并 supersede 自己的当前记录，不覆盖历史文件。

## 6. 只裁决真实分歧

若两名当前 reviewer 在任一 criterion 上给出不同 judgment，使用第三个 pseudonym 启动 adjudicator：

```bash
pnpm eval:review \
  --dataset "$EVAL_DATASET" \
  --adjudicator adjudicator.alpha \
  --qualification blender.eval.adjudication.v1 \
  --calibration 1.0.0 \
  --locale zh-CN \
  --port 0 \
  --repo-root "$EVAL_REPO_ROOT"
```

服务只列出至少有两名独立 current reviewer 且仍存在分歧的 Run。Adjudicator 必须逐项引用证据并保留原始
annotation；系统不做平均、投票或数值评分。

## 7. 验证与报告

```bash
pnpm eval:check "$EVAL_DATASET"
pnpm eval:report "$EVAL_DATASET"
```

`eval:check` 必须成功后才能使用 report 作为审计产物。`eval:report` 生成 published-audience、内容寻址、
无分数 comparison；它会保留 failed、`needs_revision`、`unable_to_judge`、缺失 annotation 和未裁决分歧，
不会输出 Provider 排名。

当前仓库默认 fixture 的已验证基线仍是：

```text
caseCount: 7
runCount: 0
blindSignoffCount: 0
annotationCount: 0
adjudicationCount: 0
```

## 单写者锁与安全恢复

Capture、blind sign-off 和 review submission 会在 dataset 根创建私有
`.human-eval-write.lock/` 目录。每个 writer 使用一个不可复用 UUID ticket 文件记录 PID 与取得时间；正常
退出只删除自己的 ticket，空目录可以保留。看到 `Human Eval dataset is already being changed` 时：

1. 停止新的 capture/review 操作。
2. 运行显式恢复命令；不要手工删除锁。
3. 恢复成功后立即运行 `eval:check`，再重试原操作。

```bash
pnpm eval:recover-lock --dataset "$EVAL_DATASET"
pnpm eval:check "$EVAL_DATASET"
```

恢复命令只会删除记录结构完整、属于当前用户且记录 PID 已不存在的 stale ticket。活进程、权限不足、
symlink/非普通 ticket、畸形 JSON 或无效 PID 都会 fail closed。唯一 ticket 路径不会被后来的 writer
复用，因此两个恢复进程也不能误删新 writer 的 ticket。没有 ticket 时输出 `recovered: false`。不要绕过
检查手工删除 ticket；这会破坏单写者、原子写入与跨记录一致性。

## 审计清单

- [ ] Suite/case、catalog hash、operation、Plan ID/revision 与真实调用一致。
- [ ] Snapshot 是完整冻结 `1.1.0` page chain，token 未写入任何文件。
- [ ] Runtime-attested provider-only 路径优先使用 `eval:manifest`，并检查输出未含 credential-like 参数。
- [ ] Run 使用新的 UUID；generation request ID 与唯一 requested/terminal event 一致。
- [ ] Capture mode 诚实：缺少精确宿主因果链时使用 `provider_only`。
- [ ] 使用 runtime treatment 时，manifest 与 requested/completed attestation 完全匹配；未披露 resolved
      revision 时没有声明 `reproducible`。
- [ ] 使用 `host_execution_with_runtime_attested_artifacts` 时，project/PNG 的 ID、字节哈希、尺寸和渲染
      环境均与唯一 terminal report 完全一致。
- [ ] 已将终态 `.blend` 副本纳入本地敏感数据保留策略；capture 完成或放弃后清理不再需要的副本。
- [ ] `host_execution_with_manual_artifacts` 的 terminal host event 已验证；project/PNG 明确标记为人工
      提供、无 Runtime hash 绑定，未用作 released visual evidence。
- [ ] PNG 是无 `visualEnvironment` 的 `manual_review_image`，已由 blind sign-off 绑定哈希，仅用于本地
      review；project 与 PNG metadata 均为 `manual_artifact_not_runtime_bound`。
- [ ] 若 Provider profile/settings 使用 operator-attested 降级路径，Run 为 `not_reproducible`；若使用
      runtime-attested treatment，则它与 requested/completed 证明完全一致。两者都未自动形成发布级 comparison。
- [ ] Treatment attestation 使用精确 evidence class/assertion，attestor pseudonym 与时间经过复核。
- [ ] Manifest 不含 credential、raw Provider response 或 private reasoning。
- [ ] `--repo-root` 指向用于解析 `repo://` artifact 的精确仓库根目录。
- [ ] Alias JSON 是完整 string array，包含产品名、模型别名、旧名称和品牌别名。
- [ ] Blind 命令使用精确 `--assert no_provider_identity_visible`。
- [ ] 每个 PNG 的精确像素已人工检查，且每个哈希都通过独立 `--reviewed-image-sha256` 传入。
- [ ] 每个 Run 都有一份不可覆盖、hash 仍有效的 sign-off sidecar。
- [ ] Preparer、reviewer A、reviewer B、adjudicator pseudonym 彼此独立。
- [ ] 浏览器数据不含 Provider profile、alias、sidecar 或真实 Run ID。
- [ ] 两名 reviewer 都覆盖所有适用 criterion，并引用允许的 evidence。
- [ ] 只有真实分歧进入 adjudication；原始 annotation 仍保留。
- [ ] `eval:check` 成功；`eval:report` 如实显示所有缺口且没有分数或排名。
- [ ] `trainingUse` 保持 `not_authorized`，公开发布仍经过逐记录人工审核。

协议记录与 release readiness 见
[ADR 0018](../adr/0018-versioned-human-eval-evidence.md)；本地采集、盲审 sidecar、browser surface 与写入
边界见 [ADR 0019](../adr/0019-local-human-eval-capture-and-blind-review.md)；运行时证明见
[ADR 0036](../adr/0036-runtime-attested-eval-evidence.md)。
