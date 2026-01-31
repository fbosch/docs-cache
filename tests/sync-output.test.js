import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { printSyncPlan } from "../dist/api.mjs";

test("printSyncPlan outputs summary and short hashes", () => {
	const cwd = process.cwd();
	const plan = {
		configPath: path.join(cwd, "docs.config.json"),
		cacheDir: path.join(cwd, ".docs"),
		lockPath: path.join(cwd, "docs.lock"),
		lockExists: true,
		results: [
			{
				id: "alpha",
				repo: "https://example.com/alpha.git",
				ref: "main",
				resolvedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				lockCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				status: "up-to-date",
			},
			{
				id: "beta",
				repo: "https://example.com/beta.git",
				ref: "main",
				resolvedCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				lockCommit: "cccccccccccccccccccccccccccccccccccccccc",
				status: "changed",
			},
			{
				id: "gamma",
				repo: "https://example.com/gamma.git",
				ref: "main",
				resolvedCommit: "dddddddddddddddddddddddddddddddddddddddd",
				lockCommit: "dddddddddddddddddddddddddddddddddddddddd",
				lockRulesSha256: "111111",
				rulesSha256: "222222",
				status: "changed",
			},
		],
	};

	let output = "";
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk) => {
		output += chunk;
		return true;
	};

	try {
		printSyncPlan(plan);
	} finally {
		process.stdout.write = originalWrite;
	}

	assert.ok(output.includes("3 sources"));
	assert.ok(output.includes("alpha"));
	assert.ok(output.includes("beta"));
	assert.ok(output.includes("gamma"));
	assert.ok(output.includes("aaaaaaa"));
	assert.ok(output.includes("bbbbbbb"));
	assert.ok(output.includes("rules changed"));
});
