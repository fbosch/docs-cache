import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_LOCK_FILENAME, runSync } from "../dist/api.mjs";

test("sync writes lock toolVersion from package.json", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-tool-version-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	const cacheDir = path.join(tmpRoot, ".docs");

	await writeFile(
		configPath,
		JSON.stringify(
			{
				$schema:
					"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
				sources: [
					{
						id: "local",
						repo: "https://example.com/repo.git",
					},
				],
			},
			null,
			2,
		),
		"utf8",
	);
	await writeFile(
		path.join(tmpRoot, "package.json"),
		JSON.stringify({
			name: "not-docs-cache",
			version: "9.9.9",
		}),
		"utf8",
	);

	const originalCwd = process.cwd();
	try {
		process.chdir(tmpRoot);
		await runSync({
			configPath,
			cacheDirOverride: cacheDir,
			json: true,
			lockOnly: true,
			offline: true,
			failOnMiss: false,
		});
	} finally {
		process.chdir(originalCwd);
	}

	const lockRaw = await readFile(
		path.join(tmpRoot, DEFAULT_LOCK_FILENAME),
		"utf8",
	);
	const lock = JSON.parse(lockRaw);
	const pkgRaw = await readFile(
		new URL("../package.json", import.meta.url),
		"utf8",
	);
	const pkg = JSON.parse(pkgRaw);
	assert.equal(lock.toolVersion, pkg.version);
});
