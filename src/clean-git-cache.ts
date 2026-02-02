import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { exists, resolveGitCacheDir } from "./git/cache-dir";

const getDirSize = async (dirPath: string): Promise<number> => {
	try {
		const entries = await readdir(dirPath, { withFileTypes: true });
		let totalSize = 0;

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);
			if (entry.isDirectory()) {
				totalSize += await getDirSize(fullPath);
			} else {
				const stats = await stat(fullPath);
				totalSize += stats.size;
			}
		}

		return totalSize;
	} catch {
		return 0;
	}
};

const countCachedRepos = async (cacheDir: string): Promise<number> => {
	try {
		const entries = await readdir(cacheDir);
		return entries.length;
	} catch {
		return 0;
	}
};

export type CleanGitCacheResult = {
	removed: boolean;
	cacheDir: string;
	repoCount?: number;
	bytesFreed?: number;
};

export type CleanGitCacheOptions = {
	json?: boolean;
};

export const cleanGitCache = async (): Promise<CleanGitCacheResult> => {
	const cacheDir = resolveGitCacheDir();
	const cacheExists = await exists(cacheDir);

	if (!cacheExists) {
		return {
			removed: false,
			cacheDir,
		};
	}

	// Get stats before removal
	const repoCount = await countCachedRepos(cacheDir);
	const bytesFreed = await getDirSize(cacheDir);

	// Remove the cache directory
	await rm(cacheDir, { recursive: true, force: true });

	return {
		removed: true,
		cacheDir,
		repoCount,
		bytesFreed,
	};
};
