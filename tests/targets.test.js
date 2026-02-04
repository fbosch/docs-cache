import assert from "node:assert/strict";
import { cp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyTargetDir } from "../dist/api.mjs";

test("applyTargetDir warns and falls back to copy when symlink fails", async () => {
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-target-fallback-${Date.now().toString(36)}`,
	);
	const sourceDir = path.join(tmpRoot, "source");
	const targetDir = path.join(tmpRoot, "target");

	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "README.md"), "hello", "utf8");

	let stderr = "";
	await applyTargetDir({
		sourceDir,
		targetDir,
		mode: "symlink",
		explicitTargetMode: true,
		deps: {
			cp,
			mkdir,
			rm,
			symlink: async () => {
				const error = new Error("symlink blocked");
				error.code = "EPERM";
				throw error;
			},
			stderr: {
				write: (chunk) => {
					stderr += String(chunk);
					return true;
				},
			},
		},
	});

	const data = await readFile(path.join(targetDir, "README.md"), "utf8");
	assert.equal(data, "hello");
	assert.match(stderr, /Warning: Failed to create symlink/i);
});

test("applyTargetDir uses relative symlink targets on non-Windows", async (t) => {
	if (process.platform === "win32") {
		t.skip("Relative symlink targets are not used on Windows.");
	}
	const tmpRoot = path.join(
		tmpdir(),
		`docs-cache-target-relative-${Date.now().toString(36)}`,
	);
	const sourceDir = path.join(tmpRoot, "source");
	const targetDir = path.join(tmpRoot, "target");
	const parentDir = path.dirname(targetDir);

	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "README.md"), "hello", "utf8");

	await applyTargetDir({
		sourceDir,
		targetDir,
		mode: "symlink",
	});

	const linkTarget = await readlink(targetDir);
	assert.equal(linkTarget, path.relative(parentDir, sourceDir));
});
