## 变更说明 / Summary

<!-- 说明解决的问题、实现方式，以及本次明确不包含的范围。 / Describe the problem, the approach, and what is explicitly out of scope. -->

关联 Issue / Related issue:

## 验证 / Verification

<!-- 勾选实际运行且通过的项目；未运行时说明原因。 / Check only commands that actually passed; explain anything not run. -->

- [ ] `pnpm check`
- [ ] `pnpm test:blender`（涉及 Blender Extension、fixture 或构建脚本时 / when changing the Blender Extension, fixtures, or build tooling）
- [ ] `pnpm test:blender:visual`（涉及 Blender 可视行为时 / when changing Blender visuals）
- [ ] `pnpm package:blender`（涉及 Blender 安装包时 / when changing the Blender package）

验证结果或未运行原因 / Results or reasons not run:

## 影响 / Impact

<!-- 说明用户可见变化、兼容性、安全性、协议或数据迁移影响；没有时写“无”。 / Describe user-visible, compatibility, security, protocol, or migration impact; write "None" when absent. -->

- 用户可见变化 / User-visible changes:
- 兼容性与协议 / Compatibility and protocol:
- 安全性 / Security:
- 截图或日志 / Screenshots or logs:

## 提交前确认 / Checklist

- [ ] 提交信息符合 Conventional Commits。 / Commit messages follow Conventional Commits.
- [ ] 测试、fixture 和文档已随行为变化同步更新。 / Tests, fixtures, and docs match the behavior change.
- [ ] 没有把尚未打通的实时 Orchestrator ↔ Blender 链路描述为可用。 / The unfinished live Orchestrator ↔ Blender link is not presented as available.
- [ ] 没有提交访问令牌、私有数据或生成的本地临时文件。 / No tokens, private data, or generated local files are included.
