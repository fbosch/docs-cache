import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRepoInput } from "../dist/api.mjs";

test("resolveRepoInput handles github shorthand", () => {
	const result = resolveRepoInput("fbosch/docs-cache");
	assert.equal(result.repoUrl, "https://github.com/fbosch/docs-cache.git");
	assert.equal(result.inferredId, "docs-cache");
});

test("resolveRepoInput handles github shorthand with ref", () => {
	const result = resolveRepoInput("fbosch/docs-cache#main");
	assert.equal(result.repoUrl, "https://github.com/fbosch/docs-cache.git");
	assert.equal(result.ref, "main");
});

test("resolveRepoInput handles provider shorthand", () => {
	const result = resolveRepoInput("gitlab:acme/docs");
	assert.equal(result.repoUrl, "https://gitlab.com/acme/docs.git");
	assert.equal(result.inferredId, "docs");
});

test("resolveRepoInput handles ssh with ref", () => {
	const result = resolveRepoInput("git@github.com:fbosch/docs-cache.git#v1");
	assert.equal(result.repoUrl, "git@github.com:fbosch/docs-cache.git");
	assert.equal(result.ref, "v1");
	assert.equal(result.inferredId, "docs-cache");
});

test("resolveRepoInput handles https url", () => {
	const result = resolveRepoInput("https://github.com/fbosch/docs-cache.git");
	assert.equal(result.repoUrl, "https://github.com/fbosch/docs-cache.git");
	assert.equal(result.inferredId, "docs-cache");
});

test("resolveRepoInput keeps unknown strings", () => {
	const result = resolveRepoInput("not-a-url");
	assert.equal(result.repoUrl, "not-a-url");
	assert.equal(result.inferredId, undefined);
});
