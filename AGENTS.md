# Agent instructions for Paseo Workboard

These instructions apply to AI coding assistants working anywhere in this
repository. `CLAUDE.md` is a relative symlink to `AGENTS.md`; keep one shared
source of instructions. Both belong in Git, but neither belongs in the npm package.

## Start here

- Read [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before making
  changes. The contribution guide owns the issue/PR workflow and required checks.
- Use the current source, `package.json`, `paseo-plugin.json`, and `mise.toml`
  for behavior, commands, compatibility requirements, and runtime versions.
- Read [architecture](docs/architecture.md) for changes to state or host
  operations, [verification](docs/verification.md) for actual test evidence, and
  [releasing](docs/releasing.md) for package or release work. Do not turn dated
  verification records into claims about an untested revision.

## Contribution workflow

- Open or reuse an issue before a PR. Follow the contribution guide's issue
  requirements: bug reproduction and expected/actual behavior, feature use cases
  and intended outcomes, or the documentation correction. Discuss substantial
  behavior or architecture changes before implementation.
- Keep each PR focused on its issue. Include a summary, the related issue,
  actual validation results and omissions, and relevant compatibility or risks.
  Never invent test results, screenshots, or maintainer approval.
- Inspect Git status, the current branch, and remotes before editing. Preserve
  existing changes. Use a separate worktree and branch for a feature or fix;
  documentation-only work may reuse the current checkout. Start from an updated
  `main` when safe; do not reset, automatically stash, or overwrite another task.
- Make commits only within the authorized task. Do not rewrite published history
  without explicit approval. Pushes, issue/PR publication, comments, tags, npm
  publishing, and releases require authorization for that action and destination.
  Show proposed public titles and bodies before posting unless the wording has
  already been approved. Preparing a local draft or package is not publication.

## Repository map

| Path                                              | Responsibility                                               |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `index.client.tsx`, `client/`                     | React Native UI, theme, translations, and client preferences |
| `index.server.ts`, `server/workboard.ts`          | Plugin lifecycle, reconciliation, and task mutations         |
| `server/paseo-compat.ts`, `server/host.ts`        | Host integration and its compatibility boundary              |
| `server/conversations.ts`, `server/git-safety.ts` | Conversation evidence and archive safety                     |
| `shared/`                                         | Data schemas, migrations, and RPC contracts                  |
| `tests/`, `tests/integration/`                    | Deterministic unit tests and isolated host fixtures          |

## Implementation boundaries

- An active workspace maps to one task. Drafts have no workspace until bound.
  Preserve the distinction between managed-label task status and Agent activity;
  a completed Agent turn does not complete a task.
- The server owns durable state and native mutations. Preserve revision checks,
  expected-value checks, serialized operations, and uncertain outcomes. Avoid
  duplicating that authority in client components.
- Archive can stop Agents and terminals and remove a managed worktree. Preserve
  conversation evidence, activity, label, and Git safety checks. Missing evidence
  must defer or reject archival; never replace it with a task timestamp, a runtime
  status, or an assumed success. Do not retry an uncertain destructive operation.
- Keep host internals behind the compatibility boundary. Reuse the host's
  authenticated session; do not add a separate login or alter host credentials.
  Keep the three Paseo SDK development dependencies aligned with each other and
  verify supported hosts. TypeScript success alone does not prove compatibility.
- Reuse React Native primitives, theme colors, existing bilingual strings, and
  the compact controls' minimum 36px interactive targets. Avoid dependencies for
  small UI behaviors. Preserve keyboard access and host-scoped preferences.
- Update affected English and Chinese documentation together. Prefer links to
  the relevant guide over copying detailed policies into multiple files.

## Validation

Use the Node version pinned in `mise.toml`; run commands through `mise exec --`.
Follow the change-specific check table in [CONTRIBUTING.md](CONTRIBUTING.md).
For code changes, run focused tests first, then `mise exec -- npm run check` and
`mise exec -- npm run format:check`. Documentation-only work needs formatting,
link, and semantic checks. Package-related work also needs
`mise exec -- npm run check:package`.

Unit tests must not depend on a daemon, browser, network service, model, or
personal Paseo home. Changes to the host bridge require supported-host tests
using the [marked, disposable integration home](tests/integration/README.md).
Never load development builds into a personal daemon as a substitute. Report
visual checks only when the rendered behavior was actually exercised.

Keep the English README's `## Installation` and `## Limitations` headings:
package checks and Paseo Cafe depend on them. `package.json` defines the package
file allowlist; `scripts/check-package.mjs` checks the exact packed file list.

## Public content and delivery

- Before committing, inspect `git status --short --ignored` and the complete
  staged diff. Classify new files as shared source/docs, ignored build output,
  local-only scratch, or pre-existing user files. Do not force-add ignored files.
- Keep credentials, internal domains or service addresses, private repository
  links, personal paths, real task/session data, logs, and daemon configuration
  out of Git, public reports, and packages. Use fictional examples. Review content
  in context; a keyword scan alone is not enough.
- Review the actual tarball for packaging changes. Keep tests, local data, and
  Agent instruction files outside the published package.
- Before delivery, review the final diff for correctness, scope, and unnecessary
  changes. Report what changed, the commands and results, untested behavior and
  remaining risks, and the Git state. Distinguish local validation, CI, push,
  installation, and publication.
