import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "jsonc-parser";

import { runSync } from "../dist/api.mjs";

process.env.XDG_STATE_HOME = path.join(
	tmpdir(),
	`docs-cache-opencode-state-${Date.now()}-${Math.random()}`,
);

const createRoot = async (name) => {
	const root = path.join(
		tmpdir(),
		`docs-cache-opencode-${name}-${Date.now()}-${Math.random()}`,
	);
	await mkdir(root, { recursive: true });
	return root;
};

const writeDocsConfig = async (root, sources, opencode) => {
	const configPath = path.join(root, "docs.config.json");
	await writeFile(
		configPath,
		`${JSON.stringify({ opencode, sources }, null, 2)}\n`,
		"utf8",
	);
	return configPath;
};

const sync = async (configPath, cacheDir, options = {}) => {
	const repoDir = path.join(path.dirname(configPath), "repo");
	await mkdir(repoDir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "hello", "utf8");
	return runSync(
		{
			configPath,
			cacheDirOverride: cacheDir,
			json: false,
			lockOnly: false,
			offline: false,
			failOnMiss: false,
			...options,
		},
		{
			resolveRemoteCommit: async ({ repo }) => ({
				repo,
				ref: "HEAD",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
			fetchSource: async () => ({
				repoDir,
				cleanup: async () => undefined,
				fromCache: false,
			}),
			materializeSource: async ({ cacheDir: outputRoot, sourceId }) => {
				const outputDir = path.join(outputRoot, sourceId);
				await mkdir(outputDir, { recursive: true });
				await writeFile(path.join(outputDir, "README.md"), "hello", "utf8");
				await writeFile(
					path.join(outputDir, ".manifest.jsonl"),
					`${JSON.stringify({ path: "README.md", size: 5 })}\n`,
					"utf8",
				);
				return { bytes: 5, fileCount: 1, manifestSha256: "manifest" };
			},
		},
	);
};

test("sync creates canonical OpenCode references and preserves JSONC", async () => {
	const root = await createRoot("create");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.jsonc");
	await writeFile(
		openCodePath,
		`{
	// Keep this user-owned configuration.
	"model": "test/model",
	"references": {
		"user-docs": { "path": "/user/docs", "description": "User docs" },
	},
}
`,
		"utf8",
	);
	const configPath = await writeDocsConfig(
		root,
		[
			{
				id: "hyprland-wiki",
				repo: "https://github.com/hyprwm/hyprland-wiki.git",
				targetDir: "./unused-target",
			},
		],
		{ configPath: openCodePath },
	);

	await sync(configPath, cacheDir);

	const raw = await readFile(openCodePath, "utf8");
	const config = parse(raw);
	assert.match(raw, /Keep this user-owned configuration/);
	assert.equal(config.model, "test/model");
	assert.deepEqual(config.references["user-docs"], {
		path: "/user/docs",
		description: "User docs",
	});
	assert.deepEqual(config.references["hyprland-wiki"], {
		path: path.join(cacheDir, "hyprland-wiki"),
		description: "Use for documentation from hyprwm/hyprland-wiki.",
	});

	const lock = JSON.parse(
		await readFile(path.join(root, "docs-lock.json"), "utf8"),
	);
	assert.deepEqual(lock.opencode, {
		configPath: openCodePath,
		aliases: ["hyprland-wiki"],
	});
});

test("sync updates managed reference paths when the cache directory changes", async () => {
	const root = await createRoot("update");
	const openCodePath = path.join(root, "opencode.json");
	await writeFile(openCodePath, "{}\n", "utf8");
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: openCodePath },
	);
	const firstCacheDir = path.join(root, ".docs-one");
	const secondCacheDir = path.join(root, ".docs-two");

	await sync(configPath, firstCacheDir);
	await sync(configPath, secondCacheDir);

	const config = JSON.parse(await readFile(openCodePath, "utf8"));
	assert.deepEqual(config.references.docs, {
		path: path.join(secondCacheDir, "docs"),
		description: "Use for documentation from example/docs.",
	});
});

test("sync preserves a symlinked OpenCode config", {
	skip: process.platform === "win32",
}, async () => {
	const root = await createRoot("symlink");
	const cacheDir = path.join(root, ".docs");
	const targetPath = path.join(root, "managed-opencode.jsonc");
	const openCodePath = path.join(root, "opencode.jsonc");
	await writeFile(targetPath, "{}\n", "utf8");
	await symlink(path.basename(targetPath), openCodePath);
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: openCodePath },
	);

	await sync(configPath, cacheDir);

	assert.equal((await lstat(openCodePath)).isSymbolicLink(), true);
	const config = parse(await readFile(targetPath, "utf8"));
	assert.deepEqual(config.references.docs, {
		path: path.join(cacheDir, "docs"),
		description: "Use for documentation from example/docs.",
	});
});

test("sync fails before overwriting a user-owned OpenCode reference", async () => {
	const root = await createRoot("collision");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.json");
	const original = `{
  "references": {
    "docs": { "path": "/user/docs" }
  }
}
`;
	await writeFile(openCodePath, original, "utf8");
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: openCodePath },
	);

	await assert.rejects(
		() => sync(configPath, cacheDir),
		/OpenCode reference alias collision.*docs/i,
	);
	assert.equal(await readFile(openCodePath, "utf8"), original);
});

