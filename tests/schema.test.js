import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("docs config schema has required top-level keys", async () => {
	const raw = await readFile(
		new URL("../docs.config.schema.json", import.meta.url),
	);
	const schema = JSON.parse(raw.toString());

	assert.equal(schema.type, "object");
	assert.ok(schema.properties?.$schema);
	assert.ok(schema.properties?.cacheDir);
	assert.ok(schema.properties?.defaults);
	assert.ok(schema.properties?.sources);
});
