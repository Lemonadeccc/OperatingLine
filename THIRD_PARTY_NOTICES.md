# Third-Party Notices

OperatingLine 本身采用 Apache License 2.0。以下文件包含或改编自第三方材料，其原始许可继续
适用；这些许可不改变 OperatingLine 自有代码的 Apache-2.0 许可。

## oh-my-codex

仓库根目录的 `AGENTS.md` 由 `oh-my-codex@0.20.3` 的项目模板生成并经格式化。项目来源：
<https://github.com/Yeachan-Heo/oh-my-codex>。

Copyright (c) Yeachan Heo and oh-my-codex contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Contributor Covenant

`CODE_OF_CONDUCT.md` 改编自 Contributor Covenant 2.1，并在文件内保留原始来源与
Creative Commons Attribution 4.0 International 许可链接。

## OpenAI Node SDK

可选的 `@operatingline/openai-planner-provider` 使用 `openai@7.4.0`。项目来源：
<https://github.com/openai/openai-node>。该依赖采用 Apache License 2.0；安装包中的原始
`LICENSE` 条款继续适用。

## Model Context Protocol TypeScript SDK

Claude Desktop MCPB 的 stdio→HTTP 桥接器打包
`@modelcontextprotocol/client@2.0.0`、`@modelcontextprotocol/server@2.0.0` 和
`@modelcontextprotocol/core@2.0.0`。项目来源：
<https://github.com/modelcontextprotocol/typescript-sdk>。项目正在从 MIT 迁移到 Apache-2.0；MCPB
在 `THIRD_PARTY_LICENSES/MODEL_CONTEXT_PROTOCOL_SDK_LICENSE.txt` 中附带上游发布的完整过渡说明和
许可证文本。`@anthropic-ai/mcpb@2.1.2` 与 `esbuild@0.28.1` 只用于验证/构建，不进入生成的连接器包；
二者均采用 MIT License。
