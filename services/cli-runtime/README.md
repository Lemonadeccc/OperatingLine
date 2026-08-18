# Local AI client runtime

This explicit composition root registers the installed Codex CLI and Claude Code CLI as
OperatingLine planner providers. It preserves the Blender confirmation, proposal review, and
host-authorized execution boundaries; it does not let either CLI execute Blender actions directly.

Both providers also expose the optional Procedure authoring capability. After reviewing
`operatingline.procedure.authoring.providers.list`, an explicit
`operatingline.procedure.authoring.generate` call sends the exact canonical authoring packet to the
selected CLI and returns a strictly validated candidate tree. It does not automatically store the
tree, create a Proposal, or execute Blender.

Start it from the repository root with `pnpm dev:clients`. The default provider-free runtime remains
available through `pnpm dev`.

Legacy companions that do not establish a renewable session remain allowed by default during the
migration window. Set `OPERATINGLINE_ALLOW_LEGACY_COMPANIONS=false` to require session leases. The
setting accepts only the exact values `true` or `false`.
