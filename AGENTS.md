# AGENTS

CLI tool that syncs and materializes documentation repositories into a local,
gitignored cache for deterministic agent consumption.

## Package manager

pnpm.

## Commands

- Build: `pnpm build`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Typecheck: `pnpm typecheck`

## Git workflow

**IMPORTANT**: AI agents should NEVER commit or push changes without explicit user permission.

- **DO NOT** run `git commit` or `git push` automatically
- **DO NOT** create commits as part of completing a task
- **ALWAYS** ask the user before committing or pushing
- **ONLY** commit when the user explicitly requests it (e.g., "commit these changes", "push this to git")
- After making changes, inform the user what was changed and let them decide when to commit

The user maintains full control over git operations and commit history.

## Testing expectations

- Add or update tests for behavior changes and bug fixes.
- Prefer extending existing test coverage in `tests/` before adding new files.

## Cache layout

- Materialized sources live at `.docs/<id>/`.
- Lock file lives next to `docs.config.json` as `docs-lock.json`.

## CLI architecture

- Keep the CLI entrypoint in `src/cli/index.ts` with a `main()` export and
  centralized error handling.
- Parse arguments in `src/cli/parse-args.ts`; keep parsing isolated from
  command execution.
- Define exit codes in `src/cli/exit-code.ts` and use them consistently.
- Provide a minimal runner in `src/cli/run.ts` that just calls `main()`.
- Keep the bin wrapper minimal (dynamic import of `dist/cli.mjs`, call `main`).

## Project patterns

- Use `node:` specifiers for built-in modules.
- Keep modules small and single-purpose; prefer focused helpers in `src/`.
- Prefer early returns to reduce nested control flow.
- Avoid `else if` branches when early returns or separate conditionals are clearer.
- Avoid type casts when a safe type guard or discriminated union can be used.
- Place shared types in `src/types/` and import them via `import type`.
- Use `index.ts` barrels for public entrypoints.

## Naming conventions

- Files use kebab-case (e.g. `parse-args.ts`).
- Types/interfaces use PascalCase; functions/variables use camelCase.
- Use `index.ts` barrels for public entrypoints.
