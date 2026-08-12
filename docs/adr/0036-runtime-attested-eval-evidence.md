# ADR 0036：运行时证明的 Provider treatment 与 Blender artifact

- 状态：已接受
- 日期：2026-08-12

## 背景

ADR 0019 的离线 capture 可以验证冻结事件链，却只能由操作者填写 Provider profile/settings，并手工附加
工程和 PNG。这足够本地盲审，不足以支持 released comparison：事件账本没有证明实际调用采用了声明的
模型参数，宿主终态也没有证明附加文件就是该 execution 产生的字节。

## 决策

Planner Provider SDK 增加可选 `describeRuntimeTreatment()`。实现若提供该能力，Orchestrator 会在调用前
克隆并严格解析 profile、模型解析状态、API/SDK 身份和规范化 generation settings，核对注册 descriptor，
计算参数与完整 treatment 的 SHA-256，并把证明写入 requested event。成功终态再绑定 request fingerprint、
精确 packet hash 与严格 draft hash，写入 completed event。未实现该能力的第三方 Provider 保持兼容，但
不会获得 runtime-attested 声明。

Guide/Companion protocol 升级到 `1.5.0`。Blender 在产生唯一合格 PNG 的终态保存当前工程的副本，重新
读取并哈希 PNG 与 `.blend`，将两个内容身份、渲染尺寸、frame、engine、color management、execution ID
和 Plan hash 放入 `artifactAttestation`。报告不包含本地路径。保存副本使用 Blender 的 copy 语义，不改变
用户当前工程路径。证据无法唯一确定、文件漂移或保存失败时字段为 `null`，不能升级为精确 artifact 证据。
Artifact ID 同时包含 execution ID 与 terminal report ID，因此同一 execution 在 Back→Next 后重新完成时不会
让不同字节复用一个逻辑 ID。

Capture manifest 新增两条运行时路径：

- `treatmentAttestation: runtime_attested` 只在 manifest profile/settings 与 requested/completed 事件证明逐字
  等价时成立；
- `host_execution_with_runtime_attested_artifacts` 只在输入 `.blend`/PNG 字节、artifact ID、尺寸与终态报告
  逐字段匹配时创建 `host_project` 和带 `visualEnvironment` 的 `rendered_image`。Manifest 必须用成对的
  `hostExecutionId` 与 `terminalHostReportId` 精确选择终态，避免同一 execution 在 Back→Next 后产生的
  多个成功报告被错误归并。

Released 数据集校验再次从冻结 Eval export 解析 Provider 与 Companion 事件，核对 Run 中的证明，并要求
artifact judgment 引用的图片和工程同时匹配终态 attestation。`provider_only`、operator-attested treatment
与 manual artifact 模式仍保留，但不能冒充 runtime-attested released evidence。

## 兼容性

既有 Guide Plan、请求、Proposal 与 delivery 的 `1.0.0`–`1.4.0` 记录继续可读；只表示当前状态的
branch-list 等查询响应仍使用当前协议版本。旧 Companion report 禁止新增字段。`1.5.0` report 必须显式
包含 `artifactAttestation`，值可为 `null`。`1.2+` observation gate、`1.3+` 参数编辑和 `1.4+`
revision operation 语义继续向后兼容。Provider 的 attestation 能力是可选接口，默认 provider-free
运行时不受影响。

## 安全与边界

- Provider 证明是执行该调用的同一 Provider 进程对公开配置和输出的自我声明，不是供应商或远端服务的
  独立签名；它能检出冻结证据漂移，但不能从密码学上证明远端服务实际采用了声明参数。
- 证明只覆盖进程声明并实际封存的公开配置、严格输出和文件字节，不保存 credential、raw response 或
  private reasoning。
- Provider 未披露 resolved model revision 时最多是 `best_effort`，不能声明完全可复现。
- `.blend` 副本和 PNG 仍可能包含敏感项目内容；内容哈希不等于脱敏、同意、公开发布或训练授权。
- 每次重新进入成功终态都会产生 report-bound `.blend` 副本；成功副本保留在配置的 render output 目录
  （默认系统临时目录），供 capture 使用，不自动删除。采集方应在数据审核或放弃采集后按本地保留策略清理。
- Runtime attestation 解决证据来源，不会调用真实 Provider、自动执行 Blender、完成双人盲审或发布数据集。
- 一个终态只能绑定唯一合格 PNG；多渲染、多场景 artifact 需要后续版本化扩展。

## 后果

仓库具备了从 Provider 调用到 Blender 输出的可验证 released-evidence 路径，并保留原有手工路径的诚实
降级。剩余工作是产生真实调用与宿主执行、由独立 preparer 和两名 reviewer 完成盲审、处理分歧并进行
逐记录数据审核；默认 fixture 仍是 `collecting` 且没有真实 Run。
