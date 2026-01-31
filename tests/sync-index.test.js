import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const toPosix = (value) => value.split(path.sep).join("/");

test("sync writes index.json when enabled", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-index-${Date.now().toString(36)}`,
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
		index: true,
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

	const indexPath = path.join(cacheDir, "index.json");
	const raw = await readFile(indexPath, "utf8");
	const index = JSON.parse(raw);
	const entry = index.sources.local;

	assert.equal(entry.resolvedCommit, "abc123");
	assert.equal(entry.fileCount, 1);
	assert.equal(entry.cachePath, toPosix(path.join(cacheDir, "local")));
	assert.equal(
		entry.targetDir,
		toPosix(path.resolve(path.dirname(configPath), "target-dir")),
	);
});
