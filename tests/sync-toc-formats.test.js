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

	// Check per-source TOC exists and uses compressed format (Vercel-style)
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	// Compressed format should start with label and be pipe-separated
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("root:{README.md}"));
	assert.ok(sourceToc.includes("docs:{guide.md}"));
	assert.ok(sourceToc.includes("|"));
	// Should NOT have frontmatter, title or ## Files header
	assert.ok(!sourceToc.includes("---"));
	assert.ok(!sourceToc.includes("repository:"));
	assert.ok(!sourceToc.includes("# local - Documentation"));
	assert.ok(!sourceToc.includes("## Files"));
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
	// Tree format should have directory structure
	assert.ok(sourceToc.includes("- docs/"));
	assert.ok(sourceToc.includes("  - [guide.md](./docs/guide.md)"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
	assert.ok(!sourceToc.includes("repository:"));
});

test("sync writes TOC with compressed format via defaults.toc", async () => {
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
			toc: "compressed",
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
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("root:{README.md}"));
});

test("sync writes TOC with tree format via defaults.toc", async () => {
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
			toc: "tree",
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
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
});

test("sync supports toc=true using compressed format", async () => {
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
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("root:{README.md}"));
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
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
});

test("sync supports backward compatibility: toc=false disables TOC generation", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-false-compat-${Date.now().toString(36)}`,
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
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				toc: false,
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

	// Verify TOC.md was NOT created
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	await assert.rejects(
		() => readFile(sourceTocPath, "utf8"),
		/ENOENT/,
		"TOC.md should not exist when toc is disabled",
	);
});
