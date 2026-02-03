import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { TaskReporter } from "./cli/task-reporter";
import { isSilentMode, symbols, ui } from "./cli/ui";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheDefaults,
	type DocsCacheResolvedSource,
	loadConfig,
} from "./config";
import { fetchSource } from "./git/fetch-source";
import { resolveRemoteCommit } from "./git/resolve-remote";
import type { DocsCacheLock } from "./lock";
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
	verbose?: boolean;
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

const RULES_HASH_BLACKLIST = [
	"id",
	"repo",
	"ref",
	"targetDir",
	"targetMode",
	"required",
	"integrity",
	"toc",
] as const;

type RulesHashBlacklistKey = (typeof RULES_HASH_BLACKLIST)[number];
type RulesHashKey = Exclude<
	keyof DocsCacheResolvedSource,
	RulesHashBlacklistKey
>;

const RULES_HASH_KEYS = [
	"mode",
	"include",
	"exclude",
	"maxBytes",
	"maxFiles",
	"ignoreHidden",
	"unwrapSingleRootDir",
] as const satisfies ReadonlyArray<RulesHashKey>;

const normalizeRulesValue = (
	key: RulesHashKey,
	value: DocsCacheResolvedSource[RulesHashKey],
) => {
	if (key === "include" && Array.isArray(value)) {
		return normalizePatterns(value);
	}
	if (key === "exclude" && Array.isArray(value)) {
		return normalizePatterns(value);
	}
	return value;
};

