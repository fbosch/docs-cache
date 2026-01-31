import { access, rm } from "node:fs/promises";
import { DEFAULT_CACHE_DIR, loadConfig } from "./config";
import { resolveCacheDir } from "./paths";

type CleanOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const cleanCache = async (options: CleanOptions) => {
	const { config, resolvedPath } = await loadConfig(options.configPath);
	const cacheDir = resolveCacheDir(
		resolvedPath,
		config.cacheDir ?? DEFAULT_CACHE_DIR,
		options.cacheDirOverride,
	);
	const cacheDirExists = await exists(cacheDir);
	if (cacheDirExists) {
		await rm(cacheDir, { recursive: true, force: true });
	}
	return {
		cacheDir,
		removed: cacheDirExists,
	};
};
