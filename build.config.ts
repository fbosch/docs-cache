import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: [
		{ input: "src/cli/index", name: "cli" },
		{ input: "src/api", name: "api" },
		{ input: "src/lock", name: "lock" },
	],
	declaration: true,
	clean: true,
	sourcemap: true,
	rollup: {
		emitCJS: false,
		inlineDependencies: ["picocolors"],
		esbuild: {
			minify: true,
		},
	},
});
