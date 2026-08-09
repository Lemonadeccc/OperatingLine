# OperatingLine for Claude Desktop

This directory contains the reviewed source manifest for the local Claude Desktop MCPB distribution.
The generated bundle is not committed. Build it from the repository root:

```bash
pnpm package:claude-desktop
```

The output is `artifacts/claude-desktop/operating-line-0.1.0.mcpb`. The bundle contains a compiled
stdio-to-Streamable-HTTP connector, this manifest, the Apache-2.0 project license, and the bundled
MCP SDK notices/license. It never contains a Bearer token. Claude Desktop collects the loopback
Runtime URL and token during installation.
