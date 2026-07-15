import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_LOCK_FILENAME, runSync } from "../dist/api.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const writeConfig = async (tmpRoot, extra = {}, topLevel = {}) => {
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				...topLevel,
				sources: [
					{
						id: "local",
						repo: "https://example.com/repo.git",
						ref: "main",
						...extra,
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return configPath;
};

test("install materializes from lock without rewriting it", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-install-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = await writeConfig(tmpRoot, { targetDir: "./target" });
	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "main",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	const lockPath = path.join(tmpRoot, DEFAULT_LOCK_FILENAME);
	const lockBefore = await readFile(lockPath, "utf8");
	let fetchCommit = null;
	let materialized = false;

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
			install: true,
		},
		{
			resolveRemoteCommit: async () => {
				throw new Error("install should not resolve remote refs");
			},
			fetchSource: async ({ resolvedCommit }) => {
				fetchCommit = resolvedCommit;
				return { repoDir, cleanup: async () => undefined };
			},
			materializeSource: async ({ cacheDir: cacheRoot, sourceId }) => {
				materialized = true;
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				await writeFile(
					path.join(outDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
				);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				return {
					bytes: 5,
					fileCount: 1,
					manifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				};
			},
		},
	);

	assert.equal(fetchCommit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	assert.equal(materialized, true);
	assert.equal(await exists(path.join(cacheDir, "local", "README.md")), true);
	assert.equal(await exists(path.join(tmpRoot, "target", "README.md")), true);
	assert.equal(await readFile(lockPath, "utf8"), lockBefore);
});

test("install fails when lock rules do not match config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-install-rules-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = await writeConfig(tmpRoot, { include: ["docs/**/*.md"] });
	await writeFile(
		path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
		`${JSON.stringify({
			version: 1,
			toolVersion: "0.1.0",
			sources: {
				local: {
					repo: "https://example.com/repo.git",
					ref: "main",
					resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					bytes: 0,
					fileCount: 0,
					manifestSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					rulesSha256: "stale",
				},
			},
		})}\n`,
		"utf8",
	);

	await assert.rejects(
		() =>
			runSync({
				configPath,
				json: false,
				lockOnly: false,
				offline: false,
				failOnMiss: false,
				install: true,
			}),
		/Install failed: lock is out of date/i,
	);
});

test("install fails when lock repo or ref does not match config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-install-drift-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = await writeConfig(tmpRoot);

	await runSync(
		{
			configPath,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "main",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	await writeConfig(tmpRoot, {
		repo: "https://example.com/other.git",
		ref: "v1",
	});

	await assert.rejects(
		() =>
			runSync({
				configPath,
				json: false,
				lockOnly: false,
				offline: false,
				failOnMiss: false,
				install: true,
			}),
		/Install failed: lock is out of date/i,
	);
});

test("install and lock-only ignore a missing OpenCode config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-install-opencode-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = await writeConfig(
		tmpRoot,
		{},
		{ opencode: { configPath: path.join(tmpRoot, "missing-opencode.json") } },
	);
	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	const resolveRemoteCommit = async () => ({
		repo: "https://example.com/repo.git",
		ref: "main",
		resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	});

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
		},
		{ resolveRemoteCommit },
	);

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
			install: true,
		},
		{
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
			}),
			materializeSource: async ({ cacheDir: outputRoot, sourceId }) => {
				const outputDir = path.join(outputRoot, sourceId);
				await mkdir(outputDir, { recursive: true });
				await writeFile(path.join(outputDir, "README.md"), "hello", "utf8");
				await writeFile(
					path.join(outputDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
				);
				return { bytes: 5, fileCount: 1, manifestSha256: "manifest" };
			},
		},
	);
});
