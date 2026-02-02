import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { symbols, ui } from "./cli/ui";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheDefaults,
	loadConfig,
} from "./config";
import { fetchSource } from "./git/fetch-source";
import { resolveRemoteCommit } from "./git/resolve-remote";
import { readLock, resolveLockPath, writeLock } from "./lock";
import { MANIFEST_FILENAME } from "./manifest";
import { computeManifestHash, materializeSource } from "./materialize";
import { resolveCacheDir, resolveTargetDir } from "./paths";
import { applyTargetDir } from "./targets";
import { writeToc } from "./toc";
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
	lockRulesSha256?: string;
	status: "up-to-date" | "changed" | "missing";
	bytes?: number;
	fileCount?: number;
	manifestSha256?: string;
	rulesSha256?: string;
};

const formatBytes = (value: number) => {
	if (value < 1024) {
		return `${value} B`;
	}
	const units = ["KB", "MB", "GB", "TB"];
	let size = value;
	let index = -1;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}
	return `${size.toFixed(1)} ${units[index]}`;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const hasDocs = async (cacheDir: string, sourceId: string) => {
	const sourceDir = path.join(cacheDir, sourceId);
	if (!(await exists(sourceDir))) {
		return false;
	}
	return await exists(path.join(sourceDir, MANIFEST_FILENAME));
};

const normalizePatterns = (patterns?: string[]) => {
	if (!patterns || patterns.length === 0) {
		return [];
	}
	const normalized = patterns
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0);
	return Array.from(new Set(normalized)).sort();
};

const RULES_HASH_BLACKLIST = new Set([
	"id",
	"repo",
	"ref",
	"targetDir",
	"targetMode",
	"required",
	"integrity",
	"toc",
]);

const computeRulesHash = (source: DocsCacheResolvedSource) => {
	const entries = Object.entries(source)
		.filter(
			([key, value]) => value !== undefined && !RULES_HASH_BLACKLIST.has(key),
		)
		.map(([key, value]) => {
			if (key === "include" && Array.isArray(value)) {
				return [key, normalizePatterns(value)];
			}
			if (key === "exclude" && Array.isArray(value)) {
				return [key, normalizePatterns(value)];
			}
			return [key, value];
		})
		.sort(([left], [right]) => left.localeCompare(right));
	const payload = Object.fromEntries(entries);
	const hash = createHash("sha256");
	hash.update(JSON.stringify(payload));
	return hash.digest("hex");
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
			const include = source.include ?? defaults.include;
			const exclude = source.exclude;
			const rulesSha256 = computeRulesHash({
				...source,
				include,
				exclude,
			});
			if (options.offline) {
				const docsPresent = await hasDocs(resolvedCacheDir, source.id);
				return {
					id: source.id,
					repo: lockEntry?.repo ?? source.repo,
					ref: lockEntry?.ref ?? source.ref ?? defaults.ref,
					resolvedCommit: lockEntry?.resolvedCommit ?? "offline",
					lockCommit: lockEntry?.resolvedCommit ?? null,
					lockRulesSha256: lockEntry?.rulesSha256,
					status: lockEntry && docsPresent ? "up-to-date" : "missing",
					bytes: lockEntry?.bytes,
					fileCount: lockEntry?.fileCount,
					manifestSha256: lockEntry?.manifestSha256,
					rulesSha256,
				};
			}
			const resolved = await resolveCommit({
				repo: source.repo,
				ref: source.ref,
				allowHosts: defaults.allowHosts,
				timeoutMs: options.timeoutMs,
			});
			const upToDate =
				lockEntry?.resolvedCommit === resolved.resolvedCommit &&
				lockEntry?.rulesSha256 === rulesSha256;
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
				lockRulesSha256: lockEntry?.rulesSha256,
				status,
				bytes: lockEntry?.bytes,
				fileCount: lockEntry?.fileCount,
				manifestSha256: lockEntry?.manifestSha256,
				rulesSha256,
			};
		}),
	);

	return {
		config,
		configPath: resolvedPath,
		cacheDir: resolvedCacheDir,
		lockPath,
		lockExists,
		lockData,
		results,
		sources: filteredSources,
		defaults,
	};
};

