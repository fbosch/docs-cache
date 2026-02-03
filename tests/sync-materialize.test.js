import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("sync materializes via mocked fetch", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-sync-${Date.now().toString(36)}`,
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

	assert.equal(await exists(path.join(cacheDir, "local")), true);
	const lockRaw = await readFile(
		path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
		"utf8",
	);
	const lock = JSON.parse(lockRaw);
	assert.equal(lock.sources.local.resolvedCommit, "abc123");
	assert.equal(lock.sources.local.fileCount, 1);
});

test("sync re-materializes when docs missing even if commit unchanged", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-missing-${Date.now().toString(36)}`,
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

	await writeFile(
		path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
		JSON.stringify({
			version: 1,
			generatedAt: new Date().toISOString(),
			toolVersion: "0.1.0",
			sources: {
				local: {
					repo: "https://example.com/repo.git",
					ref: "HEAD",
					resolvedCommit: "abc123",
					bytes: 0,
					fileCount: 0,
					manifestSha256: "abc123",
					updatedAt: new Date().toISOString(),
				},
			},
		}),
	);

	let materialized = false;
	let attempt = 0;
	const manifestPath = path.join(cacheDir, "local", ".manifest.jsonl");
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
				materialized = true;
				attempt += 1;
				const outDir = path.join(cacheRoot, sourceId);
				await mkdir(outDir, { recursive: true });
				const entries = attempt === 1 ? [] : [{ path: "README.md", size: 5 }];
				const manifestData = entries.length
					? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
					: "";
				await writeFile(manifestPath, manifestData);
				await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
				return { bytes: 5, fileCount: 1 };
			},
		},
	);

	assert.equal(materialized, true);
});

test("sync offline fails when required source missing", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-offline-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "missing",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await assert.rejects(
		() =>
			runSync({
				configPath,
				cacheDirOverride: cacheDir,
				json: false,
				lockOnly: false,
				offline: true,
				failOnMiss: true,
			}),
		/missing/i,
	);
});

test("sync target can unwrap single root directory", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-unwrap-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["17/umbraco-forms/**"],
				unwrapSingleRootDir: true,
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	const repoFile = path.join(repoDir, "17", "umbraco-forms", "README.md");
	await mkdir(path.dirname(repoFile), { recursive: true });
	await writeFile(repoFile, "hello", "utf8");

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

	assert.equal(await exists(path.join(cacheDir, "local", "README.md")), true);
	assert.equal(
		await exists(
			path.join(cacheDir, "local", "17", "umbraco-forms", "README.md"),
		),
		false,
	);
});

test("sync re-materializes when unwrapSingleRootDir changes", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-unwrap-toggle-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	const repoFile = path.join(repoDir, "17", "umbraco-forms", "README.md");
	await mkdir(path.dirname(repoFile), { recursive: true });
	await writeFile(repoFile, "hello", "utf8");

	const writeConfigWithUnwrap = async (unwrapSingleRootDir) => {
		const config = {
			$schema:
				"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
			sources: [
				{
					id: "local",
					repo: "https://example.com/repo.git",
					include: ["17/umbraco-forms/**"],
					unwrapSingleRootDir,
				},
			],
		};
		await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	};

	const run = async () =>
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
		);

	await writeConfigWithUnwrap(false);
	await run();
	assert.equal(
		await exists(
			path.join(cacheDir, "local", "17", "umbraco-forms", "README.md"),
		),
		true,
	);

	await writeConfigWithUnwrap(true);
	await run();
	assert.equal(await exists(path.join(cacheDir, "local", "README.md")), true);
});

test("sync offline allows missing optional sources", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-offline-optional-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "optional",
				repo: "https://example.com/repo.git",
				required: false,
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
			offline: true,
			failOnMiss: true,
		},
		{
			resolveRemoteCommit: async () => {
				throw new Error("Should not be called while offline");
			},
			fetchSource: async () => {
				throw new Error("Should not be called while offline");
			},
		},
	);
});

test("sync rebuilds corrupt cache when verify fails", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-corrupt-${Date.now().toString(36)}`,
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
				include: ["README.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	let materializeCalls = 0;
	const resolveRemoteCommit = async () => ({
		repo: "https://example.com/repo.git",
		ref: "HEAD",
		resolvedCommit: "abc123",
	});
	const fetchSource = async () => ({
		repoDir,
		cleanup: async () => undefined,
	});
	const materializeSource = async ({ cacheDir: cacheRoot, sourceId }) => {
		materializeCalls += 1;
		const outDir = path.join(cacheRoot, sourceId);
		await mkdir(outDir, { recursive: true });
		await writeFile(
			path.join(outDir, ".manifest.jsonl"),
			`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
		);
		await writeFile(path.join(outDir, "README.md"), "hello", "utf8");
		return { bytes: 5, fileCount: 1 };
	};

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
			resolveRemoteCommit,
			fetchSource,
			materializeSource,
		},
	);

	await rm(path.join(cacheDir, "local", "README.md"));

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
			resolveRemoteCommit,
			fetchSource,
			materializeSource,
		},
	);

	assert.equal(materializeCalls, 2);
});
