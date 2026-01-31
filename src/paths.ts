import path from "node:path";

export const DEFAULT_LOCK_FILENAME = "docs.lock";
export const DEFAULT_INDEX_FILENAME = "index.json";

export const toPosixPath = (value: string) => value.replace(/\\/g, "/");

export const resolveCacheDir = (
	configPath: string,
	cacheDir: string,
	overrideCacheDir?: string,
) => {
	const resolvedDir = overrideCacheDir
		? path.resolve(overrideCacheDir)
		: path.resolve(path.dirname(configPath), cacheDir);

	// Security: Validate cache directory path doesn't contain path traversal
	const normalized = path.normalize(resolvedDir);
	if (normalized !== resolvedDir || normalized.includes("..")) {
		throw new Error(
			`Security: Invalid cache directory path (path traversal detected): ${cacheDir}`,
		);
	}

	return resolvedDir;
};

export const getCacheLayout = (cacheDir: string, sourceId: string) => {
	// Security: Validate sourceId doesn't contain path traversal characters
	const normalized = path.normalize(sourceId);
	if (
		normalized !== sourceId ||
		normalized.includes("..") ||
		path.isAbsolute(sourceId) ||
		sourceId.includes(path.sep)
	) {
		throw new Error(
			`Security: Invalid source ID (must be a simple identifier): ${sourceId}`,
		);
	}

	const _reposDir = path.join(cacheDir, "repos");
	const sourceDir = path.join(cacheDir, sourceId);
	const indexPath = path.join(cacheDir, DEFAULT_INDEX_FILENAME);
	return {
		cacheDir,
		sourceDir,
		indexPath,
	};
};
