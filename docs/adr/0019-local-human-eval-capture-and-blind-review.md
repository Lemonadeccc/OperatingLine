# ADR 0019：本地 Human Eval 采集与 provider-blind 浏览器评审

- 状态：已接受
- 日期：2026-08-09

> 后续状态：ADR 0036 已增加运行时 Provider treatment/output 与 Blender artifact attestation；本文保留
> operator/manual 降级路径的历史决策和安全边界。

## 背景

ADR 0018 定义了版本化 suite、Run、annotation、adjudication 与无分数 comparison，但当时仓库只有
`collecting` fixture 和目录验证/report 工具。要安全收集真实证据，还需要把一次已经发生的 Provider
generation 从 Runtime 事件账本冻结下来，原子写入私有数据集，并让互相独立的人在看不到 Provider
identity 的情况下审核。

这个里程碑不能把工具存在写成数据已经采集完成，也不能提升现有 Runtime 没有证明的事实：Provider
事件没有不可变记录完整 model/settings attestation；宿主 terminal event 也没有记录 Blender 工程与 PNG
的内容哈希。因此操作者填写的 treatment metadata 和人工提供的 artifact 只能支持本地审阅，不能直接
成为发布级可复现 treatment 或 visual artifact evidence。

评审面还需要保持轻量、可审计并与宿主 UI 分层。它不应引入 Electron 桌面壳，也不能把包含 Provider
profile、alias 清单或真实 Run ID 的私有记录直接交给浏览器。

## 决策

实现一条本地、显式分阶段的采集与盲审流程：

```text
versioned snapshot
  -> capture(provider_only | host_execution_with_manual_artifacts)
  -> independent preparer blind sign-off
  -> two independent reviewers
  -> disagreement-only independent adjudication
  -> eval:check / eval:report
```

### 冻结 snapshot

`eval:snapshot` 只接受 loopback HTTP Runtime。调用方通过 `--token-env` 指定环境变量，本地 Runtime access
token 只进入 Authorization header，不写入 snapshot。命令读取完整 Eval-export `1.1.0` page chain，验证
每页内容哈希、scope、snapshot identity、cursor、事件唯一性和全链汇总，然后以私有权限写入一个新的
snapshot 目录。`snapshot.json` 最后提交并声明 `credentialsStored: false`。

这个 access token 只是 OperatingLine 本地 Runtime 的鉴权凭据，不是模型 Provider key。

### 两种 capture mode

`eval:capture` 接受显式 dataset、snapshot、capture manifest 和可选 `--repo-root`：

- `provider_only`：保存冻结的 Provider request/outcome 事件证据，不声明宿主 artifact 可判断；
- `host_execution_with_manual_artifacts`：额外要求 snapshot 中存在同一 Plan、instance、execution 与环境的
  唯一已验证 terminal host event，同时把操作者提供的 Blender 工程和 PNG 复制为内容寻址 artifact。

第二种 mode 名称刻意包含 `manual_artifacts`。当前 terminal host event 不带工程/PNG hash，所以工具只能
证明宿主事件本身满足已实现的 Plan/authorization/execution 检查，不能证明手工提供的文件来自该次
execution。工程仍以 `host_project` 保存；PNG 使用独立 `manual_review_image` kind。两者 metadata 标记
`manual_artifact_not_runtime_bound`，PNG 可进入 provider-blind 浏览器并由 blind sign-off 绑定内容哈希，
但协议禁止它携带 `visualEnvironment`，所以它绝不会满足 `released` artifact criterion，也不能把视觉
judgment 提升为发布就绪证据。

Capture manifest 中的 Provider profile 与 generation settings 来自 operator attestation，不是 Runtime
attestation。Manifest 必须声明 `evidenceClass: operator_attested_not_runtime_verified`、
`assertion: profile_and_settings_reviewed_no_credentials`、attestor pseudonym 与 review time。工具把这份
attestation 保存为内容寻址的 `provider_output` artifact，禁止此类真实 capture 声明 `reproducible`，并
输出 `releasedComparisonEligible: false`；Run 固定为 `not_reproducible`。在 Runtime 提供不可变
Provider/model/settings attestation 之前，数据不能支持发布级 treatment comparison。