test("sync does not trust lock aliases as OpenCode ownership", async () => {
	const root = await createRoot("forged-lock");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.json");
	await writeFile(
		openCodePath,
		`{ "references": { "docs": { "path": "/user/docs" } } }\n`,
		"utf8",
	);
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: openCodePath },
	);
	await writeFile(
		path.join(root, "docs-lock.json"),
		`${JSON.stringify({
			version: 1,
			toolVersion: "0.0.0",
			sources: {
				docs: {
					repo: "https://github.com/example/docs.git",
					ref: "HEAD",
					resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					bytes: 0,
					fileCount: 0,
					manifestSha256: "manifest",
				},
			},
			opencode: { configPath: openCodePath, aliases: ["docs"] },
		})}\n`,
		"utf8",
	);

	await assert.rejects(
		() => sync(configPath, cacheDir),
		/OpenCode reference alias collision.*docs/i,
	);
});

test("sync removes stale managed aliases without removing user references", async () => {
	const root = await createRoot("stale");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.jsonc");
	await writeFile(
		openCodePath,
		`{
	"references": {
		"user": { "path": "/user" },
	},
}
`,
		"utf8",
	);
	const opencode = { configPath: openCodePath };
	const configPath = await writeDocsConfig(
		root,
		[
			{ id: "keep", repo: "https://github.com/example/keep.git" },
			{ id: "remove", repo: "https://github.com/example/remove.git" },
		],
		opencode,
	);

	await sync(configPath, cacheDir);
	await writeDocsConfig(
		root,
		[{ id: "keep", repo: "https://github.com/example/keep.git" }],
		opencode,
	);
	await sync(configPath, cacheDir);

	const config = parse(await readFile(openCodePath, "utf8"));
	assert.ok(config.references.user);
	assert.ok(config.references.keep);
	assert.equal(config.references.remove, undefined);
});

test("sync --frozen detects reference drift without writing OpenCode config", async () => {
	const root = await createRoot("frozen");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.json");
	await writeFile(openCodePath, "{}\n", "utf8");
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: openCodePath },
	);
	await sync(configPath, cacheDir);
	const drifted = `{
  "references": {
    "docs": {
      "path": "/wrong/path",
      "description": "wrong"
    }
  }
}
`;
	await writeFile(openCodePath, drifted, "utf8");

	await assert.rejects(
		() => sync(configPath, cacheDir, { frozen: true }),
		/Frozen sync failed: OpenCode references are out of date.*docs/i,
	);
	assert.equal(await readFile(openCodePath, "utf8"), drifted);
});

test("sync removes managed references from a previously selected OpenCode config", async () => {
	const root = await createRoot("move");
	const cacheDir = path.join(root, ".docs");
	const firstOpenCodePath = path.join(root, "first-opencode.json");
	const secondOpenCodePath = path.join(root, "second-opencode.json");
	await writeFile(firstOpenCodePath, "{}\n", "utf8");
	await writeFile(secondOpenCodePath, "{}\n", "utf8");
	const sources = [{ id: "docs", repo: "https://github.com/example/docs.git" }];
	const configPath = await writeDocsConfig(root, sources, {
		configPath: firstOpenCodePath,
	});
	await sync(configPath, cacheDir);
	await writeDocsConfig(root, sources, { configPath: secondOpenCodePath });
	await sync(configPath, cacheDir);

	const first = JSON.parse(await readFile(firstOpenCodePath, "utf8"));
	const second = JSON.parse(await readFile(secondOpenCodePath, "utf8"));
	assert.equal(first.references.docs, undefined);
	assert.deepEqual(second.references.docs, {
		path: path.join(cacheDir, "docs"),
		description: "Use for documentation from example/docs.",
	});
});

test("sync leaves existing references unchanged after integration is disabled", async () => {
	const root = await createRoot("disabled");
	const cacheDir = path.join(root, ".docs");
	const openCodePath = path.join(root, "opencode.json");
	await writeFile(openCodePath, "{}\n", "utf8");
	const sources = [{ id: "docs", repo: "https://github.com/example/docs.git" }];
	const configPath = await writeDocsConfig(root, sources, {
		configPath: openCodePath,
	});
	await sync(configPath, cacheDir);
	const before = await readFile(openCodePath, "utf8");
	await writeDocsConfig(root, sources, false);
	await sync(configPath, cacheDir);

	assert.equal(await readFile(openCodePath, "utf8"), before);
	const lock = JSON.parse(
		await readFile(path.join(root, "docs-lock.json"), "utf8"),
	);
	assert.deepEqual(lock.opencode, {
		configPath: openCodePath,
		aliases: ["docs"],
	});
	await writeDocsConfig(root, sources, { configPath: openCodePath });
	await sync(configPath, cacheDir);
});

test("sync fails when the remembered OpenCode config no longer exists", async () => {
	const root = await createRoot("missing");
	const configPath = await writeDocsConfig(
		root,
		[{ id: "docs", repo: "https://github.com/example/docs.git" }],
		{ configPath: path.join(root, "missing-opencode.json") },
	);

	await assert.rejects(
		() => sync(configPath, path.join(root, ".docs")),
		/Configured OpenCode config not found/i,
	);
});
