# ADR 0083：本机托管的 YouTube OAuth

- 状态：Accepted
- 日期：2026-08-18

## 背景

ADR 0078 至 0082 已把官方 YouTube 字幕读取限制为可编辑视频、显式字幕轨选择和配额确认，但 composition
root 仍要求 operator 在 Runtime 外取得短期 access token。短期 token 会过期，无法提供可审计的登录、状态
验证、注销与失效恢复流程；把 refresh token 写进 `.env` 或运行数据库又会扩大秘密暴露面。

## 决策

新增本机 operator 命令 `pnpm youtube:auth login|status|logout`。Operator 必须在 Google Cloud 创建类型为
Desktop app 的 OAuth client，并通过 `OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID` 显式配置 client ID。登录使用
系统浏览器、随机 PKCE verifier/challenge、随机 state 与只绑定 `127.0.0.1` 临时端口的 callback；scope 固定为
`https://www.googleapis.com/auth/youtube.force-ssl`，并请求 offline consent。

Refresh token 只保存在操作系统凭据库：macOS Keychain、Linux Secret Service 或 Windows PasswordVault。
不提供明文文件、数据库或环境变量回退。Status 通过一次真实 refresh 验证授权，但只输出
`signed_out`、`ready`、`reauth_required` 或 `temporarily_unavailable` 和非秘密 scope。Logout 尝试远端 revoke，
报告 `confirmed`、`uncertain` 或尚未配置，并且无论远端是否可达都删除本地 credential。

三个 composition root 在配置 client ID 时构造 refresh-backed access-token provider。Access token 只在内存中
短暂缓存，在 Data API 请求前按到期时间刷新。Refresh 返回 `invalid_grant` 时 provider 按 refresh token 摘要
在进程内阻止继续使用并要求重新登录；它不删除或改写 vault，避免旧刷新覆盖并发登录写入的新授权。若已发送的 Data API 请求返回 401，source 使缓存失效但不自动重放该
请求；403 作为权限或策略失败处理且不刷新凭据。调用方仍必须按既有 request ID、配额和失败恢复规则显式重试。

`OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN` 作为兼容入口暂时保留。它与 client ID 同时设置属于歧义配置，
composition root 必须在启动 Runtime 前 fail fast。OAuth client secret 不需要也不接受。Google consent screen
处于 Testing 状态时，refresh token 可能七天后过期；这是部署配置约束，不通过不安全的本地续期绕过。

## 结果

Operator 可以完成登录、授权状态验证、自动刷新、注销和失效后重新授权，而 OAuth 秘密不会进入公开协议、
证据事件、日志或明文配置。现有网络/配额确认、选择收据、不可自动重试和可编辑视频权限边界保持不变。

该决策不增加任意公开视频抓取、视频下载、ASR、自动选轨或训练许可推断。

## 参考

- [ADR 0078](0078-authorized-youtube-caption-acquisition.md)
- [ADR 0079](0079-authorized-youtube-caption-track-discovery.md)
- [ADR 0081](0081-persisted-youtube-caption-track-selection.md)
- [ADR 0082](0082-selection-bound-youtube-caption-import.md)
