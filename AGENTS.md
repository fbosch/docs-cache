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

## Review guidelines

When implementing PR feedback or making changes for review:

- **Run all checks before pushing**: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
- **Test cross-platform compatibility**: Windows CI often catches issues Linux doesn't
- **Keep commits focused**: One logical change per commit with clear messages
- **Avoid premature extraction**: Only extract shared code when you have 2+ actual uses
- **Document edge cases**: Add comments explaining non-obvious behavior or workarounds
- **Test git operations carefully**: Use `DOCS_CACHE_GIT_COMMAND` env var to override git path in tests
- **Preserve existing test patterns**: Follow the style and structure of existing test files
- **Check for regex gotchas**: Use non-greedy `.*?` instead of greedy `.*` when appropriate
- **Validate input limits**: Add safety checks (like `MAX_BRACE_EXPANSIONS`) for user-controlled expansion
- **Update documentation**: Ensure README reflects new features and limitations
