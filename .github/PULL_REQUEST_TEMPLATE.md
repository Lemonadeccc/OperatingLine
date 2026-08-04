## 变更说明

<!-- 说明解决的问题、实现方式，以及本次明确不包含的范围。 -->

关联 issue：

## 验证

<!-- 勾选实际运行且通过的项目；未运行时说明原因。 -->

- [ ] `pnpm check`
- [ ] `pnpm test:blender`（涉及 Blender Extension、fixture 或构建脚本时）
- [ ] `pnpm test:blender:visual`（涉及 Blender 可视行为时）
- [ ] `pnpm package:blender`（涉及 Blender 安装包时）

验证结果或未运行原因：

## 影响

<!-- 说明用户可见变化、兼容性、安全性、协议或数据迁移影响；没有时写“无”。 -->

- 用户可见变化：
- 兼容性 / 协议：
- 安全性：
- 截图或日志：

## 提交前确认

- [ ] 提交信息符合 Conventional Commits。
- [ ] 测试、fixture 和文档已随行为变化同步更新。
- [ ] 没有把尚未打通的实时 Orchestrator ↔ Blender 链路描述为可用。
- [ ] 没有提交访问令牌、私有数据或生成的本地临时文件。
