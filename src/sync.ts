import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { symbols } from "./cli/symbols";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheDefaults,
	loadConfig,
} from "./config";
import { fetchSource } from "./git/fetch-source";
import { resolveRemoteCommit } from "./git/resolve-remote";
import { readLock, resolveLockPath, writeLock } from "./lock";
import { materializeSource } from "./materialize";
import { resolveCacheDir } from "./paths";
import { applyTargetDir } from "./targets";

type SyncOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
	lockOnly: boolean;
	sourceFilter?: string[];
	timeoutMs?: number;
};

type SyncDeps = {
	resolveRemoteCommit?: typeof resolveRemoteCommit;
	fetchSource?: typeof fetchSource;
	materializeSource?: typeof materializeSource;
};

type SyncResult = {
	id: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	lockCommit: string | null;
	status: "up-to-date" | "changed" | "missing";
	bytes?: number;
	fileCount?: number;
	manifestSha256?: string;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const getSyncPlan = async (
	options: SyncOptions,
	deps: SyncDeps = {},
) => {
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
	const lockPath = resolveLockPath(resolvedPath);
	const lockExists = await exists(lockPath);

	let lockData: Awaited<ReturnType<typeof readLock>> | null = null;
	if (lockExists) {
		lockData = await readLock(lockPath);
	}

	const resolveCommit = deps.resolveRemoteCommit ?? resolveRemoteCommit;
	const filteredSources = options.sourceFilter?.length
		? sources.filter((source) => options.sourceFilter?.includes(source.id))
		: sources;
	const results: SyncResult[] = await Promise.all(
		filteredSources.map(async (source) => {
			const resolved = await resolveCommit({
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
				bytes: lockEntry?.bytes,
				fileCount: lockEntry?.fileCount,
				manifestSha256: lockEntry?.manifestSha256,
			};
		}),
	);

	return {
		configPath: resolvedPath,
		cacheDir: resolvedCacheDir,
		lockPath,
		lockExists,
		results,
		sources: filteredSources,
		defaults,
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
			bytes: result.bytes ?? prior?.bytes ?? 0,
			fileCount: result.fileCount ?? prior?.fileCount ?? 0,
			manifestSha256:
				result.manifestSha256 ?? prior?.manifestSha256 ?? result.resolvedCommit,
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

export const runSync = async (options: SyncOptions, deps: SyncDeps = {}) => {
	const plan = await getSyncPlan(options, deps);
	await mkdir(plan.cacheDir, { recursive: true });
	let previous: Awaited<ReturnType<typeof readLock>> | null = null;
	if (plan.lockExists) {
		previous = await readLock(plan.lockPath);
	}
	if (!options.lockOnly) {
		const defaults = plan.defaults;
		const runFetch = deps.fetchSource ?? fetchSource;
		const runMaterialize = deps.materializeSource ?? materializeSource;
		for (const result of plan.results) {
			if (result.status === "up-to-date") {
				continue;
			}
			const source = plan.sources.find((entry) => entry.id === result.id);
			if (!source) {
				continue;
			}
			const fetch = await runFetch({
				sourceId: source.id,
				repo: source.repo,
				ref: source.ref,
				resolvedCommit: result.resolvedCommit,
				cacheDir: plan.cacheDir,
				depth: source.depth ?? defaults.depth,
				timeoutMs: options.timeoutMs,
			});
			try {
				const stats = await runMaterialize({
					sourceId: source.id,
					repoDir: fetch.repoDir,
					cacheDir: plan.cacheDir,
					include: source.include ?? defaults.include,
					exclude: source.exclude,
					maxBytes: source.maxBytes ?? defaults.maxBytes,
				});
				if (source.targetDir) {
					const resolvedTarget = path.resolve(
						path.dirname(plan.configPath),
						source.targetDir,
					);
					await applyTargetDir({
						sourceDir: path.join(plan.cacheDir, "sources", source.id),
						targetDir: resolvedTarget,
						mode: source.targetMode ?? defaults.targetMode,
					});
				}
				result.bytes = stats.bytes;
				result.fileCount = stats.fileCount;
				result.manifestSha256 = result.resolvedCommit;
			} finally {
				await fetch.cleanup();
			}
		}
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
