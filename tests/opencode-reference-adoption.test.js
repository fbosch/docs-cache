import assert from "node:assert/strict";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { planOpenCodeReferences } from "../dist/api.mjs";

const referencePath = (openCodePath, cacheDir, id) =>
	path
		.relative(path.dirname(openCodePath), path.join(cacheDir, id))
		.split(path.sep)
		.join("/");

test("matching OpenCode references are adopted without local ownership", async () => {
	const root = path.join(
		tmpdir(),
		`docs-cache-opencode-adoption-${Date.now()}-${Math.random()}`,
	);
	await mkdir(root, { recursive: true });

	try {
		const docsConfigPath = path.join(root, "docs.config.json");
		const openCodePath = path.join(root, "opencode.json");
		const cacheDir = path.join(root, ".docs");
		const sources = [
			{
				id: "Låneportalen-Wiki",
				repo: "https://github.com/example/loan-portal-wiki.git",
			},
			{
				id: "MitKommuneKredit-Wiki",
				repo: "https://github.com/example/customer-portal-wiki.git",
			},
		];
		const references = {
			"Låneportalen-Wiki": {
				description:
					"Use for documentation from example/loan-portal-wiki. Start with TOC.md.",
				path: referencePath(openCodePath, cacheDir, "Låneportalen-Wiki"),
			},
			"MitKommuneKredit-Wiki": {
				description:
					"Use for documentation from example/customer-portal-wiki. Start with TOC.md.",
				path: referencePath(
					openCodePath,
					cacheDir,
					"MitKommuneKredit-Wiki",
				),
			},
		};
		const original = `${JSON.stringify({ references }, null, "\t")}\n`;
		await writeFile(docsConfigPath, "{}\n", "utf8");
		await writeFile(openCodePath, original, "utf8");

		const plan = await planOpenCodeReferences({
			opencode: { configPath: "opencode.json" },
			ownership: undefined,
			sources,
			cacheDir,
			configPath: docsConfigPath,
		});

		const aliases = sources.map((source) => source.id);
		assert.deepEqual(plan.drift, []);
		assert.deepEqual(plan.nextState, {
			configPath: "opencode.json",
			aliases,
		});
		assert.deepEqual(plan.ownershipState, {
			configPath: await realpath(openCodePath),
			aliases,
		});

		await plan.apply();
		assert.equal(await readFile(openCodePath, "utf8"), original);

		const nextCacheDir = path.join(root, ".docs-next");
		const updatePlan = await planOpenCodeReferences({
			opencode: { configPath: "opencode.json" },
			ownership: plan.ownershipState,
			sources,
			cacheDir: nextCacheDir,
			configPath: docsConfigPath,
		});
		assert.deepEqual(updatePlan.drift, aliases);

		await updatePlan.apply();
		const updated = JSON.parse(await readFile(openCodePath, "utf8"));
		for (const source of sources) {
			assert.equal(
				updated.references[source.id].path,
				referencePath(openCodePath, nextCacheDir, source.id),
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
