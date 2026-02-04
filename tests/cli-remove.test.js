import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const exists = async (target) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

test("remove drops sources from docs.config.json", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-remove.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"fbosch/nixos",
		"fbosch/dotfiles",
		"--config",
		tmpPath,
	]);

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"remove",
		"--config",
		tmpPath,
		"nixos",
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 1);
	assert.equal(config.sources[0].id, "dotfiles");
});

test("remove deletes target dirs", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-targets.json`);
	const targetDir = path.join(tmpdir(), `docs-cache-target-${Date.now()}`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"--source",
		"fbosch/nixos",
		"--target",
		targetDir,
		"--config",
		tmpPath,
	]);

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"remove",
		"--config",
		tmpPath,
		"nixos",
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 0);
	assert.equal(await exists(targetDir), false);
});

test("remove supports multiple ids", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-multi.json`);
	const targetOne = path.join(tmpdir(), `docs-cache-target-${Date.now()}-1`);
	const targetTwo = path.join(tmpdir(), `docs-cache-target-${Date.now()}-2`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"--source",
		"fbosch/nixos",
		"--target",
		targetOne,
		"--source",
		"fbosch/dotfiles",
		"--target",
		targetTwo,
		"--config",
		tmpPath,
	]);

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"remove",
		"--config",
		tmpPath,
		"nixos",
		"dotfiles",
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 0);
	assert.equal(await exists(targetOne), false);
	assert.equal(await exists(targetTwo), false);
});

test("remove accepts repo shorthands", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-short.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"fbosch/nixos",
		"--config",
		tmpPath,
	]);

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"remove",
		"--config",
		tmpPath,
		"github:fbosch/nixos",
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 0);
});

test("remove errors when package.json lacks docs-cache", async () => {
	const tmpRoot = path.join(tmpdir(), `docs-cache-pkg-${Date.now()}`);
	const packagePath = path.join(tmpRoot, "package.json");
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(packagePath, JSON.stringify({ name: "docs-cache" }), "utf8");
	await assert.rejects(
		execFileAsync("node", [
			"bin/docs-cache.mjs",
			"remove",
			"--config",
			packagePath,
			"nixos",
		]),
		(error) =>
			error instanceof Error &&
			error.message.includes("Missing docs-cache config"),
	);
});
