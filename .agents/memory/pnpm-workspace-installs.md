---
name: Scoped pnpm installs
description: Package dependency installation in this workspace monorepo.
---

When a package-management install targets the workspace root and is rejected by pnpm's root dependency guard, install the package in the owning artifact with `pnpm --filter @workspace/<artifact> add <package>`.

**Why:** Artifact dependencies must be declared by their own workspace package; root installation is rejected unless explicitly requested.

**How to apply:** If the package helper reports `ERR_PNPM_ADDING_TO_ROOT`, use the package's exact workspace name with `pnpm --filter`, then confirm the artifact package manifest and lockfile were updated.