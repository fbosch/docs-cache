import path from "node:path";

export const DEFAULT_LOCK_FILENAME = "docs.lock";
export const DEFAULT_INDEX_FILENAME = "index.json";

export const toPosixPath = (value: string) => value.replace(/\\/g, "/");

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
	const reposDir = path.join(cacheDir, "repos");
	const sourceDir = path.join(cacheDir, sourceId);
	const indexPath = path.join(cacheDir, DEFAULT_INDEX_FILENAME);
	return {
		cacheDir,
		sourceDir,
		indexPath,
	};
};