const computeRulesHash = (source: DocsCacheResolvedSource) => {
	const entries = RULES_HASH_KEYS.map((key) => [
		key,
		normalizeRulesValue(key, source[key]),
	]) as Array<[string, unknown]>;
	entries.sort(([left]: [string, unknown], [right]: [string, unknown]) =>
		left.localeCompare(right),
	);
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
			const rulesSha256 = computeRulesSha(source, defaults);
			if (options.offline) {
				return buildOfflineResult({
					source,
					lockEntry,
					defaults,
					resolvedCacheDir,
					rulesSha256,
				});
			}
			return buildOnlineResult({
				source,
				lockEntry,
				defaults,
				options,
				resolveCommit,
				rulesSha256,
			});
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

const buildLockSource = (
	result: SyncResult,
	prior: DocsCacheLock["sources"][string] | undefined,
	now: string,
) => ({
	repo: result.repo,
	ref: result.ref,
	resolvedCommit: result.resolvedCommit,
	bytes: result.bytes ?? prior?.bytes ?? 0,
	fileCount: result.fileCount ?? prior?.fileCount ?? 0,
	manifestSha256:
		result.manifestSha256 ?? prior?.manifestSha256 ?? result.resolvedCommit,
	rulesSha256: result.rulesSha256 ?? prior?.rulesSha256,
	updatedAt: now,
});

const buildLock = async (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
	previous: Awaited<ReturnType<typeof readLock>> | null,
) => {
	const toolVersion = await loadToolVersion();
	const now = new Date().toISOString();
	const sources = { ...(previous?.sources ?? {}) };
	for (const result of plan.results) {
		const prior = sources[result.id];
		sources[result.id] = buildLockSource(result, prior, now);
	}
	return {
		version: 1 as const,
		generatedAt: now,
		toolVersion,
		sources,
	};
};

type SyncPlan = Awaited<ReturnType<typeof getSyncPlan>>;
type SyncJob = {
	result: SyncResult;
	source: SyncPlan["sources"][number];
};

const buildSyncResultBase = (params: {
	source: DocsCacheResolvedSource;
	lockEntry: DocsCacheLock["sources"][string] | undefined;
	defaults: DocsCacheDefaults;
	resolvedCommit: string;
	rulesSha256: string;
	repo?: string;
	ref?: string;
}) => {
	const {
		source,
		lockEntry,
		defaults,
		resolvedCommit,
		rulesSha256,
		repo,
		ref,
	} = params;
	return {
		id: source.id,
		repo: repo ?? lockEntry?.repo ?? source.repo,
		ref: ref ?? lockEntry?.ref ?? source.ref ?? defaults.ref,
		resolvedCommit,
		lockCommit: lockEntry?.resolvedCommit ?? null,
		lockRulesSha256: lockEntry?.rulesSha256,
		bytes: lockEntry?.bytes,
		fileCount: lockEntry?.fileCount,
		manifestSha256: lockEntry?.manifestSha256,
		rulesSha256,
	};
};

const computeRulesSha = (
	source: DocsCacheResolvedSource,
	defaults: DocsCacheDefaults,
) => {
	const include = source.include ?? defaults.include;
	const exclude = source.exclude ?? defaults.exclude;
	return computeRulesHash({
		...source,
		include,
		exclude,
	});
};

const buildOfflineResult = async (params: {
	source: DocsCacheResolvedSource;
	lockEntry: DocsCacheLock["sources"][string] | undefined;
	defaults: DocsCacheDefaults;
	resolvedCacheDir: string;
	rulesSha256: string;
}): Promise<SyncResult> => {
	const { source, lockEntry, defaults, resolvedCacheDir, rulesSha256 } = params;
	const docsPresent = await hasDocs(resolvedCacheDir, source.id);
	const resolvedCommit = lockEntry?.resolvedCommit ?? "offline";
	const base = buildSyncResultBase({
		source,
		lockEntry,
		defaults,
		resolvedCommit,
		rulesSha256,
	});
	return {
		...base,
		status: lockEntry && docsPresent ? "up-to-date" : "missing",
	};
};

const buildOnlineResult = async (params: {
	source: DocsCacheResolvedSource;
	lockEntry: DocsCacheLock["sources"][string] | undefined;
	defaults: DocsCacheDefaults;
	options: SyncOptions;
	resolveCommit: typeof resolveRemoteCommit;
	rulesSha256: string;
}): Promise<SyncResult> => {
	const { source, lockEntry, defaults, options, resolveCommit, rulesSha256 } =
		params;
	const resolved = await resolveCommit({
		repo: source.repo,
		ref: source.ref,
		allowHosts: defaults.allowHosts,
		timeoutMs: options.timeoutMs,
		logger: options.verbose && !options.json ? ui.debug : undefined,
	});
	const upToDate =
		lockEntry?.resolvedCommit === resolved.resolvedCommit &&
		lockEntry?.rulesSha256 === rulesSha256;
	let status: SyncResult["status"] = "missing";
	if (lockEntry) {
		status = upToDate ? "up-to-date" : "changed";
	}
	const base = buildSyncResultBase({
		source,
		lockEntry,
		defaults,
		resolvedCommit: resolved.resolvedCommit,
		rulesSha256,
		repo: resolved.repo,
		ref: resolved.ref,
	});
	return { ...base, status };
};

const logFetchStatus = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	sourceId: string,
	fromCache: boolean,
) => {
	if (reporter) {
		reporter.debug(
			`${sourceId}: ${fromCache ? "restored from cache" : "downloaded"}`,
		);
		return;
	}
	if (!options.json) {
		ui.step(fromCache ? "Restoring from cache" : "Downloading repo", sourceId);
	}
};

const logMaterializeStart = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	sourceId: string,
) => {
	if (reporter) {
		reporter.debug(`${sourceId}: materializing`);
		return;
	}
	if (!options.json) {
		ui.step("Materializing", sourceId);
	}
};

const reportNoChanges = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	sourceId: string,
) => {
	if (reporter) {
		reporter.success(sourceId, "no content changes");
		return;
	}
	if (!options.json) {
		ui.item(symbols.success, sourceId, "no content changes");
	}
};

