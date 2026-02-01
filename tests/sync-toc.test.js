import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

test("sync writes per-source TOC when defaults.toc is enabled", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-${Date.now().toString(36)}`,
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
				targetDir: "./target-dir",
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

	// Check per-source TOC exists
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("**Repository**: https://example.com/repo.git"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));

	// Check global TOC does NOT exist
	const globalTocPath = path.join(cacheDir, "TOC.md");
	await assert.rejects(
		() => readFile(globalTocPath, "utf8"),
		/ENOENT/,
		"Global TOC should not exist",
	);
});

test("sync writes per-source TOC when source.toc is enabled", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-source-toc-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	await writeFile(path.join(repoDir, "guide.md"), "guide content", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				toc: true,
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
					`${JSON.stringify({ path: "README.md", size: 5 })}\n${JSON.stringify({ path: "guide.md", size: 13 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				await writeFile(path.join(outDir, "guide.md"), "guide content", "utf8");
				return { bytes: 18, fileCount: 2 };
			},
		},
	);

	// Check per-source TOC exists
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
	assert.ok(sourceToc.includes("- [guide.md](./guide.md)"));
});

test("sync writes per-source TOC by default when no toc config is specified", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-default-toc-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");

	// Config without any toc setting - should use default (true)
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
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	// Check per-source TOC exists (should be generated by default)
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const sourceToc = await readFile(sourceTocPath, "utf8");
	assert.ok(sourceToc.includes("# local - Documentation"));
	assert.ok(sourceToc.includes("**Repository**: https://example.com/repo.git"));
	assert.ok(sourceToc.includes("- [README.md](./README.md)"));
});
