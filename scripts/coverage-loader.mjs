const projectRoot = new URL("../", import.meta.url);
const sourceEntries = new Map([
	[
		new URL("dist/api.mjs", projectRoot).href,
		new URL("src/api.ts", projectRoot).href,
	],
	[
		new URL("dist/lock.mjs", projectRoot).href,
		new URL("src/cache/lock.ts", projectRoot).href,
	],
]);

export async function resolve(specifier, context, nextResolve) {
	if (context.parentURL === undefined) {
		return nextResolve(specifier, context);
	}

	const sourceEntry = sourceEntries.get(
		new URL(specifier, context.parentURL).href,
	);
	return nextResolve(sourceEntry ?? specifier, context);
}
