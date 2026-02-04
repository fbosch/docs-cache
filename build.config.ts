import path from "node:path";
import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: [
		{ input: "src/cli/index", name: "cli" },
		{ input: "src/api", name: "api" },
		{ input: "src/cache/lock", name: "lock" },
		{
			builder: "mkdist",
			input: "./src",
			outDir: "./dist/esm",
		},
	],
	declaration: true,
	clean: true,
	sourcemap: true,
	rollup: {
		emitCJS: false,
		alias: {
			entries: [
				{
					find: /^#cache\/(.*)$/,
					replacement: path.resolve("src/cache/$1"),
				},
				{
					find: /^#cli\/(.*)$/,
					replacement: path.resolve("src/cli/$1"),
				},
				{
					find: /^#commands\/(.*)$/,
					replacement: path.resolve("src/commands/$1"),
				},
				{
					find: /^#config\/(.*)$/,
					replacement: path.resolve("src/config/$1"),
				},
				{
					find: "#config",
					replacement: path.resolve("src/config/index"),
				},
				{
					find: /^#core\/(.*)$/,
					replacement: path.resolve("src/$1"),
				},
				{
					find: /^#git\/(.*)$/,
					replacement: path.resolve("src/git/$1"),
				},
				{
					find: /^#types\/(.*)$/,
					replacement: path.resolve("src/types/$1"),
				},
			],
		},
		inlineDependencies: ["picocolors"],
		esbuild: {
			minify: true,
		},
	},
});
