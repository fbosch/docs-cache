import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifyCache } from "../dist/cli.mjs";

test("verify reports missing files", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-verify-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const sourceDir = path.join(cacheDir, "local");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(sourceDir, { recursive: true });
	await writeFile(
		path.join(sourceDir, "manifest.json"),
		JSON.stringify([{ path: "README.md", size: 5 }], null, 2),
	);
	await writeFile(
		configPath,
		JSON.stringify({ sources: [{ id: "local", repo: "https://example.com" }] }),
	);

	const report = await verifyCache({
		configPath,
		cacheDirOverride: cacheDir,
		json: false,
	});

	assert.equal(report.results[0].ok, false);
	assert.ok(report.results[0].issues[0].includes("missing files"));
});