const loadToolVersion = async () => {
	const cwdPath = path.resolve(process.cwd(), "package.json");
	try {
		const raw = await readFile(cwdPath, "utf8");
		const pkg = JSON.parse(raw.toString());
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		// fallback to bundle-relative location
	}
	try {
		const raw = await readFile(
			new URL("../package.json", import.meta.url),
			"utf8",
		);
		const pkg = JSON.parse(raw.toString());
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		// fallback to dist/chunks relative location
	}
	try {
		const raw = await readFile(
			new URL("../../package.json", import.meta.url),
			"utf8",
		);
		const pkg = JSON.parse(raw.toString());
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
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
			rulesSha256: result.rulesSha256 ?? prior?.rulesSha256,
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
	const startTime = process.hrtime.bigint();
	let warningCount = 0;
	const plan = await getSyncPlan(options, deps);
	await mkdir(plan.cacheDir, { recursive: true });
	const previous = plan.lockData;
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
		const docsPresence = new Map<string, boolean>();
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
					if (force) {
						return { result, source };
					}
					let docsPresent = docsPresence.get(result.id);
					if (docsPresent === undefined) {
						docsPresent = await hasDocs(plan.cacheDir, result.id);
						docsPresence.set(result.id, docsPresent);
					}
					const needsMaterialize =
						result.status !== "up-to-date" || !docsPresent;
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
					const resolvedTarget = resolveTargetDir(
						plan.configPath,
						source.targetDir,
					);
					if (await exists(resolvedTarget)) {
						return;
					}
					await applyTargetDir({
						sourceDir: path.join(plan.cacheDir, source.id),
						targetDir: resolvedTarget,
						mode: source.targetMode ?? defaults.targetMode,
						explicitTargetMode: source.targetMode !== undefined,
						unwrapSingleRootDir: source.unwrapSingleRootDir,
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
				const lockEntry = plan.lockData?.sources?.[source.id];
				if (!options.json) {
					ui.step("Fetching", source.id);
				}
				const fetch = await runFetch({
					sourceId: source.id,
					repo: source.repo,
					ref: source.ref,
					resolvedCommit: result.resolvedCommit,
					cacheDir: plan.cacheDir,
					include: source.include ?? defaults.include,
					timeoutMs: options.timeoutMs,
				});
				try {
					const manifestPath = path.join(
						plan.cacheDir,
						source.id,
						MANIFEST_FILENAME,
					);
					if (
						result.status !== "up-to-date" &&
						lockEntry?.manifestSha256 &&
						(await exists(manifestPath))
					) {
						const computed = await computeManifestHash({
							sourceId: source.id,
							repoDir: fetch.repoDir,
							cacheDir: plan.cacheDir,
							include: source.include ?? defaults.include,
							exclude: source.exclude,
							maxBytes: source.maxBytes ?? defaults.maxBytes,
							maxFiles: source.maxFiles ?? defaults.maxFiles,
						});
						if (computed.manifestSha256 === lockEntry.manifestSha256) {
							result.bytes = computed.bytes;
							result.fileCount = computed.fileCount;
							result.manifestSha256 = computed.manifestSha256;
							result.status = "up-to-date";
							if (!options.json) {
								ui.item(symbols.success, source.id, "no content changes");
							}
							await runNext();
							return;
						}
					}
					const stats = await runMaterialize({
						sourceId: source.id,
						repoDir: fetch.repoDir,
						cacheDir: plan.cacheDir,
						include: source.include ?? defaults.include,
						exclude: source.exclude,
						maxBytes: source.maxBytes ?? defaults.maxBytes,
						maxFiles: source.maxFiles ?? defaults.maxFiles,
					});
					if (source.targetDir) {
						const resolvedTarget = resolveTargetDir(
							plan.configPath,
							source.targetDir,
						);
						await applyTargetDir({
							sourceDir: path.join(plan.cacheDir, source.id),
							targetDir: resolvedTarget,
							mode: source.targetMode ?? defaults.targetMode,
							explicitTargetMode: source.targetMode !== undefined,
							unwrapSingleRootDir: source.unwrapSingleRootDir,
						});
					}
					result.bytes = stats.bytes;
					result.fileCount = stats.fileCount;
					result.manifestSha256 = stats.manifestSha256;
					if (!options.json) {
						ui.item(
							symbols.success,
							source.id,
							`synced ${stats.fileCount} files`,
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
					warningCount += 1;
					if (!options.json) {
						const details = stillFailed
							.map((result) => `${result.id} (${result.issues.join("; ")})`)
							.join(", ");
						ui.line(
							`${symbols.warn} Verify failed for ${stillFailed.length} source(s): ${details}`,
						);
					}
				}
			}
		}
	}
	const lock = await buildLock(plan, previous);
	await writeLock(plan.lockPath, lock);
	if (!options.json) {
		const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
		const totalBytes = plan.results.reduce(
			(sum, result) => sum + (result.bytes ?? 0),
			0,
		);
		const totalFiles = plan.results.reduce(
			(sum, result) => sum + (result.fileCount ?? 0),
			0,
		);
		ui.line(
			`${symbols.info} Completed in ${elapsedMs.toFixed(0)}ms · ${formatBytes(totalBytes)} · ${totalFiles} files${warningCount ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`,
		);
	}
	// Always call writeToc to handle both generation and cleanup
	await writeToc({
		cacheDir: plan.cacheDir,
		configPath: plan.configPath,
		lock,
		sources: plan.sources,
		results: plan.results,
	});
	plan.lockExists = true;
	return plan;
};

export const printSyncPlan = (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
) => {
	const summary = {
		upToDate: plan.results.filter((r) => r.status === "up-to-date").length,
		changed: plan.results.filter((r) => r.status === "changed").length,
		missing: plan.results.filter((r) => r.status === "missing").length,
	};

	if (plan.results.length === 0) {
		ui.line(`${symbols.info} No sources to sync.`);
		return;
	}

	ui.line(
		`${symbols.info} ${plan.results.length} sources (${summary.upToDate} up-to-date, ${summary.changed} changed, ${summary.missing} missing)`,
	);

	for (const result of plan.results) {
		const shortResolved = ui.hash(result.resolvedCommit);
		const shortLock = ui.hash(result.lockCommit);
		const rulesChanged =
			Boolean(result.lockRulesSha256) &&
			Boolean(result.rulesSha256) &&
			result.lockRulesSha256 !== result.rulesSha256;

		if (result.status === "up-to-date") {
			ui.item(
				symbols.success,
				result.id,
				`${pc.dim("up-to-date")} ${pc.gray(shortResolved)}`,
			);
			continue;
		}
		if (result.status === "changed") {
			if (result.lockCommit === result.resolvedCommit && rulesChanged) {
				ui.item(
					symbols.warn,
					result.id,
					`${pc.dim("rules changed")} ${pc.gray(shortResolved)}`,
				);
				continue;
			}
			ui.item(
				symbols.warn,
				result.id,
				`${pc.dim("changed")} ${pc.gray(shortLock)} ${pc.dim("->")} ${pc.gray(shortResolved)}`,
			);
			continue;
		}
		ui.item(
			symbols.warn,
			result.id,
			`${pc.dim("missing")} ${pc.gray(shortResolved)}`,
		);
	}
};
