import { access, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ui } from "./cli/ui";

// Get platform-specific cache directory
const getCacheBaseDir = (): string => {
	const home = homedir();
	switch (process.platform) {
		case "darwin":
			return path.join(home, "Library", "Caches");
		case "win32":
			return process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
		default:
			// Linux and other Unix-like systems (XDG Base Directory)
			return process.env.XDG_CACHE_HOME || path.join(home, ".cache");
	}
};

// Persistent git cache directory in user's cache location
const GIT_CACHE_DIR = path.join(getCacheBaseDir(), "docs-cache-git");

const exists = async (filePath: string): Promise<boolean> => {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
};

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

const countCachedRepos = async (): Promise<number> => {
	try {
		const entries = await readdir(GIT_CACHE_DIR);
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

export const cleanGitCache = async (
	options: CleanGitCacheOptions = {},
): Promise<CleanGitCacheResult> => {
	const cacheExists = await exists(GIT_CACHE_DIR);

	if (!cacheExists) {
		return {
			removed: false,
			cacheDir: GIT_CACHE_DIR,
		};
	}

	// Get stats before removal
	const repoCount = await countCachedRepos();
	const bytesFreed = await getDirSize(GIT_CACHE_DIR);

	// Remove the cache directory
	await rm(GIT_CACHE_DIR, { recursive: true, force: true });

	return {
		removed: true,
		cacheDir: GIT_CACHE_DIR,
		repoCount,
		bytesFreed,
	};
};
