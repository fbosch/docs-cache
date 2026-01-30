import { access } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config";
import { readLock } from "./lock";
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
		config.cacheDir,
		options.cacheDirOverride,
	);
	const cacheDirExists = await exists(resolvedCacheDir);
	const lockPath = path.join(resolvedCacheDir, "docs.lock");
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
			const materializedExists = await exists(layout.materializedDir);
			const lockEntry = lockData?.sources?.[source.id] ?? null;
			return {
				id: source.id,
				materializedPath: layout.materializedDir,
				materializedExists,
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

	process.stdout.write(`Cache dir: ${status.cacheDir} (${cacheState})\n`);
	process.stdout.write(`Lock: ${status.lockPath} (${lockState})\n`);
	for (const source of status.sources) {
		const materializedState = source.materializedExists ? "present" : "missing";
		const lockStateLabel = source.lockEntry ? "present" : "missing";
		process.stdout.write(
			`${source.id}: materialized=${materializedState} lock=${lockStateLabel}\n`,
		);
	}
};
