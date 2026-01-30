import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: ["src/cli/index"],
	declaration: true,
	clean: true,
	rollup: {
		emitCJS: true,
	},
});
