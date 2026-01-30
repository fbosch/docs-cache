import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";

const distPath = new URL("../dist/cli.mjs", import.meta.url);

const loadCliModule = async () => {
	try {
		await access(distPath);
	} catch {
		return null;
	}
	return import(distPath.href);
};

test("parseArgs handles flags and numbers", async (t) => {
	const module = await loadCliModule();
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const result = module.parseArgs([
		"node",
		"docs-cache",
		"status",
		"--config",
		"docs.config.json",
		"--cache-dir",
		".docs",
		"--offline",
		"--fail-on-miss",
		"--lock-only",
		"--concurrency",
		"4",
		"--timeout-ms",
		"2000",
		"--json",
	]);

	assert.equal(result.command, "status");
	assert.equal(result.options.config, "docs.config.json");
	assert.equal(result.options.cacheDir, ".docs");
	assert.equal(result.options.offline, true);
	assert.equal(result.options.failOnMiss, true);
	assert.equal(result.options.lockOnly, true);
	assert.equal(result.options.concurrency, 4);
	assert.equal(result.options.timeoutMs, 2000);
	assert.equal(result.options.json, true);
});

test("parseArgs handles add positional args", async (t) => {
	const module = await loadCliModule();
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const result = module.parseArgs([
		"node",
		"docs-cache",
		"add",
		"https://github.com/vitest-dev/vitest.git",
		"github:fbosch/docs-cache",
	]);

	assert.equal(result.command, "add");
	assert.deepEqual(result.positionals, [
		"https://github.com/vitest-dev/vitest.git",
		"github:fbosch/docs-cache",
	]);
});

test("parseArgs handles shorthand repo only", async (t) => {
	const module = await loadCliModule();
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const result = module.parseArgs([
		"node",
		"docs-cache",
		"add",
		"github:fbosch/docs-cache",
	]);

	assert.equal(result.command, "add");
	assert.deepEqual(result.positionals, ["github:fbosch/docs-cache"]);
});

test("parseArgs handles ssh repo only", async (t) => {
	const module = await loadCliModule();
	if (!module) {
		t.skip("CLI not built yet");
		return;
	}
	const result = module.parseArgs([
		"node",
		"docs-cache",
		"add",
		"git@github.com:fbosch/docs-cache.git",
	]);

	assert.equal(result.command, "add");
	assert.deepEqual(result.positionals, [
		"git@github.com:fbosch/docs-cache.git",
	]);
});
