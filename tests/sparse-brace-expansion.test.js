import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSync } from "../dist/api.mjs";

const hashRepoUrl = (repo) =>
	createHash("sha256").update(repo).digest("hex").substring(0, 16);

const writeGitShim = async (binDir, logPath) => {
	const scriptPath = path.join(
		binDir,
		process.platform === "win32" ? "git.js" : "git",
	);
	const payload = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const logPath = ${JSON.stringify(logPath)};
fs.appendFileSync(logPath, 
  JSON.stringify(process.argv.slice(2)) + "\\n",
  "utf8",
);

const args = process.argv.slice(2);
const isWin = process.platform === "win32";
const normalize = (value) => (isWin ? value.toLowerCase() : value);

if (args.map(normalize).includes("ls-remote")) {
  // Return a fake commit SHA
  console.log("abc123def456789012345678901234567890abcd\\tHEAD");
  process.exit(0);
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

const createTestContext = async (label) => {
	const tmpRoot = path.join(tmpdir(), `${label}-${Date.now().toString(36)}`);
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

	const cleanup = async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	};

	return {
		binDir,
		logPath,
		cacheDir,
		configPath,
		gitCacheRoot,
		repo,
		cleanup,
	};
};

const withModifiedPath = async (binDir, gitCacheRoot, fn) => {
	const saved = {
		PATH: process.env.PATH,
		Path: process.env.Path,
		PATHEXT: process.env.PATHEXT,
		DOCS_CACHE_GIT_DIR: process.env.DOCS_CACHE_GIT_DIR,
	};
	const previousPath = process.env.PATH ?? process.env.Path;
	const nextPath = previousPath
		? `${binDir}${path.delimiter}${previousPath}`
		: binDir;

	process.env.PATH = nextPath;
	process.env.Path = nextPath;
	if (process.platform === "win32") {
		process.env.PATHEXT = ".CMD;.BAT;.EXE;.COM";
	}
	process.env.DOCS_CACHE_GIT_DIR = gitCacheRoot;

	try {
		return await fn();
	} finally {
		process.env.PATH = saved.PATH;
		process.env.Path = saved.Path;
		process.env.PATHEXT = saved.PATHEXT;
		process.env.DOCS_CACHE_GIT_DIR = saved.DOCS_CACHE_GIT_DIR;
	}
};

const getSparsePatterns = (args) => {
	const patternIndex = args.indexOf("set");
	if (patternIndex === -1) return [];
	const noConeIndex = args.indexOf("--no-cone");
	const patternsStart =
		noConeIndex !== -1 && noConeIndex > patternIndex
			? noConeIndex + 1
			: patternIndex + 1;
	return args.slice(patternsStart).filter((arg) => !arg.startsWith("--"));
};

test("sync expands brace patterns for git sparse-checkout", async () => {
	const { binDir, logPath, cacheDir, configPath, gitCacheRoot, repo, cleanup } =
		await createTestContext("docs-cache-brace");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			allowHosts: ["example.com"],
		},
		sources: [
			{
				id: "test",
				repo,
				include: ["**/*.{md,mdx,txt}"],
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	try {
		await withModifiedPath(binDir, gitCacheRoot, async () => {
			await runSync({
				configPath,
				cacheDirOverride: cacheDir,
				json: false,
				lockOnly: false,
				offline: false,
				failOnMiss: false,
			});
		});

		const logRaw = await readFile(logPath, "utf8");
		const lines = logRaw.trim().split("\n").filter(Boolean);
		const sparseCheckoutCalls = lines.filter((line) => {
			try {
				const args = JSON.parse(line);
				return args.includes("sparse-checkout");
			} catch {
				return false;
			}
		});

		assert.ok(
			sparseCheckoutCalls.length > 0,
			"Expected sparse-checkout to be called",
		);

		// Check that brace pattern was expanded into separate patterns
		const sparseArgs = sparseCheckoutCalls.map((call) => JSON.parse(call));
		const hasExpandedPatterns = sparseArgs.some((args) => {
			// Should have expanded **/*.{md,mdx,txt} into:
			// **/*.md, **/*.mdx, **/*.txt
			const patterns = getSparsePatterns(args);
			return (
				patterns.includes("**/*.md") &&
				patterns.includes("**/*.mdx") &&
				patterns.includes("**/*.txt")
			);
		});

		assert.ok(
			hasExpandedPatterns,
			`Expected brace patterns to be expanded. Got: ${JSON.stringify(sparseArgs, null, 2)}`,
		);
	} finally {
		await cleanup();
	}
});

test("sync expands default brace pattern when no include specified", async () => {
	const { binDir, logPath, cacheDir, configPath, gitCacheRoot, repo, cleanup } =
		await createTestContext("docs-cache-default-brace");

	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		defaults: {
			allowHosts: ["example.com"],
		},
		sources: [
			{
				id: "test",
				repo,
				// No include - should use default pattern with brace expansion
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	try {
		await withModifiedPath(binDir, gitCacheRoot, async () => {
			await runSync({
				configPath,
				cacheDirOverride: cacheDir,
				json: false,
				lockOnly: false,
				offline: false,
				failOnMiss: false,
			});
		});

		const logRaw = await readFile(logPath, "utf8");
		const lines = logRaw.trim().split("\n").filter(Boolean);
		const sparseCheckoutCalls = lines.filter((line) => {
			try {
				const args = JSON.parse(line);
				return args.includes("sparse-checkout");
			} catch {
				return false;
			}
		});

		assert.ok(
			sparseCheckoutCalls.length > 0,
			"Expected sparse-checkout to be called with default patterns",
		);

		// Check that default brace pattern was expanded
		const sparseArgs = sparseCheckoutCalls.map((call) => JSON.parse(call));
		const hasExpandedDefaults = sparseArgs.some((args) => {
			const patterns = getSparsePatterns(args);
			// Default is **/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}
			return (
				patterns.includes("**/*.md") &&
				patterns.includes("**/*.mdx") &&
				patterns.includes("**/*.markdown") &&
				patterns.includes("**/*.txt")
			);
		});

		assert.ok(
			hasExpandedDefaults,
			`Expected default brace patterns to be expanded. Got: ${JSON.stringify(sparseArgs, null, 2)}`,
		);
	} finally {
		await cleanup();
	}
});
