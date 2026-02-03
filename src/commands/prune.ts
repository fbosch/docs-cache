import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CACHE_DIR, loadConfig } from "#config";
import { resolveCacheDir } from "#core/paths";

type PruneOptions = {
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

export const pruneCache = async (options: PruneOptions) => {
	const { config, resolvedPath, sources } = await loadConfig(
		options.configPath,
	);
	const cacheDir = resolveCacheDir(
		resolvedPath,
		config.cacheDir ?? DEFAULT_CACHE_DIR,
		options.cacheDirOverride,
	);
	const cacheDirExists = await exists(cacheDir);
	if (!cacheDirExists) {
		return {
			cacheDir,
			removed: [],
			kept: sources.map((source) => source.id),
		};
	}
	const keepIds = new Set(sources.map((source) => source.id));
	const entries = await readdir(cacheDir, { withFileTypes: true });
	const removed: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const name = entry.name;
		if (keepIds.has(name)) {
			continue;
		}
		if (name.startsWith(".tmp-")) {
			continue;
		}
		await rm(path.join(cacheDir, name), { recursive: true, force: true });
		removed.push(name);
	}
	return {
		cacheDir,
		removed,
		kept: sources.map((source) => source.id),
	};
};
