import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { cleanCache, pruneCache } from "../dist/cli.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("clean removes cache directory", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-clean-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(cacheDir, "alpha"), { recursive: true });

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "alpha",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const result = await cleanCache({
		configPath,
		cacheDirOverride: cacheDir,
		json: false,
	});

	assert.equal(result.removed, true);
	assert.equal(await exists(cacheDir), false);
});

test("prune removes cache dirs not in config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-prune-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(cacheDir, "keep"), { recursive: true });
	await mkdir(path.join(cacheDir, "remove"), { recursive: true });

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "keep",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const result = await pruneCache({
		configPath,
		cacheDirOverride: cacheDir,
		json: false,
	});

	assert.deepEqual(result.removed, ["remove"]);
	assert.equal(await exists(path.join(cacheDir, "keep")), true);
	assert.equal(await exists(path.join(cacheDir, "remove")), false);
});
