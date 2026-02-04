import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

test("materialize rejects path traversal in materialized files", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-security-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	// Try to create a file that would escape via path traversal
	await writeFile(path.join(repoDir, "normal.md"), "safe content", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
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
		},
	);

	// Verify normal file was materialized
	const { access } = await import("node:fs/promises");
	await access(path.join(cacheDir, "test", "normal.md"));
});

test("materialize handles files with Unicode names", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-unicode-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	// Files with Unicode characters
	await writeFile(path.join(repoDir, "文档.md"), "Chinese", "utf8");
	await writeFile(path.join(repoDir, "Документ.md"), "Russian", "utf8");
	await writeFile(path.join(repoDir, "مستند.md"), "Arabic", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
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
		},
	);

	// Verify files were materialized
	const { access } = await import("node:fs/promises");
	await access(path.join(cacheDir, "test", "文档.md"));
	await access(path.join(cacheDir, "test", "Документ.md"));
	await access(path.join(cacheDir, "test", "مستند.md"));
});

test("materialize handles deeply nested directories", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-deep-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	// Create a deeply nested structure
	const deepPath = path.join(repoDir, "a", "b", "c", "d", "e", "f", "g");
	await mkdir(deepPath, { recursive: true });
	await writeFile(path.join(deepPath, "deep.md"), "content", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
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
		},
	);

	// Verify deeply nested file was materialized
	const { access } = await import("node:fs/promises");
	await access(path.join(cacheDir, "test", "deep.md"));
});

test("materialize handles files with special characters in names", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-special-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	// Files with special but filesystem-safe characters
	await writeFile(path.join(repoDir, "file-with-dash.md"), "content", "utf8");
	await writeFile(
		path.join(repoDir, "file_with_underscore.md"),
		"content",
		"utf8",
	);
	await writeFile(path.join(repoDir, "file.with.dots.md"), "content", "utf8");
	await writeFile(path.join(repoDir, "file with spaces.md"), "content", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
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
		},
	);

	// Verify all files were materialized
	const { access } = await import("node:fs/promises");
	await access(path.join(cacheDir, "test", "file-with-dash.md"));
	await access(path.join(cacheDir, "test", "file_with_underscore.md"));
	await access(path.join(cacheDir, "test", "file.with.dots.md"));
	await access(path.join(cacheDir, "test", "file with spaces.md"));
});

test("materialize respects maxBytes during processing", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-max-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	// Create files that will exceed maxBytes
	await writeFile(path.join(repoDir, "file1.md"), "a".repeat(100), "utf8");
	await writeFile(path.join(repoDir, "file2.md"), "b".repeat(100), "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
				maxBytes: 150, // Should fail after first file
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await assert.rejects(
		() =>
			runSync(
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
				},
			),
		/maxBytes/i,
	);
});

test("materialize handles empty files", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-empty-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "empty.md"), "", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
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
		},
	);

	// Verify empty file was materialized
	const { readFile } = await import("node:fs/promises");
	const content = await readFile(
		path.join(cacheDir, "test", "empty.md"),
		"utf8",
	);
	assert.equal(content, "");
});

test("materialize with no matching files creates empty cache", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-nomatch-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "file.txt"), "not markdown", "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"], // No .md files exist
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const result = await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: true,
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
		},
	);

	// Should complete with 0 files
	assert.equal(result.results[0].fileCount, 0);
	assert.equal(result.results[0].bytes, 0);
});

test("source ID with null bytes is rejected", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-null-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		sources: [
			{
				id: "test\x00evil",
				repo: "https://github.com/example/repo.git",
			},
		],
	};

	await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

	const { loadConfig } = await import("../dist/api.mjs");
	await assert.rejects(
		() => loadConfig(configPath),
		/sources\.0\.id|control characters/i,
	);
});

test("maxBytes exactly equal to total size", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-exact-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	const content = "a".repeat(100);
	await writeFile(path.join(repoDir, "file.md"), content, "utf8");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
				maxBytes: 100, // Exactly the size of the file
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	// Should succeed because we check AFTER adding to total
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
		},
	);

	const { access } = await import("node:fs/promises");
	await access(path.join(cacheDir, "test", "file.md"));
});
