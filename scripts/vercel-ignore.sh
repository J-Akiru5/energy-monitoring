#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Vercel Ignored Build Step — energy-monitoring monorepo
# ─────────────────────────────────────────────────────────────────────────────
# PURPOSE
#   Gate Vercel preview deployments so that only pushes to the three pipeline
#   branches actually trigger a build.  Every other branch (feature/, fix/,
#   chore/, claude/, copilot/, etc.) is skipped unconditionally — regardless
#   of which files changed — stopping the cost/noise from throwaway branches.
#
# PIPELINE BRANCHES
#   main     → Production deployment (Vercel production target)
#   staging  → Pre-production / persistent preview target
#   develop  → Shared integration branch (all features merge here first)
#
# USAGE (vercel.json ignoreCommand field)
#   sh ../../scripts/vercel-ignore.sh <turbo-ignore-filter>
#
# EXIT CODES (Vercel contract)
#   0  → Vercel SKIPS the build (either branch-gated out, or turbo-ignore
#         says nothing changed for this app)
#   1  → Vercel PROCEEDS with the build
#
# ENVIRONMENT
#   VERCEL_GIT_COMMIT_REF — Vercel system env var set to the branch name
#   at Ignored Build Step evaluation time.  Documented at:
#   https://vercel.com/docs/projects/environment-variables/system-environment-variables
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_BRANCHES="main staging develop"
BRANCH="$VERCEL_GIT_COMMIT_REF"

case " $ALLOWED_BRANCHES " in
  *" $BRANCH "*)
    # Branch is in the allowlist — delegate to turbo-ignore for app-level
    # change detection.  turbo-ignore exits 0 (skip) when no relevant files
    # changed, or exits 1 (proceed) when they have.
    echo "Branch '$BRANCH' is in the deploy allowlist — running turbo-ignore for $1"
    npx turbo-ignore "$1"
    ;;
  *)
    # Branch is NOT in the allowlist (feature/*, fix/*, chore/*, etc.).
    # Skip unconditionally — no build, no deployment, no cost.
    echo "Skipping build: branch '$BRANCH' is not in the deploy allowlist ($ALLOWED_BRANCHES)"
    exit 0
    ;;
esac
