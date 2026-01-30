import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("docs config schema has required top-level keys", async () => {
	const raw = await readFile(
		new URL("../docs.config.schema.json", import.meta.url),
	);
	const schema = JSON.parse(raw.toString());

	assert.equal(schema.type, "object");
	assert.deepEqual(schema.required, [
		"version",
		"cacheDir",
		"defaults",
		"sources",
	]);
	assert.equal(schema.properties?.version?.const, 1);
});
