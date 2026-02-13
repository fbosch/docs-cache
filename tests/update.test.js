import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { updateSources } from "../dist/api.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("update dry-run returns plan and does not write lock", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-update-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs-lock.json");

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [{ id: "a", repo: "https://example.com/a.git", ref: "main" }],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = await updateSources(
		{
			configPath,
			ids: ["a"],
			all: false,
			dryRun: true,
			json: false,
			lockOnly: true,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	assert.equal(result.dryRun, true);
	assert.equal(result.plan.results.length, 1);
	assert.equal(await exists(lockPath), false);
});

test("update lock-only writes lock for selected source", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-update-lock-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs-lock.json");

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [
					{ id: "a", repo: "https://example.com/a.git", ref: "main" },
					{ id: "b", repo: "https://example.com/b.git", ref: "main" },
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	await updateSources(
		{
			configPath,
			ids: ["a"],
			all: false,
			dryRun: false,
			json: false,
			lockOnly: true,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	const lockRaw = await readFile(lockPath, "utf8");
	const lock = JSON.parse(lockRaw);
	assert.ok(lock.sources.a);
	assert.equal(lock.sources.b, undefined);
});
