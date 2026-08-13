# Local AI client runtime

This explicit composition root registers the installed Codex CLI and Claude Code CLI as
OperatingLine planner providers. It preserves the Blender confirmation, proposal review, and
host-authorized execution boundaries; it does not let either CLI execute Blender actions directly.

Start it from the repository root with `pnpm dev:clients`. The default provider-free runtime remains
available through `pnpm dev`.

Legacy companions that do not establish a renewable session remain allowed by default during the
migration window. Set `OPERATINGLINE_ALLOW_LEGACY_COMPANIONS=false` to require session leases. The
setting accepts only the exact values `true` or `false`.
