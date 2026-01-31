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

| Field      | Type    | Description                              |
| ---------- | ------- | ---------------------------------------- |
| `cacheDir` | string  | Directory for cache, defaults to `.docs` |
| `index`    | boolean | Write `index.json` summary file          |
| `sources`  | array   | List of repositories to sync             |
| `defaults` | object  | Default settings for all sources         |

**Source Options:**

- `repo`: Git URL
- `ref`: Branch, tag, or commit
- `include`: Glob patterns to copy, defaults to `"**/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}"`,
- `exclude`: Glob patterns to skip
- `targetDir`: Optional path where files should be symlinked/copied to, outside `.docs`
- `targetMode`: Defaults to `symlink` on Unix and `copy` on Windows
- `required`: Whether missing sources should fail in offline/strict runs
- `maxBytes`: Maximum total bytes to materialize for the source
- `maxFiles`: Maximum total files to materialize for the source

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
