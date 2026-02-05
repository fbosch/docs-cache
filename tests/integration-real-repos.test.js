import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_LOCK_FILENAME, runSync } from "../dist/api.mjs";

const shouldRun = () => process.env.DOCS_CACHE_INTEGRATION === "1";

const hashRepoUrl = (repo) =>
	createHash("sha256").update(repo).digest("hex").substring(0, 16);

test("integration syncs a real repository", async (t) => {
	if (!shouldRun()) {
		t.skip("Set DOCS_CACHE_INTEGRATION=1 to run integration tests");
		return;
	}
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-integration-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const repo = "https://github.com/github/gitignore.git";

	await mkdir(tmpRoot, { recursive: true });
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "gitignore",
				repo,
				include: ["README.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	try {
		await runSync({
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		});
		const lockRaw = await readFile(
			path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
			"utf8",
		);
		const lock = JSON.parse(lockRaw);
		assert.ok(lock.sources.gitignore);
	} finally {
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

test("integration clears partial clone cache before sync", async (t) => {
	if (!shouldRun()) {
		t.skip("Set DOCS_CACHE_INTEGRATION=1 to run integration tests");
		return;
	}
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-partial-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const gitCacheRoot = path.join(tmpRoot, "git-cache");
	const repo = "https://github.com/github/gitignore.git";
	const cachePath = path.join(gitCacheRoot, hashRepoUrl(repo));

	await mkdir(path.join(cachePath, ".git"), { recursive: true });
	await writeFile(
		path.join(cachePath, ".git", "config"),
		'[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://example.com/repo.git\n[extensions]\n\tpartialclone = origin\n[remote "origin"]\n\tpromisor = true\n\tpartialclonefilter = blob:none\n',
		"utf8",
	);

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "gitignore",
				repo,
				include: ["README.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const previousGitDir = process.env.DOCS_CACHE_GIT_DIR;
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;

	try {
		await runSync({
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		});
		const lockRaw = await readFile(
			path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
			"utf8",
		);
		const lock = JSON.parse(lockRaw);
		assert.ok(lock.sources.gitignore);
		const configRaw = await readFile(
			path.join(cachePath, ".git", "config"),
			"utf8",
		);
		assert.equal(configRaw.includes("partialclone"), false);
		assert.equal(configRaw.includes("promisor"), false);
	} finally {
		process.env.DOCS_CACHE_GIT_DIR = previousGitDir;
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

test("integration uses default include pattern without explicit config", async (t) => {
	if (!shouldRun()) {
		t.skip("Set DOCS_CACHE_INTEGRATION=1 to run integration tests");
		return;
	}
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-defaults-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const repo = "https://github.com/glanceapp/glance.git";

	await mkdir(tmpRoot, { recursive: true });
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "glance",
				repo,
				// No include pattern specified - should use defaults
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	try {
		await runSync({
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
		});
		const lockRaw = await readFile(
			path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
			"utf8",
		);
		const lock = JSON.parse(lockRaw);
		assert.ok(lock.sources.glance);
		// The default pattern includes **/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}
		// glanceapp/glance has markdown files, so fileCount should be > 0
		assert.ok(
			lock.sources.glance.fileCount > 0,
			`Expected files to be synced with default include pattern, got ${lock.sources.glance.fileCount}`,
		);
		// Verify that actual .md files were synced
		const readmePath = path.join(cacheDir, "glance", "README.md");
		const readmeContent = await readFile(readmePath, "utf8");
		assert.ok(
			readmeContent.length > 0,
			"Expected README.md to be synced and have content",
		);
	} finally {
		await rm(tmpRoot, { recursive: true, force: true });
	}
});
