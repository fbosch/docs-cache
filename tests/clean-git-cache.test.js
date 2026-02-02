import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const distPath = new URL("../dist/api.mjs", import.meta.url);

const loadApiModule = async (cacheBuster) => {
	try {
		await access(distPath);
	} catch {
		return null;
	}
	return import(`${distPath.href}?t=${cacheBuster}`);
};

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("cleanGitCache removes configured cache dir", async (t) => {
	const module = await loadApiModule(Date.now());
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const previous = process.env.DOCS_CACHE_GIT_DIR;
	const cacheRoot = path.join(
		tmpdir(),
		`docs-cache-git-${Date.now().toString(36)}`,
	);
	process.env.DOCS_CACHE_GIT_DIR = cacheRoot;

	try {
		await mkdir(path.join(cacheRoot, "repo-a"), { recursive: true });
		await mkdir(path.join(cacheRoot, "repo-b"), { recursive: true });
		const filePath = path.join(cacheRoot, "repo-b", "data.txt");
		const payload = "x".repeat(1024);
		await writeFile(filePath, payload, "utf8");

		const result = await module.cleanGitCache({ json: false });
		assert.equal(result.removed, true);
		assert.equal(result.repoCount, 2);
		assert.equal(await exists(cacheRoot), false);
		assert.ok(result.bytesFreed >= payload.length);
	} finally {
		process.env.DOCS_CACHE_GIT_DIR = previous;
		await rm(cacheRoot, { recursive: true, force: true });
	}
});

test("cleanGitCache returns removed false when cache is missing", async (t) => {
	const module = await loadApiModule(Date.now() + 1);
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const previous = process.env.DOCS_CACHE_GIT_DIR;
	const cacheRoot = path.join(
		tmpdir(),
		`docs-cache-git-missing-${Date.now().toString(36)}`,
	);
	process.env.DOCS_CACHE_GIT_DIR = cacheRoot;

	try {
		const result = await module.cleanGitCache({ json: false });
		assert.equal(result.removed, false);
		assert.equal(result.cacheDir, cacheRoot);
	} finally {
		process.env.DOCS_CACHE_GIT_DIR = previous;
		await rm(cacheRoot, { recursive: true, force: true });
	}
});
