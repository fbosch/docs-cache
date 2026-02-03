import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
		"--offline",
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

test("add supports multiple github shorthands", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-multi.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"fbosch/nixos",
		"fbosch/dotfiles",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 2);
	assert.equal(config.sources[0].repo, "https://github.com/fbosch/nixos.git");
	assert.equal(
		config.sources[1].repo,
		"https://github.com/fbosch/dotfiles.git",
	);
});

test("add supports explicit ids", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-id.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"--id",
		"ux-design",
		"https://github.com/fbosch/docs-cache.git",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources[0].id, "ux-design");
	assert.equal(
		config.sources[0].repo,
		"https://github.com/fbosch/docs-cache.git",
	);
});

test("add supports explicit ids for multiple sources", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-ids.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"--id",
		"ux-nixos",
		"fbosch/nixos",
		"--id",
		"ux-dotfiles",
		"fbosch/dotfiles",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 2);
	assert.equal(config.sources[0].id, "ux-nixos");
	assert.equal(config.sources[1].id, "ux-dotfiles");
});

test("add skips existing sources", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-skip.json`);
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
		"add",
		"--offline",
		"fbosch/nixos",
		"fbosch/notes",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources.length, 3);
});

test("add supports per-source target dirs", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-targets.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"--source",
		"fbosch/nixos",
		"--target",
		"./docs/one",
		"--source",
		"fbosch/dotfiles",
		"--target",
		"./docs/two",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources[0].targetDir, "./docs/one");
	assert.equal(config.sources[1].targetDir, "./docs/two");
});

test("add supports full https gitlab url", async () => {
	const tmpPath = path.join(tmpdir(), `docs-config-${Date.now()}-gitlab.json`);
	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"https://gitlab.com/acme/docs.git",
		"--config",
		tmpPath,
	]);

	const raw = await readFile(tmpPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.sources[0].repo, "https://gitlab.com/acme/docs.git");
});

test("add writes package.json without default fields", async () => {
	const tmpRoot = path.join(tmpdir(), `docs-cache-add-package-${Date.now()}`);
	await mkdir(tmpRoot, { recursive: true });
	const packagePath = path.join(tmpRoot, "package.json");
	await writeFile(
		packagePath,
		JSON.stringify({ name: "x", version: "0.0.0" }),
		"utf8",
	);

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"https://github.com/fbosch/docs-cache.git",
		"--config",
		packagePath,
	]);

	const raw = await readFile(packagePath, "utf8");
	const pkg = JSON.parse(raw);
	assert.ok(pkg["docs-cache"]);
	assert.equal(pkg["docs-cache"].cacheDir, undefined);
	assert.equal(pkg["docs-cache"].index, undefined);
	assert.equal(pkg["docs-cache"].defaults, undefined);
	assert.equal(pkg["docs-cache"].targetMode, undefined);
});

test("add writes .gitignore when initializing config", async () => {
	const tmpRoot = path.join(tmpdir(), `docs-cache-add-gitignore-${Date.now()}`);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	await execFileAsync("node", [
		"bin/docs-cache.mjs",
		"add",
		"--offline",
		"https://github.com/fbosch/docs-cache.git",
		"--config",
		configPath,
	]);

	const raw = await readFile(path.join(tmpRoot, ".gitignore"), "utf8");
	assert.match(raw, /^\.docs\/$/m);
});
