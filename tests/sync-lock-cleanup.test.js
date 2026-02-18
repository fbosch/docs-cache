import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("sync removes lock entries for sources removed from config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-cleanup-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs-lock.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "a.md"), "alpha", "utf8");

	// Initial config with two sources
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "source-one",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
			},
			{
				id: "source-two",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	let resolveCallCount = 0;
	const resolveRemoteCommit = async ({ repo }) => {
		resolveCallCount += 1;
		return {
			repo,
			ref: "HEAD",
			resolvedCommit: `commit-${resolveCallCount}`,
		};
	};

	const fetchSource = async () => ({
		repoDir,
		cleanup: async () => undefined,
		fromCache: false,
	});

	// First sync with both sources
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
		},
	);

	// Verify lock contains both sources
	assert.equal(await exists(lockPath), true);
	const lockContent1 = await readFile(lockPath, "utf8");
	const lock1 = JSON.parse(lockContent1);
	assert.ok(lock1.sources["source-one"]);
	assert.ok(lock1.sources["source-two"]);

	// Update config to remove source-two
	config.sources = [
		{
			id: "source-one",
			repo: "https://example.com/repo.git",
			include: ["**/*.md"],
		},
	];
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	// Second sync with only source-one
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
		},
	);

	// Verify lock only contains source-one
	const lockContent2 = await readFile(lockPath, "utf8");
	const lock2 = JSON.parse(lockContent2);
	assert.ok(lock2.sources["source-one"], "source-one should still be in lock");
	assert.equal(
		lock2.sources["source-two"],
		undefined,
		"source-two should be removed from lock",
	);
	assert.equal(
		Object.keys(lock2.sources).length,
		1,
		"lock should only have one source",
	);
});

test("sync preserves lock entries for sources still in config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-preserve-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs-lock.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "a.md"), "alpha", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "source-one",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const resolveRemoteCommit = async ({ repo }) => ({
		repo,
		ref: "HEAD",
		resolvedCommit: "fixed-commit",
	});

	const fetchSource = async () => ({
		repoDir,
		cleanup: async () => undefined,
		fromCache: false,
	});

	// First sync
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
		},
	);

	// Second sync with same config
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
		},
	);

	// Verify source is still in lock
	const lockContent2 = await readFile(lockPath, "utf8");
	const lock2 = JSON.parse(lockContent2);
	assert.ok(lock2.sources["source-one"], "source-one should still be in lock");
	assert.equal(lock2.sources["source-one"].resolvedCommit, "fixed-commit");
});
