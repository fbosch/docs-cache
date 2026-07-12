import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import type {
	DocsCacheLock,
	DocsCacheLockSource,
	DocsCacheOpenCodeLock,
} from "#cache/lock";
import { readLock, resolveLockPath, writeLock } from "#cache/lock";
import { MANIFEST_FILENAME } from "#cache/manifest";
import { computeManifestHash, materializeSource } from "#cache/materialize";
import { applyTargetDir } from "#cache/targets";
import { writeToc } from "#cache/toc";
import { TaskReporter } from "#cli/task-reporter";
import { isSilentMode, symbols, ui } from "#cli/ui";
import { verifyCache } from "#commands/verify";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheDefaults,
	type DocsCacheResolvedSource,
	loadConfig,
} from "#config";
import { isRecord } from "#core/is-record";
import { resolveCacheDir, resolveTargetDir } from "#core/paths";
import { fetchSource } from "#git/fetch-source";
import { resolveRemoteCommit } from "#git/resolve-remote";
import {
	readOpenCodeOwnership,
	restoreOpenCodeOwnership,
	writeOpenCodeOwnership,
} from "#opencode/ownership";
import { planOpenCodeReferences } from "#opencode/references";
import type { SyncOptions, SyncResult } from "#types/sync";

type SyncDeps = {
	resolveRemoteCommit?: typeof resolveRemoteCommit;
	fetchSource?: typeof fetchSource;
	materializeSource?: typeof materializeSource;
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
			if (options.install) {
				return buildInstallResult({
					source,
					lockEntry,
					defaults,
					resolvedCacheDir,
					rulesSha256,
				});
			}
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

const TOOL_PACKAGE_NAME = "docs-cache";

const readToolVersionFromPackageFile = async (packagePath: string) => {
	try {
		const raw = await readFile(packagePath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) {
			return null;
		}
		const pkgName = parsed.name;
		const pkgVersion = parsed.version;
		if (pkgName !== TOOL_PACKAGE_NAME) {
			return null;
		}
		if (typeof pkgVersion !== "string" || pkgVersion.length === 0) {
			return null;
		}
		return pkgVersion;
	} catch {
		return null;
	}
};

const findToolVersionFrom = async (startDir: string) => {
	let currentDir = startDir;
	while (true) {
		const packagePath = path.join(currentDir, "package.json");
		const version = await readToolVersionFromPackageFile(packagePath);
		if (version) {
			return version;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
};

const loadToolVersion = async () => {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const moduleVersion = await findToolVersionFrom(moduleDir);
	if (moduleVersion) {
		return moduleVersion;
	}
	const cwdVersion = await findToolVersionFrom(process.cwd());
	if (cwdVersion) {
		return cwdVersion;
	}
	return "0.0.0";
};

const buildLockSource = (
	result: SyncResult,
	prior: DocsCacheLock["sources"][string] | undefined,
) => ({
	repo: result.repo,
	ref: result.ref,
	resolvedCommit: result.resolvedCommit,
	bytes: result.bytes ?? prior?.bytes ?? 0,
	fileCount: result.fileCount ?? prior?.fileCount ?? 0,
	manifestSha256:
		result.manifestSha256 ?? prior?.manifestSha256 ?? result.resolvedCommit,
	rulesSha256: result.rulesSha256 ?? prior?.rulesSha256,
});

const buildLock = async (
	plan: Awaited<ReturnType<typeof getSyncPlan>>,
	previous: Awaited<ReturnType<typeof readLock>> | null,
	opencode: DocsCacheOpenCodeLock | null | undefined,
) => {
	const toolVersion = await loadToolVersion();
	const configSourceIds = new Set(
		plan.config.sources.map((source) => source.id),
	);
	const sources: Record<string, DocsCacheLockSource> = {};
	if (previous?.sources) {
		for (const [id, source] of Object.entries(previous.sources)) {
			if (configSourceIds.has(id)) {
				sources[id] = source;
			}
		}
	}
	for (const result of plan.results) {
		const prior = sources[result.id];
		sources[result.id] = buildLockSource(result, prior);
	}
	return {
		version: 1 as const,
		toolVersion,
		sources,
		...(opencode === undefined
			? previous?.opencode
				? { opencode: previous.opencode }
				: {}
			: opencode
				? { opencode }
				: {}),
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

const buildInstallResult = async (params: {
	source: DocsCacheResolvedSource;
	lockEntry: DocsCacheLock["sources"][string] | undefined;
	defaults: DocsCacheDefaults;
	resolvedCacheDir: string;
	rulesSha256: string;
}): Promise<SyncResult> => {
	const { source, lockEntry, defaults, resolvedCacheDir, rulesSha256 } = params;
	const docsPresent = await hasDocs(resolvedCacheDir, source.id);
	const resolvedCommit = lockEntry?.resolvedCommit ?? "missing";
	const base = buildSyncResultBase({
		source,
		lockEntry,
		defaults,
		resolvedCommit,
		rulesSha256,
	});
	if (!lockEntry) {
		return { ...base, status: "missing" };
	}
	if (lockEntry.rulesSha256 !== rulesSha256) {
		return { ...base, status: "changed" };
	}
	return { ...base, status: docsPresent ? "up-to-date" : "changed" };
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

const assertInstallLock = (plan: SyncPlan) => {
	if (!plan.lockData) {
		throw new Error(
			"Install requires docs-lock.json. Run docs-cache sync first.",
		);
	}
	const missing = plan.sources.filter(
		(source) => !plan.lockData?.sources[source.id],
	);
	if (missing.length > 0) {
		throw new Error(
			`Install failed: lock is missing source(s): ${missing
				.map((source) => source.id)
				.join(
					", ",
				)}. Run docs-cache update or docs-cache sync to refresh the lock.`,
		);
	}
	const changed = plan.results.filter(
		(result) => result.lockRulesSha256 !== result.rulesSha256,
	);
	const driftedSources = plan.sources.filter((source) => {
		const lockEntry = plan.lockData?.sources[source.id];
		return lockEntry?.repo !== source.repo || lockEntry.ref !== source.ref;
	});
	changed.push(
		...driftedSources
			.filter((source) => !changed.some((result) => result.id === source.id))
			.map((source) => {
				const result = plan.results.find((entry) => entry.id === source.id);
				if (!result) {
					throw new Error(
						`Install failed: source ${source.id} is missing from plan.`,
					);
				}
				return result;
			}),
	);
	if (changed.length > 0) {
		throw new Error(
			`Install failed: lock is out of date for source(s): ${changed
				.map((result) => result.id)
				.join(
					", ",
				)}. Run docs-cache update or docs-cache sync to refresh the lock.`,
		);
	}
};

const buildFinalLock = async (params: {
	plan: SyncPlan;
	previous: Awaited<ReturnType<typeof readLock>> | null;
	options: SyncOptions;
	opencode: DocsCacheOpenCodeLock | null | undefined;
}) => {
	const { plan, previous, options, opencode } = params;
	const lock = options.install
		? previous
		: await buildLock(plan, previous, opencode);
	if (!lock) {
		throw new Error(
			"Install requires docs-lock.json. Run docs-cache sync first.",
		);
	}
	return lock;
};

const finalizeSync = async (params: {
	plan: SyncPlan;
	lock: DocsCacheLock;
	reporter: TaskReporter | null;
	options: SyncOptions;
	startTime: bigint;
	warningCount: number;
}) => {
	const { plan, lock, reporter, options, startTime, warningCount } = params;
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
		const concurrencyRaw = options.concurrency ?? 4;
		const concurrency = Math.floor(concurrencyRaw);
		if (!Number.isFinite(concurrencyRaw) || concurrency < 1) {
			throw new TypeError(
				"Invalid options.concurrency; must be a positive number.",
			);
		}
		let index = 0;
		const runNext = async () => {
			const job = jobs[index];
			if (!job?.source) {
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
				repo: options.install ? (lockEntry?.repo ?? source.repo) : source.repo,
				ref: options.install ? (lockEntry?.ref ?? source.ref) : source.ref,
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

const assertValidSyncOptions = (options: SyncOptions) => {
	if (options.install && options.lockOnly) {
		throw new Error("Install does not support lockOnly.");
	}
};

const createSyncReporter = (options: SyncOptions) => {
	const isTestRunner = process.argv.includes("--test");
	const useLiveOutput = [
		options.json === false,
		isSilentMode() === false,
		process.stdout.isTTY,
		isTestRunner === false,
	].every(Boolean);
	return useLiveOutput ? new TaskReporter() : null;
};

const shouldPlanOpenCodeReferences = (options: SyncOptions) =>
	options.install !== true &&
	(options.lockOnly !== true || Boolean(options.frozen));

const planOpenCodeSync = async (plan: SyncPlan, options: SyncOptions) => {
	if (!shouldPlanOpenCodeReferences(options)) {
		return { ownership: undefined, references: undefined };
	}
	const ownership = await readOpenCodeOwnership(plan.configPath);
	const references = await planOpenCodeReferences({
		opencode: plan.config.opencode,
		ownership,
		sources: plan.config.sources,
		cacheDir: plan.cacheDir,
	});
	return { ownership, references };
};

const assertFrozenSync = (
	plan: SyncPlan,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) => {
	const drifted = plan.results.filter(
		(result) => result.status !== "up-to-date",
	);
	if (drifted.length > 0) {
		throw new Error(
			`Frozen sync failed: lock is out of date for source(s): ${drifted
				.map((result) => result.id)
				.join(
					", ",
				)}. Run docs-cache update or docs-cache sync to refresh the lock.`,
		);
	}
	if (openCodeReferences?.drift.length) {
		throw new Error(
			`Frozen sync failed: OpenCode references are out of date for alias(es): ${openCodeReferences.drift.join(", ")}. Run docs-cache sync to refresh them.`,
		);
	}
};

const assertSyncPreconditions = (
	plan: SyncPlan,
	options: SyncOptions,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) => {
	assertInstallPrecondition(plan, options);
	assertRequiredSources(plan, options);
	assertFrozenPrecondition(plan, options, openCodeReferences);
};

const assertInstallPrecondition = (plan: SyncPlan, options: SyncOptions) => {
	if (options.install) {
		assertInstallLock(plan);
	}
};

const assertRequiredSources = (plan: SyncPlan, options: SyncOptions) => {
	const requiredMissing = plan.results.filter((result) => {
		const source = plan.sources.find((entry) => entry.id === result.id);
		return result.status === "missing" && (source?.required ?? true);
	});
	if (options.failOnMiss && requiredMissing.length > 0) {
		throw new Error(
			`Missing required source(s): ${requiredMissing.map((result) => result.id).join(", ")}.`,
		);
	}
};

const assertFrozenPrecondition = (
	plan: SyncPlan,
	options: SyncOptions,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) => {
	if (options.frozen) {
		assertFrozenSync(plan, openCodeReferences);
	}
};

const syncCache = async (params: {
	plan: SyncPlan;
	options: SyncOptions;
	deps: SyncDeps;
	reporter: TaskReporter | null;
}) => {
	const { plan, options, deps, reporter } = params;
	if (options.lockOnly) {
		return 0;
	}
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
	return verifyAndRepairCache({
		plan,
		options,
		docsPresence,
		defaults,
		reporter,
		runJobs,
	});
};

const shouldApplyOpenCodeReferences = (options: SyncOptions) =>
	[
		options.lockOnly !== true,
		options.install !== true,
		options.frozen !== true,
	].every(Boolean);

const shouldPersistOpenCodeOwnership = (
	plan: SyncPlan,
	shouldApply: boolean,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) =>
	[
		shouldApply,
		plan.config.opencode !== undefined,
		plan.config.opencode !== false,
		openCodeReferences?.nextState !== undefined,
	].every(Boolean);

const applyOpenCodeReferences = async (
	shouldApply: boolean,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) => {
	if (shouldApply) {
		await openCodeReferences?.apply();
	}
};

const writeSyncState = async (params: {
	plan: SyncPlan;
	lock: DocsCacheLock;
	options: SyncOptions;
	shouldPersistOwnership: boolean;
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined;
}) => {
	const { plan, lock, options, shouldPersistOwnership, openCodeReferences } =
		params;
	await writeOpenCodeOwnershipIfNeeded(
		plan,
		shouldPersistOwnership,
		openCodeReferences,
	);
	if (!options.install) {
		await writeLock(plan.lockPath, lock);
	}
};

const writeOpenCodeOwnershipIfNeeded = async (
	plan: SyncPlan,
	shouldPersistOwnership: boolean,
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined,
) => {
	if (shouldPersistOwnership && openCodeReferences?.nextState) {
		await writeOpenCodeOwnership(plan.configPath, openCodeReferences.nextState);
	}
};

const collectRollbackFailure = async (
	rollback: () => Promise<void>,
	failures: unknown[],
) => {
	try {
		await rollback();
	} catch (error) {
		failures.push(error);
	}
};

const rollbackOpenCodeState = async (params: {
	plan: SyncPlan;
	shouldPersistOwnership: boolean;
	shouldApply: boolean;
	ownership: DocsCacheOpenCodeLock | undefined;
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined;
}) => {
	const failures: unknown[] = [];
	if (params.shouldPersistOwnership) {
		await collectRollbackFailure(
			() => restoreOpenCodeOwnership(params.plan.configPath, params.ownership),
			failures,
		);
	}
	if (params.shouldApply) {
		await collectRollbackFailure(
			async () => params.openCodeReferences?.rollback(),
			failures,
		);
	}
	return failures;
};

const persistSyncState = async (params: {
	plan: SyncPlan;
	lock: DocsCacheLock;
	options: SyncOptions;
	ownership: DocsCacheOpenCodeLock | undefined;
	openCodeReferences:
		| Awaited<ReturnType<typeof planOpenCodeReferences>>
		| undefined;
}) => {
	const { plan, lock, options, ownership, openCodeReferences } = params;
	const shouldApply = shouldApplyOpenCodeReferences(options);
	const shouldPersistOwnership = shouldPersistOpenCodeOwnership(
		plan,
		shouldApply,
		openCodeReferences,
	);
	await applyOpenCodeReferences(shouldApply, openCodeReferences);
	try {
		await writeSyncState({
			plan,
			lock,
			options,
			shouldPersistOwnership,
			openCodeReferences,
		});
	} catch (error) {
		const rollbackFailures = await rollbackOpenCodeState({
			plan,
			shouldPersistOwnership,
			shouldApply,
			ownership,
			openCodeReferences,
		});
		if (rollbackFailures.length > 0) {
			throw new AggregateError(
				[error, ...rollbackFailures],
				"Failed to persist OpenCode state and roll back cleanly.",
				{ cause: error },
			);
		}
		throw error;
	}
};

export const runSync = async (options: SyncOptions, deps: SyncDeps = {}) => {
	assertValidSyncOptions(options);
	const startTime = process.hrtime.bigint();
	const plan = await getSyncPlan(options, deps);
	const reporter = createSyncReporter(options);
	const previous = plan.lockData;
	const { ownership, references: openCodeReferences } = await planOpenCodeSync(
		plan,
		options,
	);
	assertSyncPreconditions(plan, options, openCodeReferences);
	await mkdir(plan.cacheDir, { recursive: true });
	const warningCount = await syncCache({ plan, options, deps, reporter });
	const opencode =
		options.lockOnly || options.install
			? undefined
			: openCodeReferences?.nextState;
	const lock = await buildFinalLock({
		plan,
		previous,
		options,
		opencode,
	});
	await persistSyncState({
		plan,
		lock,
		options,
		ownership,
		openCodeReferences,
	});
	return finalizeSync({
		plan,
		lock,
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
