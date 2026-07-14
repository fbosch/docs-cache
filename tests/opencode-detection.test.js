import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
	detectOpenCodeConfig,
	getOpenCodeConfigCandidates,
} from "../dist/api.mjs";

test("OpenCode detection gives JSON precedence over JSONC", async () => {
	const root = path.join(
		tmpdir(),
		`docs-cache-opencode-detect-${Date.now().toString(36)}`,
	);
	const openCodeDir = path.join(root, ".opencode");
	await mkdir(openCodeDir, { recursive: true });
	await writeFile(path.join(root, ".git"), "gitdir: /tmp/unused\n", "utf8");
	await writeFile(path.join(root, "opencode.json"), "{}\n", "utf8");
	await writeFile(path.join(root, "opencode.jsonc"), "{}\n", "utf8");
	await writeFile(path.join(openCodeDir, "opencode.json"), "{}\n", "utf8");
	const expected = path.join(openCodeDir, "opencode.json");
	const customConfigDir = path.join(root, "custom-opencode");
	const customConfigPath = path.join(customConfigDir, "opencode.jsonc");
	await writeFile(expected, "{}\n", "utf8");
	await mkdir(customConfigDir, { recursive: true });
	await writeFile(customConfigPath, "{}\n", "utf8");

	const previousHome = process.env.HOME;
	const previousCustomDir = process.env.OPENCODE_CONFIG_DIR;
	process.env.HOME = root;
	delete process.env.OPENCODE_CONFIG_DIR;
	try {
		assert.equal(await detectOpenCodeConfig(root), expected);
		process.env.OPENCODE_CONFIG_DIR = customConfigDir;
		assert.equal(await detectOpenCodeConfig(root), customConfigPath);
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousCustomDir === undefined) {
			delete process.env.OPENCODE_CONFIG_DIR;
		} else {
			process.env.OPENCODE_CONFIG_DIR = previousCustomDir;
		}
	}
});

test("OpenCode detection disables project config only for true or 1", async () => {
	const root = path.join(
		tmpdir(),
		`docs-cache-opencode-disable-${Date.now().toString(36)}`,
	);
	const project = path.join(root, "project");
	const home = path.join(root, "home");
	await mkdir(project, { recursive: true });
	await mkdir(home, { recursive: true });
	await writeFile(path.join(project, ".git"), "gitdir: /tmp/unused\n", "utf8");
	const configPath = path.join(project, "opencode.json");
	await writeFile(configPath, "{}\n", "utf8");

	const previousHome = process.env.HOME;
	const previousValue = process.env.OPENCODE_DISABLE_PROJECT_CONFIG;
	process.env.HOME = home;
	try {
		process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "false";
		assert.ok(
			(await getOpenCodeConfigCandidates(project)).includes(configPath),
		);
		process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "0";
		assert.ok(
			(await getOpenCodeConfigCandidates(project)).includes(configPath),
		);
		process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
		assert.ok(
			!(await getOpenCodeConfigCandidates(project)).includes(configPath),
		);
		process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
		assert.ok(
			!(await getOpenCodeConfigCandidates(project)).includes(configPath),
		);
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousValue === undefined) {
			delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG;
		} else {
			process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previousValue;
		}
	}
});
