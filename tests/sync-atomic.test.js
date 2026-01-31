import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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

test("sync replaces materialized output atomically", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-atomic-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "a.md"), "alpha", "utf8");
	await writeFile(path.join(repoDir, "b.md"), "beta", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["**/*.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	let resolveCalls = 0;
	const resolveRemoteCommit = async () => {
		resolveCalls += 1;
		return {
			repo: "https://example.com/repo.git",
			ref: "HEAD",
			resolvedCommit: resolveCalls === 1 ? "abc123" : "def456",
		};
	};

	const fetchSource = async () => ({
		repoDir,
		cleanup: async () => undefined,
	});

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

	await rm(path.join(repoDir, "b.md"));
	await writeFile(path.join(repoDir, "c.md"), "gamma", "utf8");

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

	const docsRoot = path.join(cacheDir, "local");
	assert.equal(await exists(path.join(docsRoot, "a.md")), true);
	assert.equal(await exists(path.join(docsRoot, "b.md")), false);
	assert.equal(await exists(path.join(docsRoot, "c.md")), true);
});
