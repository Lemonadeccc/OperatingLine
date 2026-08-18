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

For managed authorization, create a Google OAuth client of type **Desktop app**, set
`OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID`, and run `pnpm youtube:auth login`. The command opens the
system browser, listens only on a temporary `127.0.0.1` callback, requests only
`youtube.force-ssl`, and saves the refresh token in the operating-system credential vault. Use
`pnpm youtube:auth status` to validate the stored grant and `pnpm youtube:auth logout` to revoke it
and always remove the local credential. There is no plaintext fallback. Google projects whose
consent screen remains in Testing may issue refresh tokens that expire after seven days.

As a legacy alternative, set `OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN` to a short-lived token
obtained outside the runtime. Never set it together with the client ID; startup fails before the
Runtime is created. Then `operatingline.procedure.tutorial.youtube.import` can use the official
YouTube Data API to read metadata and one exact caption track for a video the authenticated account
can edit. OAuth secrets are never accepted in MCP/HTTP payloads or written to logs/events. Managed
access tokens are refreshed before requests; if an API request itself returns 401, that request is
not replayed. The caller must retry explicitly after checking `youtube:auth status` or logging in
again. The source cannot retrieve arbitrary public-video captions. If the exact
track id is unknown, call `operatingline.procedure.tutorial.youtube.tracks.list` first with explicit
network/quota approval. It spends the documented 50-unit `captions.list` cost and returns metadata
only. `operatingline.procedure.tutorial.youtube.tracks.recommend` can then rank that completed list
locally from explicit preferences without another network request, quota charge, download, or model
call. The result never selects a track. After confirmation,
`operatingline.procedure.tutorial.youtube.tracks.select` can persist the exact serving track, a
bounded reason, and whether the user accepted or overrode the recomputed recommendation. Optional
reason notes are retained in the local evidence ledger. Selection downloads nothing; the caller must
pass the selection request id and the same exact video and track ids to the current YouTube import
request `1.1.0`. Before any YouTube API call, the runtime loads that recorded selection and rejects a
missing or mismatched receipt. Legacy import request `1.0.0` remains compatibility-only. A successful
bound import returns Procedure authoring packet `1.4.0` with structured, non-free-text selection
provenance; optional reason notes are not copied into the packet or forwarded to a provider.
