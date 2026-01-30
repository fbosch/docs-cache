import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("target-dir is rejected outside add", async () => {
	let failed = false;
	try {
		await execFileAsync("node", [
			"bin/docs-cache.mjs",
			"status",
			"--target-dir",
			"docs",
		]);
	} catch (error) {
		failed = true;
		const err = error;
		assert.equal(err?.code, 9);
	}

	assert.equal(failed, true);
});
