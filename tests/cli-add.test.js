import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("add supports ssh shorthand with ref", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--config",
		tmpPath,
		"git@github.com:fbosch/docs-cache.git#main",
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources[0].id, "docs-cache");
	assert.equal(config.sources[0].repo, "git@github.com:fbosch/docs-cache.git");
	assert.equal(config.sources[0].ref, "main");
});
