import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const hashRepoUrl = (repo) =>
	createHash("sha256").update(repo).digest("hex").substring(0, 16);

test("sync removes partial clone cache before fetching", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-partial-unit-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const gitCacheRoot = path.join(tmpRoot, "git-cache");
	const repo = "https://example.com/repo.git";
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
				id: "local",
				repo,
				include: ["README.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const previousGitDir = process.env.DOCS_CACHE_GIT_DIR;
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;

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
					repo,
					ref: "HEAD",
					resolvedCommit: "abc123",
				}),
				fetchSource: async () => ({
					repoDir: tmpRoot,
					cleanup: async () => undefined,
				}),
			},
		);
		assert.equal(await exists(cachePath), false);
	} finally {
		process.env.DOCS_CACHE_GIT_DIR = previousGitDir;
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

const exists = async (target) => {
	try {
		await readFile(target);
		return true;
	} catch {
		return false;
	}
};
