import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("materialize respects include/exclude patterns", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-include-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(repoDir, "docs", ".cache"), { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "readme", "utf8");
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");
	await writeFile(
		path.join(repoDir, "docs", ".cache", "skip.md"),
		"skip",
		"utf8",
	);
	await writeFile(path.join(repoDir, "notes.txt"), "notes", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["docs/**", "README.md"],
				exclude: ["docs/**/.cache/**"],
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
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), true);
	assert.equal(
		await exists(path.join(docsRoot, "docs", ".cache", "skip.md")),
		false,
	);
	assert.equal(await exists(path.join(docsRoot, "notes.txt")), false);
});

test("hidden files are included when ignoreHidden is false", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-hidden-default-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "visible.md"), "visible", "utf8");
	await writeFile(path.join(repoDir, ".hidden.md"), "hidden", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["**/*"],
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
	assert.equal(await exists(path.join(docsRoot, "visible.md")), true);
	assert.equal(await exists(path.join(docsRoot, ".hidden.md")), true);
});

test("ignoreHidden excludes dotfiles", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-hidden-ignore-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "visible.md"), "visible", "utf8");
	await writeFile(path.join(repoDir, ".hidden.md"), "hidden", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["**/*"],
				ignoreHidden: true,
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
	assert.equal(await exists(path.join(docsRoot, "visible.md")), true);
	assert.equal(await exists(path.join(docsRoot, ".hidden.md")), false);
});

test("ignoreHidden excludes nested hidden directories", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-hidden-nested-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(repoDir, "docs", ".git"), { recursive: true });
	await mkdir(path.join(repoDir, "src", ".vscode"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");
	await writeFile(
		path.join(repoDir, "docs", ".git", "config"),
		"config",
		"utf8",
	);
	await writeFile(
		path.join(repoDir, "src", ".vscode", "settings.json"),
		"{}",
		"utf8",
	);

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["**/*"],
				ignoreHidden: true,
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
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), true);
	assert.equal(
		await exists(path.join(docsRoot, "docs", ".git", "config")),
		false,
	);
	assert.equal(
		await exists(path.join(docsRoot, "src", ".vscode", "settings.json")),
		false,
	);
});

test("defaults exclude applies when source excludes are unset", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-include-defaults-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(repoDir, "docs", ".cache"), { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "readme", "utf8");
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");
	await writeFile(
		path.join(repoDir, "docs", ".cache", "skip.md"),
		"skip",
		"utf8",
	);

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			include: ["docs/**", "README.md"],
			exclude: ["docs/**/.cache/**"],
		},
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
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
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), true);
	assert.equal(
		await exists(path.join(docsRoot, "docs", ".cache", "skip.md")),
		false,
	);
});

test("exclude overrides include on overlap", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-overlap-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["docs/**"],
				exclude: ["docs/guide.md"],
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
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), false);
});

test("sync re-materializes when include rules change", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-rules-${Date.now().toString(36)}`,
	);
	const cacheDir = path.join(tmpRoot, ".docs");
	const repoDir = path.join(tmpRoot, "repo");
	const configPath = path.join(tmpRoot, "docs.config.json");

	await mkdir(path.join(repoDir, "docs"), { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "readme", "utf8");
	await writeFile(path.join(repoDir, "docs", "guide.md"), "guide", "utf8");

	const baseConfig = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["docs/**"],
			},
		],
	};
	await writeFile(
		configPath,
		`${JSON.stringify(baseConfig, null, 2)}\n`,
		"utf8",
	);

	const syncOptions = {
		configPath,
		cacheDirOverride: cacheDir,
		json: false,
		lockOnly: false,
		offline: false,
		failOnMiss: false,
	};
	const deps = {
		resolveRemoteCommit: async () => ({
			repo: "https://example.com/repo.git",
			ref: "HEAD",
			resolvedCommit: "abc123",
		}),
		fetchSource: async () => ({
			repoDir,
			cleanup: async () => undefined,
		}),
	};

	await runSync(syncOptions, deps);

	const docsRoot = path.join(cacheDir, "local");
	assert.equal(await exists(path.join(docsRoot, "README.md")), false);
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), true);

	const updatedConfig = {
		...baseConfig,
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				include: ["README.md"],
			},
		],
	};
	await writeFile(
		configPath,
		`${JSON.stringify(updatedConfig, null, 2)}\n`,
		"utf8",
	);

	await runSync(syncOptions, deps);

	assert.equal(await exists(path.join(docsRoot, "README.md")), true);
	assert.equal(await exists(path.join(docsRoot, "docs", "guide.md")), false);
});
