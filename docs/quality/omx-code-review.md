# OMX 正式双通道代码审查待办

## 状态

- 状态：`blocked-by-runtime-capability`
- 阻塞原因：当前运行表面执行 `omx ralplan preflight --json` 返回
  `unsupported_documented_leader_proof`。
- 影响范围：只影响 OMX 对“两个独立角色已经完成正式审批”的证明，不代表代码、测试、
  Blender、MCP 或打包存在已知故障。

本记录放在普通版本控制文档中，不手工修改 `.omx/state`。OMX hooks 仍然拥有运行时状态；以后
能力满足时，可以从任意干净工作树按下面的流程重新执行。

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
   `pnpm test:blender`。随后让两个通道分别复审最终提交。

## 停止条件

以下条件同时满足后，才可以把本记录状态改为 `complete`：

- 预检不再返回 `unsupported_documented_leader_proof`。
- 两个独立审查通道都针对同一个最终提交给出可追溯结论。
- 确认问题已经修复或有明确记录的风险接受决定。
- 自动化检查和需要的真实 Blender 验证通过。

不得用提示词标签模拟角色，不得根据 session/thread、转录、当前目录或进程信息推断 leader
身份，也不得把普通测试通过写成 `$code-review` 的双通道批准。
