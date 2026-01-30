import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { symbols } from "./cli/symbols";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheDefaults,
	loadConfig,
} from "./config";
import { resolveRemoteCommit } from "./git/resolve-remote";
import { readLock, writeLock } from "./lock";
import { resolveCacheDir } from "./paths";

type SyncOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
	lockOnly: boolean;
	timeoutMs?: number;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const getSyncPlan = async (options: SyncOptions) => {
	const { config, resolvedPath, sources } = await loadConfig(
		options.configPath,
	);
	const defaults = (config.defaults ??
		DEFAULT_CONFIG.defaults) as DocsCacheDefaults;
	const resolvedCacheDir = resolveCacheDir(
		resolvedPath,
		config.cacheDir ?? DEFAULT_CACHE_DIR,
		options.cacheDirOverride,
	);
	const lockPath = path.join(resolvedCacheDir, "docs.lock");
	const lockExists = await exists(lockPath);

	let lockData: Awaited<ReturnType<typeof readLock>> | null = null;
	if (lockExists) {
		lockData = await readLock(lockPath);
	}

	const results = await Promise.all(
		sources.map(async (source) => {
			const resolved = await resolveRemoteCommit({
				repo: source.repo,
				ref: source.ref,
				allowHosts: defaults.allowHosts,
				timeoutMs: options.timeoutMs,
			});
			const lockEntry = lockData?.sources?.[source.id];
			const upToDate = lockEntry?.resolvedCommit === resolved.resolvedCommit;
			const status = lockEntry
				? upToDate
					? "up-to-date"
					: "changed"
				: "missing";
			return {
				id: source.id,
				repo: resolved.repo,
				ref: resolved.ref,
				resolvedCommit: resolved.resolvedCommit,
				lockCommit: lockEntry?.resolvedCommit ?? null,
				status,
			};
		}),
	);

	return {
		configPath: resolvedPath,
		cacheDir: resolvedCacheDir,
		lockPath,
		lockExists,
		results,
	};
};

const loadToolVersion = async () => {
	const raw = await readFile(
		new URL("../package.json", import.meta.url),
		"utf8",
	);
	const pkg = JSON.parse(raw.toString());
	return typeof pkg.version === "string" ? pkg.version : "0.0.0";
};

const buildLock = async (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
	previous: Awaited<ReturnType<typeof readLock>> | null,
) => {
	const toolVersion = await loadToolVersion();
	const now = new Date().toISOString();
	const sources = { ...(previous?.sources ?? {}) };
	for (const result of plan.results) {
		const prior = sources[result.id];
		sources[result.id] = {
			repo: result.repo,
			ref: result.ref,
			resolvedCommit: result.resolvedCommit,
			bytes: prior?.bytes ?? 0,
			fileCount: prior?.fileCount ?? 0,
			manifestSha256: prior?.manifestSha256 ?? "",
			updatedAt: now,
		};
	}
	return {
		version: 1 as const,
		generatedAt: now,
		toolVersion,
		sources,
	};
};

export const runSync = async (options: SyncOptions) => {
	const plan = await getSyncPlan(options);
	if (!options.lockOnly) {
		return plan;
	}
	await mkdir(plan.cacheDir, { recursive: true });
	let previous: Awaited<ReturnType<typeof readLock>> | null = null;
	if (plan.lockExists) {
		previous = await readLock(plan.lockPath);
	}
	const lock = await buildLock(plan, previous);
	await writeLock(plan.lockPath, lock);
	return plan;
};

export const printSyncPlan = (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
) => {
	process.stdout.write(`Config: ${plan.configPath}\n`);
	process.stdout.write(`${symbols.info} Cache dir: ${plan.cacheDir}\n`);
	process.stdout.write(
		`${symbols.info} Lock: ${plan.lockPath} (${plan.lockExists ? "present" : "missing"})\n`,
	);
	for (const result of plan.results) {
		process.stdout.write(
			`${symbols.info} ${result.id}: ${result.status} (${result.lockCommit ?? "-"} -> ${result.resolvedCommit})\n`,
		);
	}
};
