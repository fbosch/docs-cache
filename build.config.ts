import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: [
		{ input: "src/cli/index", name: "cli" },
		{ input: "src/config-schema", name: "config-schema" },
	],
	declaration: true,
	clean: true,
	sourcemap: true,
	externals: ["cac"],
	rollup: {
		emitCJS: false,
	},
});
