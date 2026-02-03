import { access } from "node:fs/promises";
import pc from "picocolors";
import { DEFAULT_LOCK_FILENAME, readLock, resolveLockPath } from "#cache/lock";
import { symbols, ui } from "#cli/ui";
import { DEFAULT_CACHE_DIR, loadConfig } from "#config";
import { getCacheLayout, resolveCacheDir } from "#core/paths";

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
	const relCache = ui.path(status.cacheDir);
	const cacheState = status.cacheDirExists
		? pc.green("present")
		: pc.red("missing");
	const lockState = status.lockExists
		? status.lockValid
			? pc.green("valid")
			: pc.red("invalid")
		: pc.yellow("missing");

	ui.header("Cache", `${relCache} (${cacheState})`);
	ui.header("Lock", `${DEFAULT_LOCK_FILENAME} (${lockState})`);

	if (status.sources.length === 0) {
		ui.line();
		ui.line(`${symbols.warn} No sources configured.`);
		return;
	}

	ui.line();
	for (const source of status.sources) {
		const icon = source.docsExists ? symbols.success : symbols.error;
		const lockLabel = source.lockEntry ? pc.green("locked") : pc.yellow("new");
		const shortHash = ui.hash(source.lockEntry?.resolvedCommit);

		ui.item(icon, source.id.padEnd(20), `${lockLabel.padEnd(10)} ${shortHash}`);
	}
};
