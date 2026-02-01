import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadConfig } from "../dist/api.mjs";

const writeConfig = async (data) => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-val-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return configPath;
};

test("config rejects duplicate source IDs", async () => {
	const configPath = await writeConfig({
		sources: [
			{ id: "duplicate", repo: "https://github.com/example/repo1.git" },
			{ id: "duplicate", repo: "https://github.com/example/repo2.git" },
		],
	});

	// Should now reject duplicate IDs
	await assert.rejects(() => loadConfig(configPath), /Duplicate source IDs/i);
});

test("sourceId with forward slash is rejected", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "org/repo", repo: "https://github.com/example/repo.git" }],
	});

	await assert.rejects(
		() => loadConfig(configPath),
		/sources\[0\]\.id|alphanumeric/i,
	);
});

test("sourceId with backslash is rejected", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "org\\repo", repo: "https://github.com/example/repo.git" }],
	});

	await assert.rejects(
		() => loadConfig(configPath),
		/sources\[0\]\.id|alphanumeric/i,
	);
});

test("very long source ID is rejected", async () => {
	const longId = "a".repeat(300);
	const configPath = await writeConfig({
		sources: [{ id: longId, repo: "https://github.com/example/repo.git" }],
	});

	await assert.rejects(() => loadConfig(configPath), /exceeds maximum length/i);
});

test("source ID allows hyphen and underscore", async () => {
	const ids = ["test-repo", "test_repo", "test123", "TEST_ok"];

	for (const id of ids) {
		const configPath = await writeConfig({
			sources: [{ id, repo: "https://github.com/example/repo.git" }],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].id, id);
	}
});

test("source ID rejects dots and at-signs", async () => {
	const ids = ["test.repo", "test@v1.0", "a.b", "a@b"];

	for (const id of ids) {
		const configPath = await writeConfig({
			sources: [{ id, repo: "https://github.com/example/repo.git" }],
		});
		await assert.rejects(
			() => loadConfig(configPath),
			/sources\[0\]\.id|alphanumeric/i,
		);
	}
});

test("targetDir with absolute path is rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				targetDir: "/absolute/path",
			},
		],
	});

	await assert.rejects(
		() => loadConfig(configPath),
		/targetDir.*escapes project directory/i,
	);
});

test("targetDir with Windows-style path is allowed", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				targetDir: "C:\\Users\\test\\docs",
			},
		],
	});

	if (process.platform === "win32") {
		await assert.rejects(
			() => loadConfig(configPath),
			/targetDir.*escapes project directory/i,
		);
		return;
	}

	const { sources } = await loadConfig(configPath);
	assert.equal(sources[0].targetDir, "C:\\Users\\test\\docs");
});

test("repo URL with various protocols", async () => {
	const urls = [
		"https://github.com/user/repo.git",
		"http://example.com/repo.git",
		"git@github.com:user/repo.git",
		"ssh://git@github.com/user/repo.git",
		"file:///local/path/repo.git",
	];

	for (const repo of urls) {
		const configPath = await writeConfig({
			sources: [{ id: `test-${urls.indexOf(repo)}`, repo }],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].repo, repo);
	}
});

test("ref with various formats", async () => {
	const refs = [
		"main",
		"master",
		"v1.0.0",
		"feature/branch-name",
		"refs/heads/main",
		"refs/tags/v1.0.0",
		"abcdef1234567890", // commit SHA
	];

	for (const ref of refs) {
		const configPath = await writeConfig({
			sources: [
				{
					id: `test-${refs.indexOf(ref)}`,
					repo: "https://github.com/example/repo.git",
					ref,
				},
			],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].ref, ref);
	}
});

test("include patterns with various glob syntaxes", async () => {
	const patterns = [
		"**/*.md",
		"docs/**",
		"*.{md,mdx}",
		"!(node_modules)/**",
		"**/*.[mM][dD]", // case variations
		"path/to/specific/file.md",
	];

	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				include: patterns,
			},
		],
	});

	const { sources } = await loadConfig(configPath);
	assert.deepEqual(sources[0].include, patterns);
});

test("exclude patterns with various syntaxes", async () => {
	const patterns = [
		"**/node_modules/**",
		"**/*.test.md",
		"temp/**",
		"**/.*", // hidden files
	];

	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				exclude: patterns,
			},
		],
	});

	const { sources } = await loadConfig(configPath);
	assert.deepEqual(sources[0].exclude, patterns);
});

