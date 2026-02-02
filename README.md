# 🗃️ `docs-cache`

Deterministic local caching of external documentation for agents and tools

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/docs-cache)](https://www.npmjs.com/package/docs-cache)
[![Audit](https://github.com/fbosch/docs-cache/actions/workflows/audit.yml/badge.svg)](https://github.com/fbosch/docs-cache/actions/workflows/audit.yml)

## Purpose

Provides agents and automation tools with local access to external documentation without committing it to the repository.

Documentation is cached in a gitignored location, exposed to agent and tool targets via links or copies, and updated through sync commands or postinstall hooks.

## Features

- **Local only**: Cache lives in the directory `.docs` (or a custom location) and _should_ be gitignored.
- **Deterministic**: `docs.lock` pins commits and file metadata.
- **Fast**: Local cache avoids network roundtrips after sync.
- **Flexible**: Cache full repos or just the subdirectories you need.

> **Note**: Sources are downloaded to a local cache. If you provide a `targetDir`, `docs-cache` creates a symlink or copy from the cache to that target directory.

## Usage

```bash
# Initialize (optional)
npx docs-cache init

# Add Sources
npx docs-cache add github:owner/repo#main
npx docs-cache add gitlab:framework/core
npx docs-cache add https://github.com/framework/core.git
npx docs-cache add framework/core framework/other-repo

# Sync
npx docs-cache sync

# Verify Integrity
npx docs-cache verify

# Check Status
npx docs-cache status

# Removal
npx docs-cache remove core
npx docs-cache remove framework/other-repo --prune

# Clean
npx docs-cache clean
```

> for more options: `npx docs-cache --help`

## Configuration

`docs.config.json` at project root (or `docs-cache` inside `package.json`):

```json
{
  "$schema": "https://github.com/fbosch/docs-cache/blob/master/docs.config.schema.json",
  "sources": [
    {
      "id": "framework",
      "repo": "https://github.com/framework/core.git",
      "ref": "main",
      "targetDir": "./agents/skills/framework-skill/references",
      "include": ["guide/**"]
    }
  ]
}
```

### Options

**Top-level**

| Field      | Details                                | Required |
| ---------- | -------------------------------------- | -------- |
| `cacheDir` | Directory for cache. Default: `.docs`. | Optional |
| `sources`  | List of repositories to sync.          | Required |
| `defaults` | Default settings for all sources.      | Optional |

<details>
<summary>Show default and source options</summary>

### Default options

All fields in `defaults` apply to all sources unless overridden per-source.

| Field        | Details                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ref`        | Branch, tag, or commit. Default: `"HEAD"`.                                                                       |
| `mode`       | Cache mode. Default: `"materialize"`.                                                                            |
| `include`    | Glob patterns to copy. Default: `["**/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}"]`.                          |
| `targetMode` | How to link or copy from the cache to the destination. Default: `"symlink"` on Unix, `"copy"` on Windows.        |
| `depth`      | Git clone depth. Default: `1`.                                                                                   |
| `required`   | Whether missing sources should fail. Default: `true`.                                                            |
| `maxBytes`   | Maximum total bytes to materialize. Default: `200000000` (200 MB).                                               |
| `maxFiles`   | Maximum total files to materialize.                                                                              |
| `allowHosts` | Allowed Git hosts. Default: `["github.com", "gitlab.com"]`.                                                      |
| `toc`        | Generate per-source `TOC.md`. Default: `true`. Supports `true`, `false`, or a format (`"tree"`, `"compressed"`). |

### Source options

#### Required

| Field  | Details                           |
| ------ | --------------------------------- |
| `repo` | Git URL.                          |
| `id`   | Unique identifier for the source. |

#### Optional

| Field        | Details                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `ref`        | Branch, tag, or commit.                                                                         |
| `include`    | Glob patterns to copy.                                                                          |
| `exclude`    | Glob patterns to skip.                                                                          |
| `targetDir`  | Path where files should be symlinked/copied to, outside `.docs`.                                |
| `targetMode` | How to link or copy from the cache to the destination.                                          |
| `required`   | Whether missing sources should fail.                                                            |
| `maxBytes`   | Maximum total bytes to materialize.                                                             |
| `maxFiles`   | Maximum total files to materialize.                                                             |
| `toc`        | Generate per-source `TOC.md`. Supports `true`, `false`, or a format (`"tree"`, `"compressed"`). |

> **Note**: Sources are always downloaded to `.docs/<id>/`. If you provide a `targetDir`, `docs-cache` will create a symlink or copy pointing from the cache to that target directory. The target should be outside `.docs`. Git operation timeout is configured via the `--timeout-ms` CLI flag, not as a per-source configuration option.

</details>

## NPM Integration

Use `postinstall` to ensure documentation is available locally immediately after installation:

```json
{
  "scripts": {
    "postinstall": "npx docs-cache sync --prune"
  }
}
```

## License

MIT
