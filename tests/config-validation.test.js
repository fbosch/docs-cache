import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadConfig } from "../dist/cli.mjs";

const writeConfig = async (data) => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-config-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return configPath;
};

const writePackageConfig = async (data) => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-package-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const packagePath = path.join(tmpRoot, "package.json");
	const payload = {
		name: "docs-cache-test",
		version: "0.0.0",
		"docs-cache": data,
	};
	await writeFile(packagePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	return packagePath;
};

test("loadConfig rejects non-object config", async () => {
	const configPath = await writeConfig([]);
	await assert.rejects(
		() => loadConfig(configPath),
		/Config must be a JSON object/i,
	);
});

test("loadConfig requires sources array", async () => {
	const configPath = await writeConfig({});
	await assert.rejects(
		() => loadConfig(configPath),
		/expected array|sources must be an array|required/i,
	);
});

test("loadConfig rejects invalid default targetMode", async () => {
	const configPath = await writeConfig({
		defaults: { targetMode: "mirror" },
		sources: [],
	});
	await assert.rejects(() => loadConfig(configPath), /defaults.targetMode/i);
});

test("loadConfig rejects invalid source targetMode", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
				targetMode: "mirror",
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/sources\.0\.targetMode|sources\[0\]\.targetMode/i,
	);
});

test("loadConfig rejects non-string repo", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "local",
				repo: 123,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/sources\.0\.repo|sources\[0\]\.repo/i,
	);
});

test("loadConfig supports package.json docs-cache config", async () => {
	const packagePath = await writePackageConfig({
		sources: [
			{
				id: "local",
				repo: "https://example.com/repo.git",
			},
		],
	});
	const { config } = await loadConfig(packagePath);
	assert.equal(config.sources.length, 1);
});
