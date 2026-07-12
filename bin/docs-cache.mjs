#!/usr/bin/env node

const loadCli = async () => {
	if (process.env.DOCS_CACHE_COVERAGE === "1") {
		const { register } = await import("tsx/esm/api");
		register();
		return import("../src/cli/index.ts");
	}

	return import("../dist/cli.mjs");
};

loadCli().then((mod) => mod.main());
