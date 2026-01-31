import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: [
		{ input: "src/cli/index", name: "cli" },
		{ input: "src/api", name: "api" },
		{ input: "src/config-schema", name: "config-schema" },
	],
	declaration: true,
	clean: true,
	sourcemap: true,
	rollup: {
		emitCJS: false,
		inlineDependencies: ["picocolors"],
	},
});
