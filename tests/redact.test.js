import assert from "node:assert/strict";
import { test } from "node:test";

import { redactRepoUrl } from "../dist/cli.mjs";

test("redacts credentials in https URLs", () => {
	const input = "https://user:token@github.com/org/repo.git";
	const output = redactRepoUrl(input);
	assert.equal(output, "https://***@github.com/org/repo.git");
});

test("leaves ssh URLs unchanged", () => {
	const input = "git@github.com:org/repo.git";
	const output = redactRepoUrl(input);
	assert.equal(output, input);
});
