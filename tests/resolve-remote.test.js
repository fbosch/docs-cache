import assert from "node:assert/strict";
import { test } from "node:test";

import { enforceHostAllowlist, parseLsRemote } from "../dist/cli.mjs";

test("parseLsRemote returns first hash", () => {
	const hash = parseLsRemote("abc123\trefs/heads/main\n");
	assert.equal(hash, "abc123");
});

test("parseLsRemote returns null for empty output", () => {
	assert.equal(parseLsRemote("\n"), null);
});

test("enforceHostAllowlist rejects unsupported scheme", () => {
	assert.throws(
		() => enforceHostAllowlist("http://example.com/repo.git", ["example.com"]),
		/Unsupported repo URL/i,
	);
});

test("enforceHostAllowlist rejects disallowed host", () => {
	assert.throws(
		() => enforceHostAllowlist("https://example.com/repo.git", ["github.com"]),
		/allowHosts/i,
	);
});
