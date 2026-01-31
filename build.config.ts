import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: [{ input: "src/cli/index", name: "cli" }],
	declaration: true,
	clean: true,
	sourcemap: true,
	rollup: {
		emitCJS: false,
		inlineDependencies: ["picocolors"],
	},
});
