# 依赖审计说明

本文件记录 `pnpm audit:prod` 中经过上游核实的精确例外。新增或扩大例外必须单独审查，不能用
范围型忽略规则替代依赖升级。

## GHSA-frvp-7c67-39w9

- **依赖路径**：`@modelcontextprotocol/node@2.0.0` → `@hono/node-server@1.19.17`
- **仓库解析版本**：`1.19.17`
- **上游受影响范围**：`<1.19.15`，以及 `>=2.0.0 <2.0.5`
- **上游修复版本**：`1.19.15`、`2.0.5`
- **本仓库结论**：当前 `1.19.17` 位于上游明确列出的安全 1.x 范围内。

pnpm 使用的审计数据目前把全部 `<2.0.5` 版本标记为受影响，与维护者发布的双分支修复范围不
一致。仓库因此在 `pnpm-workspace.yaml` 中只忽略该 GHSA；`pnpm audit:prod` 仍会对其他漏洞返回
失败。OperatingLine 也不使用该公告涉及的 Windows `serve-static` 前缀保护路径，但这只是额外
的不可达性判断，主要依据仍是已解析版本高于 1.x 修复点。

上游依据：

- [honojs/node-server 安全公告](https://github.com/honojs/node-server/security/advisories/GHSA-frvp-7c67-39w9)
- [pnpm audit 的精确 GHSA 忽略配置](https://pnpm.io/10.x/cli/audit#auditconfigignoreghsas)

出现以下任一情况时必须重新审查并尽量删除例外：

1. lockfile 解析到低于 `1.19.15` 或进入受影响的 2.x 范围。
2. 上游公告修改受影响范围或撤回 1.x 修复结论。
3. MCP SDK 放宽或升级 `@hono/node-server` 依赖范围。
4. OperatingLine 开始使用 `serve-static`，或在 Windows 上引入相关前缀保护路由。
5. 发布第一个稳定版本前进行依赖安全复核。