const reportSynced = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	sourceId: string,
	fileCount: number,
) => {
	if (reporter) {
		reporter.success(sourceId, `synced ${fileCount} files`, symbols.synced);
		return;
	}
	if (!options.json) {
		ui.item(symbols.synced, sourceId, `synced ${fileCount} files`);
	}
};

const createLoggers = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	sourceId: string,
) => {
	const logDebug =
		options.verbose && !options.json
			? reporter
				? (msg: string) => reporter.debug(msg)
				: ui.debug
			: undefined;
	const logProgress = reporter
		? (msg: string) => reporter.debug(`${sourceId}: ${msg}`)
		: undefined;
	return { logDebug, logProgress };
};

const applyTargetIfNeeded = async (
	plan: SyncPlan,
	defaults: DocsCacheDefaults,
	source: SyncPlan["sources"][number],
) => {
	if (!source.targetDir) {
		return;
	}
	const resolvedTarget = resolveTargetDir(plan.configPath, source.targetDir);
	await applyTargetDir({
		sourceDir: path.join(plan.cacheDir, source.id),
		targetDir: resolvedTarget,
		mode: source.targetMode ?? defaults.targetMode,
		explicitTargetMode: source.targetMode !== undefined,
		unwrapSingleRootDir: source.unwrapSingleRootDir,
	});
};

const materializeJob = async (params: {
	plan: SyncPlan;
	options: SyncOptions;
	defaults: DocsCacheDefaults;
	reporter: TaskReporter | null;
	source: SyncPlan["sources"][number];
	fetch: Awaited<ReturnType<typeof fetchSource>>;
	runMaterialize: typeof materializeSource;
	result: SyncResult;
}) => {
	const {
		plan,
		options,
		defaults,
		reporter,
		source,
		fetch,
		runMaterialize,
		result,
	} = params;
	logMaterializeStart(reporter, options, source.id);
	const stats = await runMaterialize({
		sourceId: source.id,
		repoDir: fetch.repoDir,
		cacheDir: plan.cacheDir,
		include: source.include ?? defaults.include,
		exclude: source.exclude,
		maxBytes: source.maxBytes ?? defaults.maxBytes,
		maxFiles: source.maxFiles ?? defaults.maxFiles,
		ignoreHidden: source.ignoreHidden ?? defaults.ignoreHidden,
		unwrapSingleRootDir: source.unwrapSingleRootDir,
		json: options.json,
		progressLogger: reporter
			? (msg: string) => reporter.debug(`${source.id}: ${msg}`)
			: undefined,
	});
	await applyTargetIfNeeded(plan, defaults, source);
	result.bytes = stats.bytes;
	result.fileCount = stats.fileCount;
	result.manifestSha256 = stats.manifestSha256;
	result.status = "up-to-date";
	reportSynced(reporter, options, source.id, stats.fileCount);
};

const verifyAndRepairCache = async (params: {
	plan: SyncPlan;
	options: SyncOptions;
	docsPresence: Map<string, boolean>;
	defaults: DocsCacheDefaults;
	reporter: TaskReporter | null;
	runJobs: (jobs: SyncJob[]) => Promise<void>;
}) => {
	const { plan, options, docsPresence, defaults, reporter, runJobs } = params;
	if (options.offline) {
		return 0;
	}
	const shouldVerify = !options.json || plan.results.length > 0;
	if (!shouldVerify) {
		return 0;
	}
	const verifyReport = await verifyCache({
		configPath: plan.configPath,
		cacheDirOverride: plan.cacheDir,
		json: true,
	});
	const failed = verifyReport.results.filter((result) => !result.ok);
	if (failed.length === 0) {
		return 0;
	}
	const retryJobs = await buildJobs(
		plan,
		options,
		docsPresence,
		failed.map((result) => result.id),
		true,
	);
	if (retryJobs.length > 0) {
		await runJobs(retryJobs);
		await ensureTargets(plan, defaults);
	}
	const retryReport = await verifyCache({
		configPath: plan.configPath,
		cacheDirOverride: plan.cacheDir,
		json: true,
	});
	const stillFailed = retryReport.results.filter((result) => !result.ok);
	if (stillFailed.length === 0) {
		return 0;
	}
	reportVerifyFailures(reporter, options, stillFailed);
	return 1;
};

