import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Get platform-specific cache directory
 * - macOS: ~/Library/Caches
 * - Windows: %LOCALAPPDATA% or ~/AppData/Local
 * - Linux: $XDG_CACHE_HOME or ~/.cache
 */
export const getCacheBaseDir = (): string => {
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

/**
 * Resolve the git cache directory
 * Can be overridden via DOCS_CACHE_GIT_DIR environment variable
 */
export const resolveGitCacheDir = (): string =>
	process.env.DOCS_CACHE_GIT_DIR ||
	path.join(getCacheBaseDir(), "docs-cache-git");

/**
 * Check if a file or directory exists
 */
export const exists = async (filePath: string): Promise<boolean> => {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
};
