import { access } from "node:fs/promises";
import path from "node:path";
import { symbols } from "./cli/symbols";
import { DEFAULT_CACHE_DIR, loadConfig } from "./config";
import { readLock, resolveLockPath } from "./lock";
import { getCacheLayout, resolveCacheDir } from "./paths";

type StatusOptions = {
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

export const getStatus = async (options: StatusOptions) => {
	const { config, resolvedPath, sources } = await loadConfig(
		options.configPath,
	);
	const resolvedCacheDir = resolveCacheDir(
		resolvedPath,
		config.cacheDir ?? DEFAULT_CACHE_DIR,
		options.cacheDirOverride,
	);
	const cacheDirExists = await exists(resolvedCacheDir);
	const lockPath = resolveLockPath(resolvedPath);
	const lockExists = await exists(lockPath);

	let lockValid = false;
	let lockData: Awaited<ReturnType<typeof readLock>> | null = null;
	if (lockExists) {
		try {
			lockData = await readLock(lockPath);
			lockValid = true;
		} catch {
			lockValid = false;
		}
	}

	const sourceStatus = await Promise.all(
		sources.map(async (source) => {
			const layout = getCacheLayout(resolvedCacheDir, source.id);
			const docsExists = await exists(layout.sourceDir);
			const lockEntry = lockData?.sources?.[source.id] ?? null;
			return {
				id: source.id,
				docsPath: layout.sourceDir,
				docsExists,
				lockEntry,
			};
		}),
	);

	return {
		configPath: resolvedPath,
		cacheDir: resolvedCacheDir,
		cacheDirExists,
		lockPath,
		lockExists,
		lockValid,
		sources: sourceStatus,
	};
};

export const printStatus = (status: Awaited<ReturnType<typeof getStatus>>) => {
	const lockState = status.lockExists
		? status.lockValid
			? "present"
			: "invalid"
		: "missing";
	const cacheState = status.cacheDirExists ? "present" : "missing";

	process.stdout.write(
		`${symbols.info} Cache dir: ${status.cacheDir} (${cacheState})\n`,
	);
	for (const source of status.sources) {
		const docsState = source.docsExists ? "present" : "missing";
		const lockStateLabel = source.lockEntry ? "present" : "missing";
		process.stdout.write(
			`${symbols.info} ${source.id}: docs=${docsState} lock=${lockStateLabel}\n`,
		);
	}
};
