# Changesets

Changesets record version intent for workspace packages. Add one with:

```bash
pnpm changeset
```

The current release workflow is deliberately limited to Phase 0: on a protected `main`, a non-empty
release intent may create or update a draft version pull request, but it cannot publish to npm, create
tags or GitHub Releases, or upload artifacts. The remote `main` branch is not protected yet, so the job
remains skipped. Before protecting `main`, also enable GitHub Actions to create pull requests so the default
`GITHUB_TOKEN` can open that draft; do not substitute a personal access token. Every workspace package
remains `private: true` until its compiled distribution, package contents, registry ownership, branch
protection, and trusted-publishing configuration have been reviewed separately.

Do not add registry credentials or publication commands to the release workflow. Run
`pnpm release:check` after changing package manifests, Changesets configuration, or release
automation.
