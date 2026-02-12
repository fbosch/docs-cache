import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const writeConfig = async (tmpRoot) => {
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				sources: [{ id: "local", repo: "https://example.com/repo.git" }],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return configPath;
};

test("sync --frozen fails when lock drifts", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-frozen-fail-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = await writeConfig(tmpRoot);

	await runSync(
		{
			configPath,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	await assert.rejects(
		() =>
			runSync(
				{
					configPath,
					json: false,
					lockOnly: true,
					offline: false,
					failOnMiss: false,
					frozen: true,
				},
				{
					resolveRemoteCommit: async () => ({
						repo: "https://example.com/repo.git",
						ref: "HEAD",
						resolvedCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					}),
				},
			),
		/Frozen sync failed/i,
	);
});

test("sync --frozen passes when lock is current", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-frozen-pass-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = await writeConfig(tmpRoot);

	await runSync(
		{
			configPath,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);

	await runSync(
		{
			configPath,
			json: false,
			lockOnly: true,
			offline: false,
			failOnMiss: false,
			frozen: true,
		},
		{
			resolveRemoteCommit: async () => ({
				repo: "https://example.com/repo.git",
				ref: "HEAD",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
		},
	);
});
