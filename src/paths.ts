import path from "node:path";

export const DEFAULT_LOCK_FILENAME = "docs.lock";
export const DEFAULT_INDEX_FILENAME = "index.json";

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
	const sourcesDir = path.join(cacheDir, "sources");
	const sourceDir = path.join(sourcesDir, sourceId);
	const manifestPath = path.join(sourceDir, "manifest.json");
	const lockPath = path.join(cacheDir, DEFAULT_LOCK_FILENAME);
	const indexPath = path.join(cacheDir, DEFAULT_INDEX_FILENAME);
	return {
		cacheDir,
		reposDir,
		sourcesDir,
		sourceDir,
		manifestPath,
		lockPath,
		indexPath,
	};
};
