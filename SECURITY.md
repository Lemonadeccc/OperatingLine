# 安全政策

## 支持范围

OperatingLine 目前处于早期开发阶段，只维护默认分支上的最新代码。尚未发布的版本、旧提交、
个人分支和第三方 Blender MCP 扩展不在安全修复承诺范围内。

当前 Blender MCP Bridge 只收窄 OperatingLine 发出的命令。它连接的上游 transport 仍可执行
任意 Python，因此 Bridge 不是安全沙箱，相关端口不得暴露给非受信网络。实时 Orchestrator ↔
Blender 配对、计划投递、执行队列和观察回传尚未打通，不应被视为现有安全边界。

## 报告漏洞

请勿在公开 issue、讨论或拉取请求中披露未修复漏洞。优先使用仓库 `Security` 页面中的
`Report a vulnerability` 私密报告入口：

<https://github.com/Lemonadeccc/OperatingLine/security/advisories/new>

如果该入口不可用，请通过仓库所有者 GitHub 个人资料中提供的私下联系方式联系维护者，并在
入口可用后转为私密安全报告。报告中请包含：

- 受影响的提交、组件和运行环境。
- 可复现的最小步骤或概念验证。
- 实际影响、攻击前提和建议严重程度。
- 已知缓解措施；如需协调披露，请说明时间要求。

维护者会在私密渠道确认收到报告、复现问题并协调修复与披露。响应时间取决于项目维护能力，
在双方确认公开时间前，请不要披露漏洞细节。

一般使用问题、配置问题和不涉及安全边界的缺陷，请按[支持说明](SUPPORT.md)选择公开渠道。

依赖审计中的临时例外、上游依据和复查条件记录在
[依赖审计说明](docs/security/dependency-audit.md)。例外只针对已核实的单个 GHSA，不降低其他
生产依赖漏洞的审计门槛。
