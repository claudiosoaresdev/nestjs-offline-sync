# Agent instructions

This project follows the architecture and tooling conventions documented in the personal
Obsidian vault. Consult these before making structural decisions (new modules, bounded
contexts, layers, testing setup, tooling changes):

- **Obsidian vault** — `🧠 Knowledge/Software Development/`
  - `Backend Development/NestJS/NestJS Architecture Reference.md` — DDD + Clean Architecture
    blueprint: `core`/`domain`/`infrastructure` layers, `Entity`/`ValueObject`/`AggregateRoot`,
    `Either`, Domain Events, Use Cases, Repository pattern, Zod validation, env, auth,
    multi-tenancy, CI/CD.
  - `Backend Development/NestJS/NestJS Testing.md` — Vitest conventions (unit/e2e configs,
    ESLint overrides for test files).
  - `Development Tools/Code Quality/README.md` (+ `ESLint.md`, `Prettier.md`,
    `Husky e lint-staged.md`, `Commitlint.md`) — lint/format/git hooks/commit message
    conventions.

- **Sibling reference project** — `../../video-processing-platform/nestjs-orchestrator-video-processing-platform`
  — same blueprint already applied end to end; follow its file naming, module layout and
  test setup rather than inventing a new convention.

`src/domain/delivery/` is the single bounded context: deliveries assigned to couriers,
synchronised by snapshot + delta sync, and rated by the recipient after completion. The
sync protocol is specified in
[docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md](docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md)
— read it before touching anything involving `version`, `nextVersion` or the change log.

Two invariants hold the protocol together and are covered by tests that were verified to
fail when broken: the client advances its cursor to `nextVersion` (never `currentVersion`),
and repository bindings use `useExisting` (never `useClass`) so a single version counter
serves both the contract and the change log.

When a decision isn't covered by these docs, follow the patterns already established in
`src/core/` and `src/infrastructure/`.
