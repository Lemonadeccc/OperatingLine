# Local AI client runtime

This explicit composition root registers the installed Codex CLI and Claude Code CLI as
OperatingLine planner providers. It preserves the Blender confirmation, proposal review, and
host-authorized execution boundaries; it does not let either CLI execute Blender actions directly.

Start it from the repository root with `pnpm dev:clients`. The default provider-free runtime remains
available through `pnpm dev`.
