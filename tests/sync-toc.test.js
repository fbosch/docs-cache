import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("root:{README.md}"));
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
	assert.ok(!sourceToc.includes("repository:"));

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
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("README.md"));
	assert.ok(sourceToc.includes("guide.md"));
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
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
	assert.ok(sourceToc.includes("[local Docs Index]"));
	assert.ok(sourceToc.includes("root:{README.md}"));
	// Should NOT have frontmatter
	assert.ok(!sourceToc.includes("---"));
	assert.ok(!sourceToc.includes("repository:"));
});

test("sync removes TOC.md when toc is disabled", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-removal-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");

	// First sync with TOC enabled (default)
	const config1 = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config1, null, 2)}\n`, "utf8");

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

	// Verify TOC.md was created
	const sourceTocPath = path.join(cacheDir, "local", "TOC.md");
	const tocContent = await readFile(sourceTocPath, "utf8");
	assert.ok(tocContent.includes("[local Docs Index]"));

	// Second sync with TOC disabled
	const config2 = {
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
	await writeFile(configPath, `${JSON.stringify(config2, null, 2)}\n`, "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: true,
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
		},
	);

	// Verify TOC.md was removed
	await assert.rejects(
		() => readFile(sourceTocPath, "utf8"),
		/ENOENT/,
		"TOC.md should have been removed",
	);
});

test("sync does not rewrite TOC.md when commit matches", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-stable-${Date.now().toString(36)}`,
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
	const before = await stat(sourceTocPath);

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
			materializeSource: async () => {
				throw new Error("materialize should not run");
			},
		},
	);

	const after = await stat(sourceTocPath);
	assert.equal(
		before.mtimeMs,
		after.mtimeMs,
		"TOC.md should not be rewritten when commit matches",
	);
});

test("sync warns when overwriting existing TOC.md", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-toc-overwrite-${Date.now().toString(36)}`,
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
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const warnings = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk) => {
		const text = chunk instanceof Uint8Array ? chunk.toString() : chunk;
		if (text.includes("Overwriting existing TOC.md")) {
			warnings.push(text);
		}
		return originalWrite(chunk);
	};

	try {
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
					await writeFile(path.join(outDir, "TOC.md"), "old toc", "utf8");
					return { bytes: 5, fileCount: 1 };
				},
			},
		);
	} finally {
		process.stdout.write = originalWrite;
	}

	assert.ok(warnings.length > 0, "expected overwrite warning for TOC.md");
});