test("maxBytes at boundary values", async () => {
	const values = [1, 1000, 1000000, 1000000000];

	for (const maxBytes of values) {
		const configPath = await writeConfig({
			sources: [
				{
					id: `test-${values.indexOf(maxBytes)}`,
					repo: "https://github.com/example/repo.git",
					maxBytes,
				},
			],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].maxBytes, maxBytes);
	}
});

test("maxFiles at boundary values", async () => {
	const values = [1, 10, 100, 1000, 10000];

	for (const maxFiles of values) {
		const configPath = await writeConfig({
			sources: [
				{
					id: `test-${values.indexOf(maxFiles)}`,
					repo: "https://github.com/example/repo.git",
					maxFiles,
				},
			],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].maxFiles, maxFiles);
	}
});

test("integrity with null value", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				integrity: {
					type: "commit",
					value: null,
				},
			},
		],
	});

	const { sources } = await loadConfig(configPath);
	assert.equal(sources[0].integrity.type, "commit");
	assert.equal(sources[0].integrity.value, null);
});

test("integrity with manifest type", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				integrity: {
					type: "manifest",
					value: "sha256-abcdef...",
				},
			},
		],
	});

	const { sources } = await loadConfig(configPath);
	assert.equal(sources[0].integrity.type, "manifest");
	assert.equal(sources[0].integrity.value, "sha256-abcdef...");
});

test("required field with various boolean values", async () => {
	for (const required of [true, false]) {
		const configPath = await writeConfig({
			sources: [
				{
					id: `test-${required}`,
					repo: "https://github.com/example/repo.git",
					required,
				},
			],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].required, required);
	}
});

test("depth values from 1 to higher numbers", async () => {
	const depths = [1, 2, 5, 10, 100];

	for (const depth of depths) {
		const configPath = await writeConfig({
			sources: [
				{
					id: `test-${depths.indexOf(depth)}`,
					repo: "https://github.com/example/repo.git",
					depth,
				},
			],
		});
		const { sources } = await loadConfig(configPath);
		assert.equal(sources[0].depth, depth);
	}
});

test("config with empty sources array", async () => {
	const configPath = await writeConfig({
		sources: [],
	});

	// Empty sources is technically valid
	const { sources } = await loadConfig(configPath);
	assert.equal(sources.length, 0);
});

test("config with only defaults, no sources", async () => {
	const configPath = await writeConfig({
		defaults: {
			ref: "develop",
		},
		sources: [],
	});

	const { config, sources } = await loadConfig(configPath);
	assert.equal(sources.length, 0);
	assert.equal(config.defaults.ref, "develop");
});

test("cacheDir with relative path", async () => {
	const configPath = await writeConfig({
		cacheDir: "./custom-cache",
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});

	const { config } = await loadConfig(configPath);
	assert.equal(config.cacheDir, "./custom-cache");
});

test("cacheDir with absolute path", async () => {
	const configPath = await writeConfig({
		cacheDir: "/tmp/docs-cache",
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});

	const { config } = await loadConfig(configPath);
	assert.equal(config.cacheDir, "/tmp/docs-cache");
});

test("toc flag set to true in defaults", async () => {
	const configPath = await writeConfig({
		defaults: {
			toc: true,
		},
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});

	const { config } = await loadConfig(configPath);
	assert.equal(config.defaults.toc, true);
});

test("targetMode at root level", async () => {
	const configPath = await writeConfig({
		targetMode: "copy",
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});

	const { config } = await loadConfig(configPath);
	assert.equal(config.targetMode, "copy");
});

test("defaults with all fields specified", async () => {
	const configPath = await writeConfig({
		defaults: {
			ref: "main",
			mode: "materialize",
			include: ["**/*.md"],
			targetMode: "copy",
			depth: 1,
			required: false,
			maxBytes: 1000000,
			maxFiles: 100,
			allowHosts: ["github.com"],
			toc: true,
		},
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});

	const { config } = await loadConfig(configPath);
	assert.equal(config.defaults.ref, "main");
	assert.equal(config.defaults.mode, "materialize");
	assert.equal(config.defaults.targetMode, "copy");
	assert.equal(config.defaults.depth, 1);
	assert.equal(config.defaults.required, false);
	assert.equal(config.defaults.maxBytes, 1000000);
	assert.equal(config.defaults.maxFiles, 100);
	assert.deepEqual(config.defaults.allowHosts, ["github.com"]);
	assert.equal(config.defaults.toc, true);
});
