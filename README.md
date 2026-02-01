# 🗃️ docs-cache

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

> **Note**: Sources are downloaded to a local cache. If you provide a `targetDir`, `docs-cache` creates a symlink or copy from the cache to that target directory. The target should be outside `.docs`.

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

| Field      | Type   | Description                              |
| ---------- | ------ | ---------------------------------------- |
| `cacheDir` | string | Directory for cache, defaults to `.docs` |
| `sources`  | array  | List of repositories to sync             |
| `defaults` | object | Default settings for all sources         |

**Default options**

All fields in `defaults` apply to all sources unless overridden per-source.

| Field        | Type                | Description                                                                                                      | Default                                                      |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `ref`        | string              | Branch, tag, or commit                                                                                            | `"HEAD"`                                                    |
| `mode`       | string              | Cache mode                                                                                                       | `"materialize"`                                             |
| `include`    | string[]            | Glob patterns to copy                                                                                            | `["**/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}"]`       |
| `targetMode` | `"symlink"\|"copy"` | How to write files into the cache                                                                                | `"symlink"` on Unix, `"copy"` on Windows                   |
| `depth`      | number              | Git clone depth                                                                                                  | `1`                                                          |
| `required`   | boolean             | Whether missing sources should fail                                                                               | `true`                                                       |
| `maxBytes`   | number              | Maximum total bytes to materialize                                                                               | `200000000`                                                  |
| `maxFiles`   | number              | Maximum total files to materialize                                                                               | Optional                                                     |
| `allowHosts` | string[]            | Allowed Git hosts                                                                                                | `["github.com", "gitlab.com"]`                             |
| `toc`        | boolean             | Generate per-source `TOC.md` listing all documentation files                                                     | `true`                                                       |

**Source options**

| Field        | Type                | Description                                                                                                      | Required | Overrides | Default                                                  |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | --------- | -------------------------------------------------------- |
| `repo`       | string              | Git URL                                                                                                          | Yes      | No        | -                                                        |
| `id`         | string              | Unique identifier for the source                                                                                 | Yes      | No        | -                                                        |
| `ref`        | string              | Branch, tag, or commit                                                                                           | No       | Yes       | Inherits from defaults                                   |
| `include`    | string[]            | Glob patterns to copy                                                                                            | No       | Yes       | Inherits from defaults                                   |
| `exclude`    | string[]            | Glob patterns to skip                                                                                            | No       | No        | -                                                        |
| `targetDir`  | string              | Optional path where files should be symlinked/copied to, outside `.docs`                                          | No       | No        | -                                                        |
| `targetMode` | `"symlink"\|"copy"` | How to write files into the cache                                                                                | No       | Yes       | Inherits from defaults                                   |
| `required`   | boolean             | Whether missing sources should fail                                                                              | No       | Yes       | Inherits from defaults                                   |
| `maxBytes`   | number              | Maximum total bytes to materialize                                                                               | No       | Yes       | Inherits from defaults                                   |
| `maxFiles`   | number              | Maximum total files to materialize                                                                               | No       | Yes       | Inherits from defaults                                   |
| `toc`        | boolean             | Generate per-source `TOC.md` listing all documentation files                                                     | No       | Yes       | Inherits from defaults                                   |

> **Note**: Sources are always downloaded to `.docs/<id>/`. If you provide a `targetDir`, `docs-cache` will create a symlink or copy pointing from the cache to that target directory. The target should be outside `.docs`.

## NPM Integration

Use `postinstall` to ensure documentation is available locally immediately after installation:

```json
{
  "scripts": {
    "postinstall": "npx docs-cache sync"
  }
}
```

## License

MIT
