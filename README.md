# docs-cache

Reproducible local caching of documentation repositories.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/docs-cache)](https://www.npmjs.com/package/docs-cache)

## Purpose

`docs-cache` allows agents and tooling to consume documentation from Git repositories in a fast, deterministic way. It caches content locally, pins versions via a lockfile, and works offline.

## Features

- **Reproducible**: `docs.lock` pins commits and file metadata.
- **Fast**: Local cache avoids network roundtrips after sync.
- **Flexible**: Materialize full repos or sparse subdirectories.
- **Secure**: File size limits, path traversal checks, and host allowlists.
- **Gitignored**: Cache lives in `.docs/` or configured dir and should be gitignored.

## Installation

```bash
pnpm add -D docs-cache
```

## Usage

```bash
# 1. Add Sources
npx docs-cache add github:owner/repo#main
npx docs-cache add https://github.com/framework/core.git
npx docs-cache add framework/core
npx docs-cache add gitlab:framework/core

# 2. Sync
npx docs-cache sync

# 3. Verify Integrity
npx docs-cache verify

# 4. Check Status
npx docs-cache status
```

## Configuration

`docs.config.json` at project root:

```json
{
  "$schema": "./docs.config.schema.json",
  "defaults": {
    "include": ["docs/**", "README.md"],
    "targetMode": "symlink"
  },
  "sources": [
    {
      "id": "framework",
      "repo": "https://github.com/framework/core.git",
      "ref": "main",
      "targetDir": "./docs/framework",
      "include": ["guide/**"]
    }
  ]
}
```

### Options

| Field      | Type   | Description                              |
| ---------- | ------ | ---------------------------------------- |
| `cacheDir` | string | Directory for cache, defaults to `.docs` |
| `sources`  | array  | List of repositories to sync             |
| `defaults` | object | Default settings for all sources         |

**Source Options:**

- `repo`: Git URL
- `ref`: Branch, tag, or commit
- `include`: Glob patterns to copy, defaults to `**/*`
- `exclude`: Glob patterns to skip
- `targetDir`: Optional path where files should be symlinked/copied to, outside `.docs`
- `targetMode`: Defaults to `symlink` on Unix or `copy` on Windows

> **Note**: Sources are always downloaded to `.docs/<id>/`. If you provide a `targetDir`, `docs-cache` will create a symlink or copy pointing from the cache to that target directory. The target should be outside `.docs`.

## NPM Integration

Use `postinstall` to ensure docs are ready for local agents immediately after installation in your local project:

```json
// package.json
{
  "scripts": {
    "postinstall": "docs-cache sync || exit 0"
  }
}
```

## License

MIT