Capture 不保存 credential、原始 Provider response 或 private reasoning。它验证精确 suite/case/catalog、
request/packet/outcome、冻结事件链、base Plan、受控路径与 artifact 字节，并把 Run 与内容寻址 artifact
以禁止覆盖的原子写入提交。存在 `repo://` reference 时，调用方必须通过 `--repo-root` 显式绑定仓库根。

### 每 Run 必需的 provider-blind sidecar

每个 Run 在 review 前必须有一份 `blind-signoffs/<run-id>.provider-blind.json`。独立 preparer 运行
`eval:blind`，提供：

- 精确 Run UUID；
- 自己的 pseudonym；
- 已完整审核的 supplemental alias JSON string array；
- 逐字 assertion `no_provider_identity_visible`；
- 每个 PNG 的精确 `--reviewed-image-sha256`，表示 preparer 已人工查看该哈希对应的像素；
- 解析 `repo://` artifact 所需的 `--repo-root`。

工具从 Provider profile 与 supplemental aliases 推导 identity marker，自动扫描结构化浏览器投影；图片
像素由 preparer 查看，命令要求声明的哈希集合与 Run 中的 PNG 集合精确一致。Sidecar 绑定 Run content
hash、projection hash 和每个已人工检查的 rendered artifact hash，再以不可覆盖方式写入。结构化内容
存在 marker、PNG 哈希缺失/多余/重复或不匹配时拒绝签署。Review workspace 打开时要求数据集中每个 Run
都有一份仍然有效的 sidecar；任一 Run 缺失都会 fail closed。

Sidecar 是服务端私有审计记录，不是浏览器 payload。

### Headless loopback review service

`eval:review` 启动只监听 `127.0.0.1` 的 headless HTTP service，并输出带 fragment session token 的
`reviewUrl`。操作者在普通浏览器打开 URL。实现不是 Electron，也不自动访问远端服务。

每次 CLI 启动恰好创建一个 reviewer 或 adjudicator session。Browser DTO 使用 session 内 opaque Run、
evidence 与 annotation token，只包含案例任务、requirements、rubric、生成 Plan、planning quality、通用
evidence label 和允许访问的 PNG。它不包含：

- Provider profile 或 treatment metadata；
- supplemental aliases；
- provider-blind sidecar；
- 真实 Run ID；
- reviewer/adjudicator 的真实身份。

Adjudicator 看到的原 annotation 只标为 `Reviewer A`、`Reviewer B`。服务在出站 DTO 与入站自由文本上
重新执行 Provider marker 扫描；未知字段、错误 Origin、缺少 bearer token、stale version token 或已变更
artifact 都显式失败。

### 独立角色与分歧

角色以 pseudonym 隔离：

- blind-surface preparer 不能创建 reviewer 或 adjudicator session；
- 同一 Run 的 released policy 要求达到 suite 配置的最低独立 reviewer 人数（协议允许 2–10 人）；
- adjudicator 不能是被引用 annotation 的 reviewer；
- adjudication 只在当前 reviewer 达到 suite 最低人数且存在真实逐 criterion 分歧时开放；
- 原 annotation 永久保留，不做平均或多数表决。

Reviewer 更正通过新 annotation supersede 自己的旧记录，不能覆盖历史文件。

### 写入与锁

Capture、blind 和 review submission 共享 dataset 根目录下的私有 `.human-eval-write.lock/` ticket
目录。每个 writer 原子写入一个不可复用 UUID ticket，记录 PID 与取得时间；竞争者短暂退避后只能有一个
进入，持有者结束时只删除自己的 ticket。每个 writer 在锁内重新加载完整数据集，使用同目录临时文件和
no-replace commit，写入后再次验证跨记录一致性。