const tryReuseManifest = async (params: {
	result: SyncResult;
	source: SyncPlan["sources"][number];
	lockEntry: DocsCacheLock["sources"][string] | undefined;
	plan: SyncPlan;
	defaults: DocsCacheDefaults;
	fetch: Awaited<ReturnType<typeof fetchSource>>;
	reporter: TaskReporter | null;
	options: SyncOptions;
}) => {
	const {
		result,
		source,
		lockEntry,
		plan,
		defaults,
		fetch,
		reporter,
		options,
	} = params;
	if (result.status === "up-to-date") {
		return false;
	}
	if (!lockEntry?.manifestSha256) {
		return false;
	}
	if (lockEntry.rulesSha256 !== result.rulesSha256) {
		return false;
	}
	const manifestPath = path.join(plan.cacheDir, source.id, MANIFEST_FILENAME);
	if (!(await exists(manifestPath))) {
		return false;
	}
	const computed = await computeManifestHash({
		sourceId: source.id,
		repoDir: fetch.repoDir,
		cacheDir: plan.cacheDir,
		include: source.include ?? defaults.include,
		exclude: source.exclude,
		maxBytes: source.maxBytes ?? defaults.maxBytes,
		maxFiles: source.maxFiles ?? defaults.maxFiles,
		ignoreHidden: source.ignoreHidden ?? defaults.ignoreHidden,
	});
	if (computed.manifestSha256 !== lockEntry.manifestSha256) {
		return false;
	}
	result.bytes = computed.bytes;
	result.fileCount = computed.fileCount;
	result.manifestSha256 = computed.manifestSha256;
	result.status = "up-to-date";
	reportNoChanges(reporter, options, source.id);
	return true;
};

const buildJobs = async (
	plan: SyncPlan,
	options: SyncOptions,
	docsPresence: Map<string, boolean>,
	ids?: string[],
	force?: boolean,
): Promise<SyncJob[]> => {
	const pick = ids?.length
		? plan.results.filter((result) => ids.includes(result.id))
		: plan.results;
	const jobs = await Promise.all(
		pick.map(async (result) => {
			const source = plan.sources.find((entry) => entry.id === result.id);
			if (!source) {
				return null;
			}
			if (options.offline) {
				const lockEntry = plan.lockData?.sources?.[result.id];
				if (!lockEntry?.resolvedCommit) {
					return null;
				}
			}
			if (force) {
				return { result, source };
			}
			let docsPresent = docsPresence.get(result.id);
			if (docsPresent === undefined) {
				docsPresent = await hasDocs(plan.cacheDir, result.id);
				docsPresence.set(result.id, docsPresent);
			}
			const needsMaterialize = result.status !== "up-to-date" || !docsPresent;
			if (!needsMaterialize) {
				return null;
			}
			return { result, source };
		}),
	);
	return jobs.filter(Boolean) as SyncJob[];
};

