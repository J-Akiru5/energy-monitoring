# Agent Rules

## Credentials & Secrets

- **Never** commit real passwords, connection strings with passwords, API keys, tokens, or any secrets to any file — including docs reports, migration files, or comments.
- Reference where a value lives (env var name, secret manager path) — never the value itself.
- If a secret was accidentally committed, flag it immediately for rotation. Do not leave it in git history without at least marking it for cleanup.

## Deployments & Git Hygiene

- **Never push directly to `main` or `develop`** without Jeff's explicit go-ahead in the current session. Use feature branches for all work.
- Before pushing any branch, consider whether it needs to trigger a Vercel preview deployment. If not (docs-only, WIP, not ready for review), say so rather than pushing silently.
- **Docs-only commits** (changes touching only `docs/*.html` and nothing else) should be **batched with the code change they document**, not pushed as standalone commits. Each standalone commit triggers its own deployment cycle — batch them to avoid waste.
- Do not modify `apps/*/vercel.json`'s `ignoreCommand`, `buildCommand`, or `installCommand` without explicit instruction. These fields are the mechanism preventing redundant deployments on every commit.
- **Before reporting any task complete, push the branch and verify with `git ls-remote` that the commit actually exists on origin.** A task is not complete if its work only exists locally — "done" means "pushed and verifiable," not "written."

## Live Database

- Any schema migration or data-mutating script targeting the live Supabase project requires **Jeff's explicit real-time confirmation** before the actual execute/commit step.
- Never run destructive queries (`DELETE`, `TRUNCATE`, `DROP`) on the live project without confirmation.
- Use `BEGIN`/`ROLLBACK` wrappers for dry-run verification of backfill scripts.

## Code Conventions

- Follow existing code style in the file being edited. Don't introduce new patterns, libraries, or conventions without reason.
- Verify type-check and lint pass before pushing.
- Commit messages follow the repo's conventional format: `type(scope): description`.
