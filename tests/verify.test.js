import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifyCache } from "../dist/api.mjs";

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
		path.join(sourceDir, ".manifest.ndjson"),
		`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
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

test("verify checks target manifest for copy mode", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-verify-target-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const sourceDir = path.join(cacheDir, "local");
	const targetDir = path.join(tmpRoot, "target-copy");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(sourceDir, { recursive: true });
	await mkdir(targetDir, { recursive: true });
	await writeFile(
		path.join(sourceDir, ".manifest.ndjson"),
		`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
	);
	await writeFile(path.join(sourceDir, "README.md"), "hello", "utf8");
	await writeFile(
		path.join(targetDir, ".manifest.ndjson"),
		`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
	);
	await writeFile(path.join(targetDir, "README.md"), "nope", "utf8");
	await writeFile(
		configPath,
		JSON.stringify(
			{
				defaults: { targetMode: "copy" },
				sources: [
					{
						id: "local",
						repo: "https://example.com",
						targetDir: "./target-copy",
					},
				],
			},
			null,
			2,
		),
	);

	const report = await verifyCache({
		configPath,
		cacheDirOverride: cacheDir,
		json: false,
	});

	assert.equal(report.results[0].ok, false);
	assert.ok(
		report.results[0].issues.some((issue) =>
			issue.includes("target size mismatch"),
		),
	);
});
