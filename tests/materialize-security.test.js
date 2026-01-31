import assert from "node:assert/strict";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/cli.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("materialize enforces maxBytes limit", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-max-bytes-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "123456", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["README.md"],
				maxBytes: 5,
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

test("materialize skips symlinked files", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-symlink-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const outsidePath = path.join(tmpRoot, "outside.md");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	await writeFile(outsidePath, "outside", "utf8");
	await symlink(outsidePath, path.join(repoDir, "linked.md"));

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["README.md", "linked.md"],
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

	const docsRoot = path.join(cacheDir, "local");
	assert.equal(await exists(path.join(docsRoot, "README.md")), true);
	assert.equal(await exists(path.join(docsRoot, "linked.md")), false);
});
