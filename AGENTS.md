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

`src/domain/` is intentionally empty: no bounded context has been modelled yet. Do not
invent one — ask first.

When a decision isn't covered by these docs, follow the patterns already established in
`src/core/` and `src/infrastructure/`.
