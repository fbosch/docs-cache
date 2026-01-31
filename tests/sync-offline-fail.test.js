import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

test("sync fails on missing required sources when failOnMiss true", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-fail-on-miss-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "missing",
				repo: "https://example.com/repo.git",
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
					lockOnly: true,
					offline: false,
					failOnMiss: true,
				},
				{
					resolveRemoteCommit: async () => ({
						repo: "https://example.com/repo.git",
						ref: "HEAD",
						resolvedCommit: "abc123",
					}),
				},
			),
		/Missing required source/i,
	);
});

test("sync offline uses lock entries without resolving remotes", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-offline-lock-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs.lock");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	await writeFile(
		lockPath,
		JSON.stringify({
			version: 1,
			generatedAt: new Date().toISOString(),
			toolVersion: "0.1.0",
			sources: {
				local: {
					repo: "https://example.com/repo.git",
					ref: "HEAD",
					resolvedCommit: "abc123",
					bytes: 4,
					fileCount: 1,
					manifestSha256: "abc123",
					updatedAt: new Date().toISOString(),
				},
			},
		}),
	);
	const cacheSourceDir = path.join(cacheDir, "local");
	await mkdir(cacheSourceDir, { recursive: true });
	await writeFile(
		path.join(cacheSourceDir, ".manifest.jsonl"),
		`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
	);
	await writeFile(path.join(cacheSourceDir, "README.md"), "hello", "utf8");

	await runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: true,
			offline: true,
			failOnMiss: true,
		},
		{
			resolveRemoteCommit: async () => {
				throw new Error("Should not resolve while offline");
			},
		},
	);

	const updatedLockRaw = await readFile(lockPath, "utf8");
	const updatedLock = JSON.parse(updatedLockRaw);
	assert.equal(updatedLock.sources.local.resolvedCommit, "abc123");
	assert.equal(updatedLock.sources.local.fileCount, 1);
});

test("sync offline fails when lock exists but cache missing", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-offline-missing-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const lockPath = path.join(tmpRoot, "docs.lock");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	await writeFile(
		lockPath,
		JSON.stringify({
			version: 1,
			generatedAt: new Date().toISOString(),
			toolVersion: "0.1.0",
			sources: {
				local: {
					repo: "https://example.com/repo.git",
					ref: "HEAD",
					resolvedCommit: "abc123",
					bytes: 4,
					fileCount: 1,
					manifestSha256: "abc123",
					updatedAt: new Date().toISOString(),
				},
			},
		}),
	);

	await assert.rejects(
		() =>
			runSync({
				configPath,
				cacheDirOverride: cacheDir,
				json: false,
				lockOnly: true,
				offline: true,
				failOnMiss: true,
			}),
		/Missing required source/i,
	);
});
