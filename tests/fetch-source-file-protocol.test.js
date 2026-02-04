import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const hashRepoUrl = (repo) =>
	createHash("sha256").update(repo).digest("hex").substring(0, 16);

const writeGitShim = async (binDir, logPath, options = {}) => {
	const scriptPath = path.join(
		binDir,
		process.platform === "win32" ? "git.js" : "git",
	);
	const { failCatFile = false } = options;
	const payload = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const logPath = ${JSON.stringify(logPath)};
fs.appendFileSync(logPath, \
  JSON.stringify(process.argv.slice(2)) + "\\n",
  "utf8",
);

const args = process.argv.slice(2);
const isWin = process.platform === "win32";
const normalize = (value) => (isWin ? value.toLowerCase() : value);
if (args.map(normalize).includes("archive")) {
  process.exit(1);
}

if (${JSON.stringify(failCatFile)} && args.map(normalize).includes("cat-file")) {
  process.exit(1);
}

if (args.map(normalize).includes("clone")) {
  const outDir = args[args.length - 1];
  fs.mkdirSync(outDir, { recursive: true });
}

if (args.map(normalize).includes("checkout")) {
  process.exit(0);
}

process.exit(0);
`;
	await writeFile(scriptPath, payload, "utf8");
	if (process.platform !== "win32") {
		await chmod(scriptPath, 0o755);
		return;
	}
	const cmdPath = path.join(binDir, "git.cmd");
	const cmdPayload = `@echo off
"${process.execPath}" "${scriptPath}" %*
`;
	await writeFile(cmdPath, cmdPayload, "utf8");
};

test("sync uses file protocol allowlist for local cache checkout", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-git-protocol-${Date.now().toString(36)}`,
	);
	const binDir = path.join(tmpRoot, "bin");
	const logPath = path.join(tmpRoot, "git.log");
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const gitCacheRoot = path.join(tmpRoot, "git-cache");
	const repo = "https://example.com/repo.git";
	const repoHash = hashRepoUrl(repo);
	const cachePath = path.join(gitCacheRoot, repoHash);

	await mkdir(binDir, { recursive: true });
	await mkdir(cachePath, { recursive: true });
	await writeGitShim(binDir, logPath);
	await writeFile(logPath, "", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo,
				include: ["docs"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const previousPath = process.env.PATH ?? process.env.Path;
	const previousPathExt = process.env.PATHEXT;
	const previousGitDir = process.env.DOCS_CACHE_GIT_DIR;
	const nextPath =
		process.platform === "win32"
			? binDir
			: `${binDir}${path.delimiter}${previousPath ?? ""}`;
	process.env.PATH = nextPath;
	process.env.Path = nextPath;
	if (process.platform === "win32") {
		process.env.PATHEXT = previousPathExt ?? ".COM;.EXE;.BAT;.CMD";
	}
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;
	process.env.GIT_TERMINAL_PROMPT = "0";

	try {
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
					repo,
					ref: "HEAD",
					resolvedCommit: "abc123",
				}),
			},
		);

		const logRaw = await readFile(logPath, "utf8");
		const entries = logRaw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		assert.ok(entries.length > 0, "expected git shim to be invoked");
		const checkout = entries.find((args) => args.includes("checkout"));
		assert.ok(checkout, "expected checkout to run via git shim");
		assert.ok(
			checkout.includes("protocol.file.allow=always"),
			"expected checkout to allow file protocol",
		);
		const sparse = entries.find((args) => args.includes("sparse-checkout"));
		assert.ok(sparse, "expected sparse-checkout to run via git shim");
		assert.ok(
			sparse.includes("protocol.file.allow=always"),
			"expected sparse-checkout to allow file protocol",
		);
	} finally {
		process.env.PATH = previousPath;
		process.env.Path = previousPath;
		process.env.PATHEXT = previousPathExt;
		process.env.DOCS_CACHE_GIT_DIR = previousGitDir;
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

test("sync uses no-cone sparse for mixed include patterns", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-git-protocol-${Date.now().toString(36)}`,
	);
	const binDir = path.join(tmpRoot, "bin");
	const logPath = path.join(tmpRoot, "git.log");
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const gitCacheRoot = path.join(tmpRoot, "git-cache");
	const repo = "https://example.com/repo.git";
	const repoHash = hashRepoUrl(repo);
	const cachePath = path.join(gitCacheRoot, repoHash);

	await mkdir(binDir, { recursive: true });
	await mkdir(cachePath, { recursive: true });
	await writeGitShim(binDir, logPath);
	await writeFile(logPath, "", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo,
				include: ["Configuration.md", "**/others/*.md"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const previousPath = process.env.PATH ?? process.env.Path;
	const previousPathExt = process.env.PATHEXT;
	const previousGitDir = process.env.DOCS_CACHE_GIT_DIR;
	const nextPath =
		process.platform === "win32"
			? binDir
			: `${binDir}${path.delimiter}${previousPath ?? ""}`;
	process.env.PATH = nextPath;
	process.env.Path = nextPath;
	if (process.platform === "win32") {
		process.env.PATHEXT = previousPathExt ?? ".COM;.EXE;.BAT;.CMD";
	}
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;
	process.env.GIT_TERMINAL_PROMPT = "0";

	try {
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
					repo,
					ref: "HEAD",
					resolvedCommit: "abc123",
				}),
			},
		);

		const logRaw = await readFile(logPath, "utf8");
		const entries = logRaw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const sparse = entries.find((args) => args.includes("sparse-checkout"));
		assert.ok(sparse, "expected sparse-checkout to run via git shim");
		assert.ok(sparse.includes("--no-cone"), "expected no-cone sparse mode");
		assert.ok(
			sparse.includes("Configuration.md"),
			"expected literal include pattern",
		);
		assert.ok(
			sparse.includes("**/others/*.md"),
			"expected mixed glob include pattern",
		);
	} finally {
		process.env.PATH = previousPath;
		process.env.Path = previousPath;
		process.env.PATHEXT = previousPathExt;
		process.env.DOCS_CACHE_GIT_DIR = previousGitDir;
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

test("sync fetches missing commit from local cache", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-git-missing-commit-${Date.now().toString(36)}`,
	);
	const binDir = path.join(tmpRoot, "bin");
	const logPath = path.join(tmpRoot, "git.log");
	const cacheDir = path.join(tmpRoot, ".docs");
	const configPath = path.join(tmpRoot, "docs.config.json");
	const gitCacheRoot = path.join(tmpRoot, "git-cache");
	const repo = "https://example.com/repo.git";
	const repoHash = hashRepoUrl(repo);
	const cachePath = path.join(gitCacheRoot, repoHash);

	await mkdir(binDir, { recursive: true });
	await mkdir(cachePath, { recursive: true });
	await writeGitShim(binDir, logPath, { failCatFile: true });
	await writeFile(logPath, "", "utf8");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "local",
				repo,
				include: ["docs"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	const previousPath = process.env.PATH ?? process.env.Path;
	const previousPathExt = process.env.PATHEXT;
	const previousGitDir = process.env.DOCS_CACHE_GIT_DIR;
	const nextPath =
		process.platform === "win32"
			? binDir
			: `${binDir}${path.delimiter}${previousPath ?? ""}`;
	process.env.PATH = nextPath;
	process.env.Path = nextPath;
	if (process.platform === "win32") {
		process.env.PATHEXT = previousPathExt ?? ".COM;.EXE;.BAT;.CMD";
	}
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;
	process.env.GIT_TERMINAL_PROMPT = "0";

	try {
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
					repo,
					ref: "HEAD",
					resolvedCommit: "abc123",
				}),
			},
		);

		const logRaw = await readFile(logPath, "utf8");
		const entries = logRaw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const fetchEntries = entries.filter(
			(args) => args.includes("fetch") && args.includes("abc123"),
		);
		assert.ok(fetchEntries.length > 0, "expected fetch of missing commit");
		const fileProtocolFetch = fetchEntries.find((args) =>
			args.includes("protocol.file.allow=always"),
		);
		assert.ok(fileProtocolFetch, "expected fetch to allow file protocol");
	} finally {
		process.env.PATH = previousPath;
		process.env.Path = previousPath;
		process.env.PATHEXT = previousPathExt;
		process.env.DOCS_CACHE_GIT_DIR = previousGitDir;
		await rm(tmpRoot, { recursive: true, force: true });
	}
});
