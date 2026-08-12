# Planner Provider SDK

`@operatingline/planner-provider-sdk` 是 OperatingLine 仓库内的最小 TypeScript 插件契约。它让嵌入
Orchestrator 的 composition root 显式注入规划器，同时把供应商客户端、凭据、网络和费用策略留在
插件内。

当前包是 private workspace package，仓库尚未发布 OpenAI、Claude 或其他具体厂商插件。默认
`services/orchestrator/src/standalone.ts` 不发现或加载插件，provider 列表为空。

## 接口

```ts
import type { PlannerProviderDescriptor, PlanningPromptPacket } from '@operatingline/protocol';

export interface PlannerProviderGenerateInput {
  readonly requestId: string;
  readonly packet: PlanningPromptPacket;
  readonly signal: AbortSignal;
}

export interface PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  generate(input: PlannerProviderGenerateInput): Promise<unknown>;
  close?(): void | Promise<void>;
}
```

`generate()` 返回 `unknown` 是有意的：provider 输出不被信任，Orchestrator 必须重新解析严格的
`PlanningProposalDraft`，核对 packet identity、递归 ActionCatalog 参数、目录能力覆盖链和确定性规划质量。
Blender catalog `1.7.0` 的 packet 格式为 `1.1.0`；provider 必须在 `planning.capabilityCoverage` 中把
每条具体需求映射到真实 catalog capability，再映射到 action 匹配的可执行叶子。历史无能力目录继续
使用 packet `1.0.0`。插件不得把
“生成完成”解释为 Proposal 已创建；公开结果的 `proposalCreated` 固定为 `false`。

## 注入

嵌入方构造实现后，通过 `startRuntime` 传入实例：

```ts
import { startRuntime } from '@operatingline/orchestrator';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';

declare const provider: PlannerProvider;

const runtime = await startRuntime({
  databasePath: ':memory:',
  accessToken: 'replace-with-16-plus-characters',
  plannerProviders: [provider],
});
```

这只是 composition-root 示例；实际生成还需要为目标 adapter 注入对应 ActionCatalog。调用方通过
`operatingline.planner.providers.list` 检查公开 descriptor，再用
`operatingline.planner.generate` 明确传入 `providerId`、UUID `requestId`、目标、Plan ID 和可选目录
版本。核心没有默认 provider，也不会自动提交返回草案。调用方检查 `status` 与
`planningQuality` 后，仍须另行调用 `operatingline.guide.propose`；宿主内用户接受后才可执行。缺失、
未知、不匹配或范围外的 coverage 会返回 `needs_revision`，不会生成 Proposal。

## Descriptor 要求

Descriptor 使用契约版本 `1.0.0`，并声明：

- 稳定 `id`、插件 `version`、显示名和说明；
- `available` 或带公开原因的不可用状态；
- 1–8 的最大并发数；
- 本地执行必须声明 `dataTransmission: none`，远端执行必须声明 `provider_managed`；
- 凭据管理固定为 `provider_managed`。

Descriptor 是公开数据，不得包含 API Key、访问令牌、私有 endpoint 或其他秘密。核心 wire schema
也不接收这些字段。

## 运行与安全边界

- Generate 可能把用户目标、Companion 状态和完整 ActionCatalog 发送到远端并产生费用。插件负责
  准确披露，调用方负责授权；核心不会代替用户作出发送决定。
- 插件与 Orchestrator 在同一进程，能使用该进程的权限和内存。这是依赖边界，不是强安全沙箱；只
  注入受信任代码。需要强隔离的实现应放到未来独立进程边界。
- 超时或关闭时，核心会触发 `signal`。`AbortSignal` 是协作式取消；插件及其供应商客户端必须主动
  传播和处理 signal，否则外部调用可能在核心返回后继续。核心并行调用插件 `close()`，默认在 5 秒
  后停止等待并返回清洗错误；同步阻塞同一 JavaScript 线程的恶意插件仍无法由进程内边界强制终止。
- 核心限制输出大小并清洗公开错误，不持久化原始 provider 响应、原始错误或私有推理。成功解析的
  草案、coverage、质量报告和 generation 事件会进入未脱敏 Eval 证据，可能包含敏感内容。核心不把
  coverage 升级为语义分数，也不据此自动选择 provider。
- 同一 `requestId` 的同内容并发调用会共享进行中的结果，已完成结果可按持久证据重放。错误对象通过
  `retryMode` 区分 `same_request_id`、`new_request_id` 和 `never`；Provider 已开始后的失败、超时或
  中断不会自动再次使用原 ID，确认需要重试后使用新 UUID，避免重复费用或外部副作用。

公共协议和完整决策见
[协议说明](../../protocol/README.md)与
[ADR 0013](../../docs/adr/0013-explicit-planner-provider-boundary.md)。目录约束目标覆盖见
[ADR 0017](../../docs/adr/0017-catalog-grounded-goal-coverage.md)。
