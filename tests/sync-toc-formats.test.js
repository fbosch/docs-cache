import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

test("sync writes TOC with compressed format by default", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-compressed-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await mkdir(path.join(outDir, "docs"), { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n${JSON.stringify({ path: "docs/guide.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				await writeFile(path.join(outDir, "docs", "guide.md"), "guide", "utf8");
				return { bytes: 10, fileCount: 2 };
			},
		},
	);

	// Check per-source TOC exists and uses compressed format (flat list)
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("repository: https://example.com/repo.git"));
	// Compressed format should show files with full paths
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
	assert.ok(sourceToc.includes("- [docs/guide.md](./docs/guide.md)"));
	// Compressed format should NOT have nested structure (no "- docs/" line)
	assert.ok(!sourceToc.includes("- docs/"));
});

test("sync writes TOC with tree format when specified", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-tree-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				tocFormat: "tree",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await mkdir(path.join(outDir, "docs"), { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n${JSON.stringify({ path: "docs/guide.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				await writeFile(path.join(outDir, "docs", "guide.md"), "guide", "utf8");
				return { bytes: 10, fileCount: 2 };
			},
		},
	);

	// Check per-source TOC exists and uses tree format (hierarchical)
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("repository: https://example.com/repo.git"));
	// Tree format should have directory structure
	assert.ok(sourceToc.includes("- docs/"));
	assert.ok(sourceToc.includes("  - [guide.md](./docs/guide.md)"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
});

test("sync writes TOC with compressed format via defaults.tocFormat", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-defaults-compressed-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			tocFormat: "compressed",
		},
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
});

test("sync writes TOC with tree format via defaults.tocFormat", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-defaults-tree-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			tocFormat: "tree",
		},
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await mkdir(path.join(outDir, "docs"), { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "docs/guide.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "docs", "guide.md"), "guide", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	// Tree format should have directory structure
	assert.ok(sourceToc.includes("- docs/"));
	assert.ok(sourceToc.includes("  - [guide.md](./docs/guide.md)"));
});

test("sync supports backward compatibility: toc=true uses compressed format", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-backward-compat-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			toc: true,
		},
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
});

test("sync supports backward compatibility: toc as format string", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-string-compat-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				toc: "tree",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "abc123",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await mkdir(path.join(outDir, "docs"), { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "docs/guide.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "docs", "guide.md"), "guide", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	// Tree format should have directory structure
	assert.ok(sourceToc.includes("- docs/"));
	assert.ok(sourceToc.includes("  - [guide.md](./docs/guide.md)"));
});
