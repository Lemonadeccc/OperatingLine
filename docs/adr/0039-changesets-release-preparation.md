# ADR 0039: Changesets release preparation without registry publishing

## Status

Accepted for the pre-release phase.

## Context

OperatingLine is a source monorepo with seventeen child workspace packages plus a private root package,
for eighteen package manifests in total. All
package manifests are currently `private: true`; their exports point at TypeScript source, and most
packages intentionally emit no JavaScript or declaration files. Blender ZIP and Claude Desktop MCPB
artifacts have separate build and signing requirements. The repository also lacks protected-release
infrastructure, npm scope ownership, a trusted-publishing environment, and reviewed package tarballs.

Treating this state as publishable would risk unusable npm packages, accidental disclosure of internal
services, or unsigned product artifacts. Version intent and review automation are still useful before
those external and packaging prerequisites exist.

## Decision

Adopt Changesets 3 and a Phase 0 release workflow with these boundaries:

- Changesets may version private workspace packages and generate changelog entries through a draft
  version pull request.
- The workflow runs only after a push to `main`, has no workflow-level permissions, and contains one
  narrowly scoped `contents: write` / `pull-requests: write` version job. A `github.ref_protected` guard
  leaves it inert until `main` has branch protection or a ruleset; the remote branch is currently
  unprotected, so the installed workflow is expected to remain skipped.
- A repository-local, no-network intent step parses `changeset status` output. The pinned main Changesets
  action runs only when the plan has non-empty release entries and receives no `publish-script`; this
  keeps its pull-request body honest about manual publication and makes no-change pushes no-ops. The
  write-permission job invokes the policy and Changesets binaries directly rather than trusting mutable
  root package-script aliases, and dependency installation disables lifecycle scripts.
- The version pull request is created as a draft and returned to draft whenever new Changesets update
  it. A maintainer must explicitly mark it ready for review to trigger the normal CI workflow. Branch
  protection is a separate future publication gate and is not claimed by this phase.
- All GitHub Actions are pinned to full commit SHAs. Checkout never persists credentials.
- No npm token, OIDC permission, publish action or command, Git tag, GitHub Release, or artifact upload is
  permitted in Phase 0.
- All root and workspace manifests remain `private: true` and omit `publishConfig`. A fail-closed policy
  command checks the exact audited manifest path/name set, Changesets configuration, CI ready-review
  trigger, and workflow before version PR creation. Workspace packages reached through symbolic links
  are rejected.
- npm package versions, Guide protocol versions, Blender Action/Interaction catalog versions, Blender
  Extension versions, and MCPB versions remain separate compatibility axes; no fixed or linked release
  group is introduced.

## Future publication gate

Registry publishing remains blocked until an explicitly reviewed allowlist is ready. The likely first
public packages are `@operatingline/protocol`, `@operatingline/adapter-sdk`, and
`@operatingline/planner-provider-sdk`, but each must first provide compiled ESM and declarations, exact
`exports` and `files`, package README/license metadata, clean tarball installation tests, and compatible
internal dependency ranges.

Before enabling npm publication, maintainers must also establish npm scope/package ownership, protect
`main`, configure a protected GitHub Environment and npm Trusted Publisher for the exact workflow, and
replace the Phase 0 policy with a publish-plan allowlist. Publication must use a separate job with
`contents: read` and `id-token: write`; it must not use a long-lived registry token. Blender ZIP and
production-signed MCPB distribution stay in independent artifact workflows.

## Consequences

The repository gains reviewable, repeatable version PR preparation without claiming that any package or
product is already releasable. Until `main` is protected, the workflow is installed but inert. With that
guard satisfied, it intentionally does nothing when Changesets reports no non-empty release entries.
Actual registry publication, product artifact release, and stable-version synchronization remain later
milestones with explicit external setup and review gates.
