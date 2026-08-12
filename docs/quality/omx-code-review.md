# 正式双通道代码审查记录

## 状态

- 状态：`complete`
- 审查对象：基于提交 `2e781dbcdcafce688df3e7e42b8bff19be5eb8da` 的流式模型对话与自动语义
  重规划最终工作树。
- 审查表面：当前 Codex 表面明确提供文档化的原生 `code-reviewer` 与 `architect` 角色路由，满足
  下述流程第 3 步。`omx ralplan preflight --json` 仍返回
  `unsupported_documented_leader_proof`，因此本次没有操作 OMX runtime、伪造 leader proof 或手工
  修改 `.omx/state`。

## 审查结论

- `code-reviewer`：`APPROVE`。复审覆盖协议、Provider、持久化、Orchestrator、Blender、Schema、
  文档与测试；确认候选 request ID 永久占用、跨终态 Run UUID 冲突稳定返回 `409`、流式输出边界、
  失败恢复、最多两次调用和 Proposal-only 门禁均已闭合。
- `architect`：`APPROVE` / `CLEAR`。确认 Dialogue、普通 Replan 与 Proposal 审查之间的所有权转移、
  Reject 后新 thread、Proposal-first 竞态、重启 fail-closed 和宿主短轮询边界成立。
- 审查中确认的阻断问题均已修复，关键边界已补回归；没有接受未记录的阻断风险。

## 验证证据

- `pnpm check`
- `pnpm test:blender`（Blender 4.5.3 LTS 与 5.1.1）
- `pnpm package:blender`
- `pnpm audit:prod`（既有已记录的 Hono 中等级例外，无新增依赖）
- `git diff --check`

本记录放在普通版本控制文档中，OMX hooks 继续拥有运行时状态。

## 执行流程

1. 记录待审提交和工作树状态：

   ```bash
   git status --short --branch
   git rev-parse HEAD
   ```

2. 运行角色路由预检：

   ```bash
   omx ralplan preflight --json
   ```

3. 只有预检成功，或当前 Codex 表面明确提供文档化的原生 `agent_type` 角色路由时，才运行：

   ```text
   $code-review
   ```

4. `$code-review` 必须产生两个真正独立的审查通道：

   - `code-reviewer`：正确性、安全、错误处理、代码质量、测试与可维护性。
   - `architect`：架构边界、协议兼容、宿主隔离和长期演进风险。

5. 修复所有确认的问题，重新运行与变更相关的测试和 `pnpm check`；涉及 Blender 行为时还要运行
   `pnpm test:blender`。随后让两个通道分别复审最终提交候选。

## 停止条件

以下条件同时满足后，才可以把本记录状态改为 `complete`：

- 预检成功，或当前 Codex 表面明确提供文档化的原生角色路由。
- 两个独立审查通道都针对同一个最终工作树或提交候选给出可追溯结论。
- 确认问题已经修复或有明确记录的风险接受决定。
- 自动化检查和需要的真实 Blender 验证通过。

不得用提示词标签模拟角色，不得根据 session/thread、转录、当前目录或进程信息推断 leader
身份，也不得把普通测试通过写成 `$code-review` 的双通道批准。
