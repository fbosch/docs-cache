import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { pinSources } from "../dist/api.mjs";

test("pin updates specified source refs to resolved commit", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-pin-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [
					{ id: "a", repo: "https://example.com/a.git", ref: "main" },
					{ id: "b", repo: "https://example.com/b.git", ref: "develop" },
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = await pinSources(
		{
			configPath,
			ids: ["a"],
			all: false,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	assert.equal(result.updated.length, 1);
	assert.equal(result.updated[0].id, "a");
	assert.equal(result.missing.length, 0);

	const updatedRaw = await readFile(configPath, "utf8");
	const updated = JSON.parse(updatedRaw);
	assert.equal(
		updated.sources.find((source) => source.id === "a").ref,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	);
	assert.equal(
		updated.sources.find((source) => source.id === "b").ref,
		"develop",
	);
});

test("pin supports --all and reports missing ids", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-pin-all-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [
					{ id: "a", repo: "https://example.com/a.git", ref: "main" },
					{
						id: "b",
						repo: "https://example.com/b.git",
						ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const allResult = await pinSources(
		{
			configPath,
			ids: [],
			all: true,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: repo.includes("/a.git")
					? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
					: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			}),
		},
	);

	assert.equal(allResult.updated.length, 1);
	assert.deepEqual(allResult.unchanged, ["b"]);

	const missingResult = await pinSources(
		{
			configPath,
			ids: ["missing"],
			all: false,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	).catch((error) => error);

	assert.match(String(missingResult), /No matching sources found to pin/i);
});

test("pin --dry-run previews changes without writing config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-pin-dry-run-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

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
	const before = await readFile(configPath, "utf8");

	const result = await pinSources(
		{
			configPath,
			ids: ["a"],
			all: false,
			dryRun: true,
		},
		{
			resolveRemoteCommit: async ({ repo, ref }) => ({
				repo,
				ref,
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	const after = await readFile(configPath, "utf8");
	assert.equal(result.dryRun, true);
	assert.equal(result.updated.length, 1);
	assert.equal(before, after);
});

test("pin normalizes whitespace around already pinned refs", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-pin-trim-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [
					{
						id: "a",
						repo: "https://example.com/a.git",
						ref: "  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ",
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = await pinSources({
		configPath,
		ids: ["a"],
		all: false,
	});

	assert.equal(result.updated.length, 0);
	assert.equal(result.unchanged.length, 1);
	assert.equal(
		result.pinned[0].toRef,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	);

	const updatedRaw = await readFile(configPath, "utf8");
	const updated = JSON.parse(updatedRaw);
	assert.equal(
		updated.sources.find((source) => source.id === "a").ref,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	);
});
