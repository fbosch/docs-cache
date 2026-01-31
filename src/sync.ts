import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
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
import { readManifest } from "./manifest";
import { materializeSource } from "./materialize";
import { resolveCacheDir } from "./paths";
import { applyTargetDir } from "./targets";
import { verifyCache } from "./verify";

type SyncOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
	lockOnly: boolean;
	offline: boolean;
	failOnMiss: boolean;
	concurrency?: number;
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
			const lockEntry = lockData?.sources?.[source.id];
			if (options.offline) {
				return {
					id: source.id,
					repo: lockEntry?.repo ?? source.repo,
					ref: lockEntry?.ref ?? source.ref ?? defaults.ref,
					resolvedCommit: lockEntry?.resolvedCommit ?? "offline",
					lockCommit: lockEntry?.resolvedCommit ?? null,
					status: lockEntry ? "up-to-date" : "missing",
					bytes: lockEntry?.bytes,
					fileCount: lockEntry?.fileCount,
					manifestSha256: lockEntry?.manifestSha256,
				};
			}
			const resolved = await resolveCommit({
				repo: source.repo,
				ref: source.ref,
				allowHosts: defaults.allowHosts,
				timeoutMs: options.timeoutMs,
			});
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
	const requiredMissing = plan.results.filter((result) => {
		const source = plan.sources.find((entry) => entry.id === result.id);
		return result.status === "missing" && (source?.required ?? true);
	});
	if (options.failOnMiss && requiredMissing.length > 0) {
		throw new Error(
			`Missing required source(s): ${requiredMissing.map((result) => result.id).join(", ")}.`,
		);
	}
	if (!options.lockOnly) {
		const defaults = plan.defaults;
		const runFetch = deps.fetchSource ?? fetchSource;
		const runMaterialize = deps.materializeSource ?? materializeSource;
		const hasDocs = async (id: string) => {
			const sourceDir = path.join(plan.cacheDir, id);
			if (!(await exists(sourceDir))) {
				return false;
			}
			try {
				const manifest = await readManifest(sourceDir);
				return manifest.entries.length > 0;
			} catch {
				return false;
			}
		};
		const buildJobs = async (ids?: string[], force?: boolean) => {
			const pick = ids?.length
				? plan.results.filter((result) => ids.includes(result.id))
				: plan.results;
			const jobs = await Promise.all(
				pick.map(async (result) => {
					const source = plan.sources.find((entry) => entry.id === result.id);
					if (!source) {
						return null;
					}
					const docsPresent = await hasDocs(result.id);
					const needsMaterialize =
						force || result.status !== "up-to-date" || !docsPresent;
					return needsMaterialize ? { result, source } : null;
				}),
			);
			return jobs.filter(Boolean) as Array<{
				result: SyncResult;
				source: (typeof plan.sources)[number];
			}>;
		};

		const ensureTargets = async () => {
			await Promise.all(
				plan.sources.map(async (source) => {
					if (!source.targetDir) {
						return;
					}
					const resolvedTarget = path.resolve(
						path.dirname(plan.configPath),
						source.targetDir,
					);
					if (await exists(resolvedTarget)) {
						return;
					}
					await applyTargetDir({
						sourceDir: path.join(plan.cacheDir, source.id),
						targetDir: resolvedTarget,
						mode: source.targetMode ?? defaults.targetMode,
					});
				}),
			);
		};

		const runJobs = async (
			jobs: Array<{
				result: SyncResult;
				source: (typeof plan.sources)[number];
			}>,
		) => {
			const concurrency = options.concurrency ?? 4;
			let index = 0;
			const runNext = async () => {
				const job = jobs[index];
				if (!job || !job.source) {
					return;
				}
				index += 1;
				const { result, source } = job;
				if (!options.json) {
					process.stdout.write(`${symbols.info} Fetching ${source.id}...\n`);
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
							sourceDir: path.join(plan.cacheDir, source.id),
							targetDir: resolvedTarget,
							mode: source.targetMode ?? defaults.targetMode,
						});
					}
					result.bytes = stats.bytes;
					result.fileCount = stats.fileCount;
					result.manifestSha256 = result.resolvedCommit;
					if (!options.json) {
						process.stdout.write(
							`${symbols.success} Synced ${source.id} (${stats.fileCount} files)\n`,
						);
					}
				} finally {
					await fetch.cleanup();
				}
				await runNext();
			};

			await Promise.all(
				Array.from({ length: Math.min(concurrency, jobs.length) }, runNext),
			);
		};

		if (options.offline) {
			await ensureTargets();
		} else {
			const initialJobs = await buildJobs();
			await runJobs(initialJobs);
			await ensureTargets();
		}
		if (!options.offline) {
			const verifyReport = await verifyCache({
				configPath: plan.configPath,
				cacheDirOverride: plan.cacheDir,
				json: true,
			});
			const failed = verifyReport.results.filter((result) => !result.ok);
			if (failed.length > 0) {
				const retryJobs = await buildJobs(
					failed.map((result) => result.id),
					true,
				);
				if (retryJobs.length > 0) {
					await runJobs(retryJobs);
					await ensureTargets();
				}
				const retryReport = await verifyCache({
					configPath: plan.configPath,
					cacheDirOverride: plan.cacheDir,
					json: true,
				});
				const stillFailed = retryReport.results.filter((result) => !result.ok);
				if (stillFailed.length > 0) {
					if (!options.json) {
						const details = stillFailed
							.map((result) => `${result.id} (${result.issues.join("; ")})`)
							.join(", ");
						process.stdout.write(
							`${symbols.warn} Verify failed for ${stillFailed.length} source(s): ${details}\n`,
						);
					}
				}
			}
		}
	}
	const lock = await buildLock(plan, previous);
	await writeLock(plan.lockPath, lock);
	plan.lockExists = true;
	return plan;
};

export const printSyncPlan = (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
) => {
	const rel = (value: string) =>
		path.relative(process.cwd(), value) || path.basename(value);
	const summary = {
		upToDate: plan.results.filter((r) => r.status === "up-to-date").length,
		changed: plan.results.filter((r) => r.status === "changed").length,
		missing: plan.results.filter((r) => r.status === "missing").length,
	};
	process.stdout.write(
		`${symbols.info} ${plan.results.length} sources (${summary.upToDate} up-to-date, ${summary.changed} changed, ${summary.missing} missing)\n`,
	);
	const shortHash = (value: string | null) => (value ? value.slice(0, 7) : "-");
	for (const result of plan.results) {
		if (result.status === "up-to-date") {
			process.stdout.write(
				`${symbols.success} ${pc.cyan(result.id)} ${pc.dim("up-to-date")} ${pc.gray(shortHash(result.resolvedCommit))}\n`,
			);
			continue;
		}
		if (result.status === "changed") {
			process.stdout.write(
				`${symbols.warn} ${pc.cyan(result.id)} ${pc.dim("changed")} ${pc.gray(shortHash(result.lockCommit))} ${pc.dim("->")} ${pc.gray(shortHash(result.resolvedCommit))}\n`,
			);
			continue;
		}
		process.stdout.write(
			`${symbols.warn} ${pc.cyan(result.id)} ${pc.dim("missing")} ${pc.gray(shortHash(result.resolvedCommit))}\n`,
		);
	}
};
