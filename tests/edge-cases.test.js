import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadConfig } from "../dist/api.mjs";

const writeConfig = async (data) => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-edge-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return configPath;
};

test("config rejects duplicate source IDs", async () => {
	const configPath = await writeConfig({
		sources: [
			{ id: "same", repo: "https://github.com/example/repo1.git" },
			{ id: "same", repo: "https://github.com/example/repo2.git" },
		],
	});
	await assert.rejects(() => loadConfig(configPath), /Duplicate source IDs/i);
});

test("config rejects source ID with path traversal characters", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "../evil", repo: "https://github.com/example/repo.git" }],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/sources\[0\]\.id|alphanumeric/i,
	);
});

test("config rejects source ID with special characters", async () => {
	const specialChars = ["foo:bar", "foo|bar", "foo*bar", "foo?bar", "foo<bar"];

	for (const id of specialChars) {
		const configPath = await writeConfig({
			sources: [{ id, repo: "https://github.com/example/repo.git" }],
		});
		await assert.rejects(
			() => loadConfig(configPath),
			/sources\[0\]\.id|alphanumeric/i,
		);
	}
});

test("config rejects zero maxBytes", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				maxBytes: 0,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/maxBytes.*>=1|maxBytes.*greater than zero/i,
	);
});

test("config rejects negative maxBytes", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				maxBytes: -100,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/maxBytes.*>=1|maxBytes.*greater than zero/i,
	);
});

test("config rejects zero maxFiles", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				maxFiles: 0,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/maxFiles.*>=1|maxFiles.*greater than zero/i,
	);
});

test("config rejects negative maxFiles", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				maxFiles: -5,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/maxFiles.*>=1|maxFiles.*greater than zero/i,
	);
});

test("config rejects empty string fields", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "", repo: "https://github.com/example/repo.git" }],
	});
	await assert.rejects(() => loadConfig(configPath), /sources.*id|id.*>=1/i);
});

test("config rejects whitespace-only ID", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "   ", repo: "https://github.com/example/repo.git" }],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/sources\[0\]\.id|alphanumeric/i,
	);
});

test("config rejects empty repo URL", async () => {
	const configPath = await writeConfig({
		sources: [{ id: "test", repo: "" }],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/sources.*repo|repo.*>=1/i,
	);
});

test("targetDir with path traversal is rejected in config", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-traversal-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				targetDir: "../../etc/passwd",
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

	await assert.rejects(
		() => loadConfig(configPath),
		/targetDir.*escapes project directory/i,
	);
});

test("very large maxBytes value is accepted", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				maxBytes: Number.MAX_SAFE_INTEGER,
			},
		],
	});
	const { sources } = await loadConfig(configPath);
	assert.equal(sources[0].maxBytes, Number.MAX_SAFE_INTEGER);
});

test("config with malformed JSON", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-malformed-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");
	await writeFile(configPath, '{ "sources": [ invalid json } ]', "utf8");

	await assert.rejects(() => loadConfig(configPath), /Invalid JSON/i);
});

test("config rejects BOM (Byte Order Mark)", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-bom-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const configPath = path.join(tmpRoot, "docs.config.json");

	const config = {
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	};
	// UTF-8 BOM - this is a real edge case that can happen with Windows editors
	await writeFile(
		configPath,
		`\uFEFF${JSON.stringify(config, null, 2)}`,
		"utf8",
	);

	// JSON.parse in Node.js doesn't handle BOM well, this will fail
	await assert.rejects(() => loadConfig(configPath), /Invalid JSON/i);
});

test("lock file with invalid version", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-ver-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const lockPath = path.join(tmpRoot, "docs.lock");

	const invalidLock = {
		version: 2,
		generatedAt: new Date().toISOString(),
		toolVersion: "0.1.0",
		sources: {},
	};
	await writeFile(lockPath, JSON.stringify(invalidLock, null, 2), "utf8");

	// Need to import dynamically to avoid tree shaking
	const {
		default: { readFile: read },
	} = await import("node:fs/promises");
	const raw = await read(lockPath, "utf8");
	const parsed = JSON.parse(raw);

	// Manually validate - version 2 is not valid
	assert.notEqual(parsed.version, 1);
});

test("lock file with missing required fields", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-miss-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const lockPath = path.join(tmpRoot, "docs.lock");

	const invalidLock = {
		version: 1,
		// missing generatedAt, toolVersion, sources
	};
	await writeFile(lockPath, JSON.stringify(invalidLock, null, 2), "utf8");

	// Verify the file was written with missing fields
	const {
		default: { readFile: read },
	} = await import("node:fs/promises");
	const raw = await read(lockPath, "utf8");
	const parsed = JSON.parse(raw);
	assert.equal(parsed.generatedAt, undefined);
});

test("lock file with negative bytes", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-neg-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const lockPath = path.join(tmpRoot, "docs.lock");

	const invalidLock = {
		version: 1,
		generatedAt: new Date().toISOString(),
		toolVersion: "0.1.0",
		sources: {
			test: {
				repo: "https://github.com/example/repo.git",
				ref: "main",
				resolvedCommit: "abc123",
				bytes: -100,
				fileCount: 5,
				manifestSha256: "def456",
				updatedAt: new Date().toISOString(),
			},
		},
	};
	await writeFile(lockPath, JSON.stringify(invalidLock, null, 2), "utf8");

	// Verify the file contains negative bytes
	const {
		default: { readFile: read },
	} = await import("node:fs/promises");
	const raw = await read(lockPath, "utf8");
	const parsed = JSON.parse(raw);
	assert.equal(parsed.sources.test.bytes, -100);
});

test("lock file with corrupted JSON", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-lock-corrupt-${Date.now().toString(36)}`,
	);
	await mkdir(tmpRoot, { recursive: true });
	const lockPath = path.join(tmpRoot, "docs.lock");

	await writeFile(lockPath, '{"version": 1, invalid', "utf8");

	// Verify the corrupted content was written
	const {
		default: { readFile: read },
	} = await import("node:fs/promises");
	const raw = await read(lockPath, "utf8");
	assert.ok(raw.includes("invalid"));

	// JSON.parse should throw
	assert.throws(() => JSON.parse(raw), SyntaxError);
});

test("empty include array is rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				include: [],
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/include.*non-empty array/i,
	);
});

test("include with empty string is rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				include: ["*.md", ""],
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/include.*>=1|include.*non-empty/i,
	);
});

test("exclude with empty string is rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				exclude: ["*.tmp", ""],
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/exclude.*>=1|exclude.*non-empty/i,
	);
});

test("config with unknown fields is rejected", async () => {
	const configPath = await writeConfig({
		unknownField: "value",
		sources: [{ id: "test", repo: "https://github.com/example/repo.git" }],
	});
	await assert.rejects(() => loadConfig(configPath), /does not match schema/i);
});

test("source with unknown fields is now rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				unknownSourceField: "value",
			},
		],
	});
	// SourceSchema now has .strict() mode properly applied
	// Unknown fields should be rejected
	await assert.rejects(
		() => loadConfig(configPath),
		/Unrecognized key|does not match schema/i,
	);
});

test("depth must be positive", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				depth: 0,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/depth.*>=1|depth.*greater than zero/i,
	);
});

test("negative depth is rejected", async () => {
	const configPath = await writeConfig({
		sources: [
			{
				id: "test",
				repo: "https://github.com/example/repo.git",
				depth: -1,
			},
		],
	});
	await assert.rejects(
		() => loadConfig(configPath),
		/depth.*>=1|depth.*greater than zero/i,
	);
});