const ensureTargets = async (plan: SyncPlan, defaults: DocsCacheDefaults) => {
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

const summarizePlan = (plan: SyncPlan) => {
	const totalBytes = plan.results.reduce(
		(sum, result) => sum + (result.bytes ?? 0),
		0,
	);
	const totalFiles = plan.results.reduce(
		(sum, result) => sum + (result.fileCount ?? 0),
		0,
	);
	return { totalBytes, totalFiles };
};

const reportVerifyFailures = (
	reporter: TaskReporter | null,
	options: SyncOptions,
	stillFailed: Array<{ id: string; issues: string[] }>,
) => {
	if (stillFailed.length === 0) {
		return;
	}
	if (reporter) {
		for (const failed of stillFailed) {
			reporter.warn(failed.id, failed.issues.join("; "));
		}
		return;
	}
	if (!options.json) {
		const details = stillFailed
			.map((result) => `${result.id} (${result.issues.join("; ")})`)
			.join(", ");
		ui.line(
			`${symbols.warn} Verify failed for ${stillFailed.length} source(s): ${details}`,
		);
	}
};

const finalizeSync = async (params: {
	plan: SyncPlan;
	previous: Awaited<ReturnType<typeof readLock>> | null;
	reporter: TaskReporter | null;
	options: SyncOptions;
	startTime: bigint;
	warningCount: number;
}) => {
	const { plan, previous, reporter, options, startTime, warningCount } = params;
	const lock = await buildLock(plan, previous);
	await writeLock(plan.lockPath, lock);
	const { totalBytes, totalFiles } = summarizePlan(plan);
	if (reporter) {
		const summary = `${symbols.info} ${formatBytes(totalBytes)} · ${totalFiles} files`;
		reporter.finish(summary);
	}
	if (!reporter && !options.json) {
		const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
		ui.line(
			`${symbols.info} Completed in ${elapsedMs.toFixed(0)}ms · ${formatBytes(totalBytes)} · ${totalFiles} files${warningCount ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`,
		);
	}
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

const createJobRunner = (params: {
	plan: SyncPlan;
	options: SyncOptions;
	defaults: DocsCacheDefaults;
	reporter: TaskReporter | null;
	runFetch: typeof fetchSource;
	runMaterialize: typeof materializeSource;
}) => {
	const { plan, options, defaults, reporter, runFetch, runMaterialize } =
		params;
	return async (jobs: SyncJob[]) => {
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
			const { logDebug, logProgress } = createLoggers(
				reporter,
				options,
				source.id,
			);

			if (reporter) {
				reporter.start(source.id);
			}

			const fetch = await runFetch({
				sourceId: source.id,
				repo: source.repo,
				ref: source.ref,
				resolvedCommit: result.resolvedCommit,
				cacheDir: plan.cacheDir,
				include: source.include ?? defaults.include,
				timeoutMs: options.timeoutMs,
				logger: logDebug,
				progressLogger: logProgress,
				offline: options.offline,
			});
			logFetchStatus(reporter, options, source.id, fetch.fromCache);
			try {
				const reusedManifest = await tryReuseManifest({
					result,
					source,
					lockEntry,
					plan,
					defaults,
					fetch,
					reporter,
					options,
				});
				if (reusedManifest) {
					await runNext();
					return;
				}
				await materializeJob({
					plan,
					options,
					defaults,
					reporter,
					source,
					fetch,
					runMaterialize,
					result,
				});
			} finally {
				await fetch.cleanup();
			}
			await runNext();
		};

		await Promise.all(
			Array.from({ length: Math.min(concurrency, jobs.length) }, runNext),
		);
	};
};

export const runSync = async (options: SyncOptions, deps: SyncDeps = {}) => {
	const startTime = process.hrtime.bigint();
	let warningCount = 0;
	const plan = await getSyncPlan(options, deps);
	await mkdir(plan.cacheDir, { recursive: true });

	const useLiveOutput =
		!options.json && !isSilentMode() && process.stdout.isTTY;
	const reporter = useLiveOutput ? new TaskReporter() : null;
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
		const runJobs = createJobRunner({
			plan,
			options,
			defaults,
			reporter,
			runFetch,
			runMaterialize,
		});

		const initialJobs = await buildJobs(plan, options, docsPresence);
		await runJobs(initialJobs);
		await ensureTargets(plan, defaults);
		warningCount += await verifyAndRepairCache({
			plan,
			options,
			docsPresence,
			defaults,
			reporter,
			runJobs,
		});
	}
	return finalizeSync({
		plan,
		previous,
		reporter,
		options,
		startTime,
		warningCount,
	});
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
