import path from "node:path";

export const DEFAULT_TOC_FILENAME = "TOC.md";

export const toPosixPath = (value: string) => value.replace(/\\/g, "/");

export const resolveTargetDir = (configPath: string, targetDir: string) => {
	const configDir = path.dirname(path.resolve(configPath));
	const resolved = path.resolve(configDir, targetDir);
	const relative = path.relative(configDir, resolved);
	const isOutside =
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative);
	if (isOutside) {
		throw new Error(
			`targetDir '${targetDir}' escapes project directory. Must be within ${configDir}.`,
		);
	}
	const segments = toPosixPath(relative).split("/").filter(Boolean);
	if (segments.includes(".git")) {
		throw new Error("targetDir cannot be within .git directory.");
	}
	return resolved;
};

export const resolveCacheDir = (
	configPath: string,
	cacheDir: string,
	overrideCacheDir?: string,
) => {
	if (overrideCacheDir) {
		return path.resolve(overrideCacheDir);
	}
	const configDir = path.dirname(configPath);
	return path.resolve(configDir, cacheDir);
};

export const getCacheLayout = (cacheDir: string, sourceId: string) => {
	const _reposDir = path.join(cacheDir, "repos");
	const sourceDir = path.join(cacheDir, sourceId);
	return {
		cacheDir,
		sourceDir,
	};
};
