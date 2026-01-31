import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const fixturePath = new URL("./fixtures/docs.lock", import.meta.url);
const distPath = new URL("../dist/lock.mjs", import.meta.url);

const loadLockModule = async () => {
	try {
		await access(distPath);
	} catch {
		return null;
	}
	return import(distPath.href);
};

test("lock fixture is valid", async (t) => {
	const module = await loadLockModule();
	if (!module) {
		t.skip("lock module not built yet");
		return;
	}
	const raw = await readFile(fixturePath, "utf8");
	const parsed = JSON.parse(raw.toString());
	const lock = module.validateLock(parsed);
	assert.equal(lock.version, 1);
	assert.ok(lock.sources.vitest);
});

test("writeLock produces readable JSON", async (t) => {
	const module = await loadLockModule();
	if (!module) {
		t.skip("lock module not built yet");
		return;
	}
	const tmpPath = path.join(tmpdir(), `docs-lock-${Date.now()}.json`);
	const lock = {
		version: 1,
		generatedAt: "2026-01-30T12:00:00+01:00",
		toolVersion: "0.1.0",
		sources: {},
	};
	await module.writeLock(tmpPath, lock);
	const parsed = await module.readLock(tmpPath);
	assert.equal(parsed.generatedAt, lock.generatedAt);
});
