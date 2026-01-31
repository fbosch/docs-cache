import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { initConfig } from "../dist/api.mjs";

const stubPrompts = (answers) => ({
	confirm: async () => answers.index,
	isCancel: () => false,
	select: async () => answers.location,
	text: async (options) => {
		if (options.message === "Cache directory") {
			return answers.cacheDir;
		}
		return "";
	},
});

test("init fails when docs.config.json exists", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(
		path.join(tmpRoot, "docs.config.json"),
		JSON.stringify({ sources: [] }, null, 2),
	);

	await assert.rejects(
		() => initConfig({ json: false, cwd: tmpRoot }),
		/Config already exists/i,
	);
});

test("init fails when package.json has docs-cache", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-pkg-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(
		path.join(tmpRoot, "package.json"),
		JSON.stringify({ name: "x", version: "0.0.0", "docs-cache": {} }),
	);

	await assert.rejects(
		() => initConfig({ json: false, cwd: tmpRoot }),
		/Config already exists/i,
	);
});

test("init writes docs.config.json when selected", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-config-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(
		path.join(tmpRoot, "package.json"),
		JSON.stringify({ name: "x", version: "0.0.0" }),
	);

	const configPath = path.join(tmpRoot, "docs.config.json");
	await initConfig(
		{ json: false, cwd: tmpRoot },
		stubPrompts({
			location: "config",
			cacheDir: ".docs",
			index: true,
		}),
	);

	const raw = await readFile(configPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.index, true);
	assert.equal(Array.isArray(config.sources), true);
	assert.equal(config.defaults, undefined);
});

test("init writes package.json docs-cache when selected", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-package-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const packagePath = path.join(tmpRoot, "package.json");
	await writeFile(packagePath, JSON.stringify({ name: "x", version: "0.0.0" }));

	await initConfig(
		{ json: false, cwd: tmpRoot },
		stubPrompts({
			location: "package",
			cacheDir: ".docs",
			index: false,
		}),
	);

	const raw = await readFile(packagePath, "utf8");
	const pkg = JSON.parse(raw);
	assert.ok(pkg["docs-cache"]);
	assert.equal(pkg["docs-cache"].index, undefined);
	assert.equal(pkg["docs-cache"].cacheDir, undefined);
	assert.equal(pkg["docs-cache"].defaults, undefined);
});