锁恢复必须使用 `pnpm eval:recover-lock --dataset <directory>`。命令只删除记录完整、属于当前用户且
记录 PID 已不存在的唯一 stale ticket；活进程、权限不足、symlink/非普通 ticket 或畸形记录都会 fail
closed。Ticket 路径不会被新 writer 复用，因此并发恢复不能删除后来创建的 live ticket。禁止手工删除
ticket；Writer 存活时删除会破坏单写者不变量。

## 离线、凭据与费用边界

`eval:capture`、`eval:blind`、`eval:review`、`eval:check` 和 `eval:report` 默认不需要模型 Provider
credential，不调用模型 API，也不产生模型 API 费用。`eval:snapshot` 只携带且不存储本地 Runtime access
token。

只有本流程上游选择调用一个真实模型 Provider 生成新的 output 时，那个可选调用才需要 Provider
credential、网络授权与费用预算。本地 Blender render 使用本机计算资源，不产生模型 API 费用。这些
边界不等于采集数据已获公开发布或训练许可。

## 当前状态与发布限制

实现完成的是安全的本地采集/评审工具链，不是发布级 Eval 数据里程碑。默认 fixture 的真实状态仍是：

```text
caseCount: 7
runCount: 0
blindSignoffCount: 0
annotationCount: 0
adjudicationCount: 0
```

因此没有 Provider 被评估、比较或通过。Suite 仍为 `collecting`，所有案例继续报告 missing live Run。

要形成发布级 treatment/visual comparison，Runtime 后续必须不可变记录 Provider/model/settings
attestation，并把工程/PNG 内容哈希与精确 host execution 绑定；之后仍要完成真实采集、每 Run 两名独立
reviewer、分歧裁决、逐记录公开审核与 ADR 0018 的全部 released readiness 门禁。

## 未选择的方案

- **Electron 评审客户端**：增加打包、升级与桌面权限边界，而本地 loopback service 加普通浏览器已经
  足够；Electron 也不会自动增强盲审或证据可信度。
- **把 Run JSON 直接交给浏览器**：会暴露 Provider profile、真实 Run ID 和其他 treatment metadata，
  破坏 provider-blind policy。
- **没有 sidecar 就动态隐藏字段**：无法证明 reviewer 看见的投影已经由独立 preparer 审核，也无法把
  projection 与 Run/artifact hash 绑定。
- **把人工提供 PNG 称为 exact execution artifact**：Runtime 没有记录文件 hash；这种声明超出证据。
- **把 operator-attested profile/settings 称为 reproducible treatment**：事件链没有不可变证明这些字段；
  这会让 comparison 把人工 metadata 当成运行时事实。
- **自动裁决或数值评分**：会丢失原始分歧，并违背 ADR 0018 的无分数政策。
- **遇到锁就自动删除**：无法区分 crash residue 与仍存活 writer，可能造成并发写入。

## 后果

仓库现在具备可执行、默认离线、单写者保护的真实数据采集入口，以及在浏览器边界保持 Provider identity
隐藏的双 reviewer/独立裁决工作台。每个 Run 的盲审投影都有可验证 sidecar，所有写入保留历史并可由
`eval:check`/`eval:report` 审计。

代价是操作者必须管理私有 snapshot、capture manifest、完整 alias 清单和明确的角色 pseudonym。当前
manual artifact 与 operator-attested treatment 限制会让 Run 保持 `not_reproducible`，不能用于 released
visual/treatment comparison；这是证据边界的显式保守选择，不是工具缺陷被隐藏。

完整操作步骤与审计清单见
[Human Eval 本地采集与盲审指南](../guides/human-eval-collection.md)。基础协议、comparison 与 released
readiness 继续由 [ADR 0018](0018-versioned-human-eval-evidence.md) 定义；运行时证明路径见
[ADR 0036](0036-runtime-attested-eval-evidence.md)。
