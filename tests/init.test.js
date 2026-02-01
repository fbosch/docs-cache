import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { initConfig } from "../dist/api.mjs";

const stubPrompts = (answers, callbacks = {}) => ({
	confirm: async (options) => {
		if (options.message?.startsWith("Generate TOC.md")) {
			return answers.toc;
		}
		if (options.message === "Add cache directory to .gitignore") {
			if (callbacks.onGitignorePrompt) {
				callbacks.onGitignorePrompt();
			}
			return answers.gitignore ?? true;
		}
		return false;
	},
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
			toc: true,
			gitignore: true,
		}),
	);

	const raw = await readFile(configPath, "utf8");
	const config = JSON.parse(raw);
	assert.equal(config.toc, true);
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
			toc: false,
			gitignore: false,
		}),
	);

	const raw = await readFile(packagePath, "utf8");
	const pkg = JSON.parse(raw);
	assert.ok(pkg["docs-cache"]);
	assert.equal(pkg["docs-cache"].toc, undefined);
	assert.equal(pkg["docs-cache"].cacheDir, undefined);
	assert.equal(pkg["docs-cache"].defaults, undefined);
});

test("init writes .gitignore entry when missing", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-gitignore-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(
		path.join(tmpRoot, "package.json"),
		JSON.stringify({ name: "x", version: "0.0.0" }),
	);

	await initConfig(
		{ json: false, cwd: tmpRoot },
		stubPrompts({
			location: "config",
			cacheDir: ".docs",
			toc: false,
			gitignore: true,
		}),
	);

	const raw = await readFile(path.join(tmpRoot, ".gitignore"), "utf8");
	assert.match(raw, /^\.docs\/$/m);
});

test("init skips gitignore prompt when entry exists", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-init-gitignore-skip-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	await writeFile(
		path.join(tmpRoot, "package.json"),
		JSON.stringify({ name: "x", version: "0.0.0" }),
	);
	await writeFile(path.join(tmpRoot, ".gitignore"), ".docs/\n", "utf8");

	let prompted = false;
	await initConfig(
		{ json: false, cwd: tmpRoot },
		stubPrompts(
			{
				location: "config",
				cacheDir: ".docs",
				toc: false,
			},
			{
				onGitignorePrompt: () => {
					prompted = true;
				},
			},
		),
	);

	assert.equal(prompted, false);
});
