import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { execa } from "execa";

import { getErrnoCode } from "#core/errors";
import { assertSafeSourceId } from "#core/source-id";
import { exists, resolveGitCacheDir } from "#git/cache-dir";
import { buildGitEnv } from "#git/git-env";

const DEFAULT_TIMEOUT_MS = 120000; // 120 seconds (2 minutes)
const DEFAULT_GIT_DEPTH = 1;
const DEFAULT_RM_RETRIES = 3;
const DEFAULT_RM_BACKOFF_MS = 100;
const MAX_BRACE_EXPANSIONS = 500;

const buildGitConfigs = (allowFileProtocol?: boolean) => [
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"submodule.recurse=false",
	"-c",
	"protocol.ext.allow=never",
	"-c",
	`protocol.file.allow=${allowFileProtocol ? "always" : "never"}`,
];

const buildCommandArgs = (
	args: string[],
	allowFileProtocol?: boolean,
	forceProgress?: boolean,
) => {
	const configs = buildGitConfigs(allowFileProtocol);
	const commandArgs = [...configs, ...args];
	if (forceProgress) {
		commandArgs.push("--progress");
	}
	return commandArgs;
};

const isProgressLine = (line: string) =>
	line.includes("Receiving objects") ||
	line.includes("Resolving deltas") ||
	line.includes("Compressing objects") ||
	line.includes("Updating files") ||
	line.includes("Counting objects");

const shouldEmitProgress = (
	line: string,
	now: number,
	lastProgressAt: number,
	throttleMs: number,
) =>
	now - lastProgressAt >= throttleMs ||
	line.includes("100%") ||
	line.includes("done");

const attachLoggers = (
	subprocess: ReturnType<typeof execa>,
	commandLabel: string,
	options?: {
		logger?: (message: string) => void;
		progressLogger?: (message: string) => void;
		progressThrottleMs?: number;
	},
) => {
	if (!options?.logger && !options?.progressLogger) {
		return;
	}
	let lastProgressAt = 0;
	const forward = (stream: NodeJS.ReadableStream | null) => {
		if (!stream) return;
		stream.on("data", (chunk) => {
			const text =
				chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);
			for (const line of text.split(/\r?\n/)) {
				if (!line) continue;
				options.logger?.(`${commandLabel} | ${line}`);
				if (!options?.progressLogger) continue;
				if (!isProgressLine(line)) continue;
				const now = Date.now();
				const throttleMs = options.progressThrottleMs ?? 120;
				if (shouldEmitProgress(line, now, lastProgressAt, throttleMs)) {
					lastProgressAt = now;
					options.progressLogger(line);
				}
			}
		});
	};
	forward(subprocess.stdout);
	forward(subprocess.stderr);
};

const git = async (
	args: string[],
	options?: {
		cwd?: string;
		timeoutMs?: number;
		allowFileProtocol?: boolean;
		logger?: (message: string) => void;
		progressLogger?: (message: string) => void;
		progressThrottleMs?: number;
		forceProgress?: boolean;
	},
) => {
	const commandArgs = buildCommandArgs(
		args,
		options?.allowFileProtocol,
		options?.forceProgress,
	);
	const commandLabel = `git ${commandArgs.join(" ")}`;
	options?.logger?.(commandLabel);
	const subprocess = execa("git", commandArgs, {
		cwd: options?.cwd,
		timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024,
		stdout: "pipe",
		stderr: "pipe",
		env: buildGitEnv(),
	});
	attachLoggers(subprocess, commandLabel, options);
	await subprocess;
};

const removeDir = async (dirPath: string, retries = DEFAULT_RM_RETRIES) => {
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			await rm(dirPath, { recursive: true, force: true });
			return;
		} catch (error) {
			const code = getErrnoCode(error);
			if (code !== "ENOTEMPTY" && code !== "EBUSY" && code !== "EPERM") {
				throw error;
			}
			if (attempt === retries) {
				throw error;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, DEFAULT_RM_BACKOFF_MS * (attempt + 1)),
			);
		}
	}
};

// Hash a repo URL to create a safe directory name
const hashRepoUrl = (repo: string): string => {
	return createHash("sha256").update(repo).digest("hex").substring(0, 16);
};

// Get the persistent cache path for a repository
const getPersistentCachePath = (repo: string): string => {
	const repoHash = hashRepoUrl(repo);
	return path.join(resolveGitCacheDir(), repoHash);
};

// Check if a git repo is valid
const isValidGitRepo = async (repoPath: string): Promise<boolean> => {
	try {
		await git(["rev-parse", "--git-dir"], { cwd: repoPath });
		return true;
	} catch {
		return false;
	}
};

const isPartialClone = async (repoPath: string) => {
	try {
		const configPath = path.join(repoPath, ".git", "config");
		const raw = await readFile(configPath, "utf8");
		const lower = raw.toLowerCase();
		return (
			lower.includes("partialclone") ||
			lower.includes("promisor") ||
			lower.includes("partialclonefilter")
		);
	} catch {
		return false;
	}
};

const hasCommitInRepo = async (
	repoPath: string,
	commit: string,
	options?: {
		timeoutMs?: number;
		allowFileProtocol?: boolean;
		logger?: (message: string) => void;
	},
): Promise<boolean> => {
	try {
		await git(["-C", repoPath, "cat-file", "-e", `${commit}^{commit}`], {
			timeoutMs: options?.timeoutMs,
			allowFileProtocol: options?.allowFileProtocol,
			logger: options?.logger,
		});
		return true;
	} catch {
		return false;
	}
};

const ensureCommitAvailable = async (
	repoPath: string,
	commit: string,
	options?: {
		timeoutMs?: number;
		allowFileProtocol?: boolean;
		logger?: (message: string) => void;
		offline?: boolean;
	},
) => {
	try {
		await git(["-C", repoPath, "cat-file", "-e", `${commit}^{commit}`], {
			timeoutMs: options?.timeoutMs,
			allowFileProtocol: options?.allowFileProtocol,
			logger: options?.logger,
		});
		return;
	} catch {
		// commit not present, fetch it
	}
	if (options?.offline && !options?.allowFileProtocol) {
		throw new Error(`Commit ${commit} not found in cache (offline).`);
	}
	await git(["-C", repoPath, "fetch", "origin", commit], {
		timeoutMs: options?.timeoutMs,
		allowFileProtocol: options?.allowFileProtocol,
		logger: options?.logger,
	});
};

type FetchParams = {
	sourceId: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	cacheDir: string;
	include?: string[];
	timeoutMs?: number;
	logger?: (message: string) => void;
	progressLogger?: (message: string) => void;
	offline?: boolean;
};

type FetchResult = {
	repoDir: string;
	cleanup: () => Promise<void>;
	fromCache: boolean;
};

type CloneResult = {
	usedCache: boolean;
	cleanup: () => Promise<void>;
};

const patternHasGlob = (pattern: string) =>
	pattern.includes("*") || pattern.includes("?") || pattern.includes("[");

const expandBracePattern = (pattern: string): string[] => {
	const results: string[] = [];
	const expand = (value: string) => {
		const braceMatch = value.match(/^(.*?){([^}]+)}(.*)$/);
		if (!braceMatch) {
			results.push(value);
			if (results.length > MAX_BRACE_EXPANSIONS) {
				throw new Error(
					`Brace expansion exceeded ${MAX_BRACE_EXPANSIONS} patterns for '${pattern}'.`,
				);
			}
			return;
		}
		const [, prefix, values, suffix] = braceMatch;
		const valueList = values
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		if (valueList.length === 0) {
			results.push(value);
			if (results.length > MAX_BRACE_EXPANSIONS) {
				throw new Error(
					`Brace expansion exceeded ${MAX_BRACE_EXPANSIONS} patterns for '${pattern}'.`,
				);
			}
			return;
		}
		for (const entry of valueList) {
			const expandedPattern = `${prefix}${entry}${suffix}`;
			expand(expandedPattern);
		}
	};

	expand(pattern);
	return results;
};

const normalizeSparsePatterns = (include?: string[]) => {
	const patterns = include ?? [];
	const expanded: string[] = [];
	for (const pattern of patterns) {
		const normalized = pattern.replace(/\\/g, "/");
		if (!normalized) continue;
		// Expand brace patterns for git sparse-checkout compatibility
		expanded.push(...expandBracePattern(normalized));
	}
	return expanded;
};

const isDirectoryLiteral = (pattern: string) => pattern.endsWith("/");

const toNoConePattern = (pattern: string) => {
	if (!patternHasGlob(pattern) && isDirectoryLiteral(pattern)) {
		return pattern.endsWith("/") ? pattern : `${pattern}/`;
	}
	return pattern;
};

type SparseSpec =
	| { enabled: false; mode: "cone"; patterns: string[] }
	| { enabled: true; mode: "cone" | "no-cone"; patterns: string[] };

const resolveSparseSpec = (include?: string[]): SparseSpec => {
	const normalized = normalizeSparsePatterns(include);
	if (normalized.length === 0) {
		return { enabled: false, mode: "cone", patterns: [] };
	}
	const conePaths: string[] = [];
	let coneEligible = true;
	for (const pattern of normalized) {
		if (pattern.includes("**")) {
			coneEligible = false;
			break;
		}
		if (patternHasGlob(pattern)) {
			coneEligible = false;
			break;
		}
		if (isDirectoryLiteral(pattern)) {
			conePaths.push(pattern.replace(/\/+$/, ""));
			continue;
		}
		coneEligible = false;
		break;
	}
	const uniquePaths = Array.from(new Set(conePaths.filter(Boolean)));
	if (coneEligible && uniquePaths.length > 0) {
		return { enabled: true, mode: "cone", patterns: uniquePaths };
	}
	return {
		enabled: true,
		mode: "no-cone",
		patterns: normalized.map(toNoConePattern),
	};
};

const cloneRepo = async (params: FetchParams, outDir: string) => {
	if (params.offline) {
		throw new Error(`Cannot clone ${params.repo} while offline.`);
	}
	const isCommitRef = /^[0-9a-f]{7,40}$/i.test(params.ref);
	const sparseSpec = resolveSparseSpec(params.include);
	const buildCloneArgs = () => {
		const cloneArgs = [
			"clone",
			"--no-checkout",
			"--depth",
			String(DEFAULT_GIT_DEPTH),
			"--recurse-submodules=no",
			"--no-tags",
		];
		return cloneArgs;
	};
	const cloneArgs = buildCloneArgs();
	if (sparseSpec.enabled) {
		cloneArgs.push("--sparse");
	}
	if (!isCommitRef) {
		cloneArgs.push("--single-branch");
		if (params.ref !== "HEAD") {
			cloneArgs.push("--branch", params.ref);
		}
	}
	cloneArgs.push(params.repo, outDir);
	await git(cloneArgs, {
		timeoutMs: params.timeoutMs,
		logger: params.logger,
		progressLogger: params.progressLogger,
		forceProgress: Boolean(params.progressLogger),
	});
	await ensureCommitAvailable(outDir, params.resolvedCommit, {
		timeoutMs: params.timeoutMs,
		logger: params.logger,
		offline: params.offline,
	});
	if (sparseSpec.enabled) {
		const sparseArgs = ["-C", outDir, "sparse-checkout", "set"];
		if (sparseSpec.mode === "no-cone") {
			sparseArgs.push("--no-cone");
		}
		sparseArgs.push(...sparseSpec.patterns);
		await git(sparseArgs, {
			timeoutMs: params.timeoutMs,
			logger: params.logger,
		});
	}
	await git(
		["-C", outDir, "checkout", "--quiet", "--detach", params.resolvedCommit],
		{
			timeoutMs: params.timeoutMs,
			logger: params.logger,
		},
	);
};

const addWorktreeFromCache = async (
	params: FetchParams,
	cachePath: string,
	outDir: string,
): Promise<CloneResult> => {
	await git(
		[
			"-C",
			cachePath,
			"worktree",
			"add",
			"--detach",
			outDir,
			params.resolvedCommit,
		],
		{
			timeoutMs: params.timeoutMs,
			logger: params.logger,
			allowFileProtocol: true,
		},
	);
	await git(
		["-C", outDir, "checkout", "--quiet", "--detach", params.resolvedCommit],
		{
			timeoutMs: params.timeoutMs,
			logger: params.logger,
			allowFileProtocol: true,
		},
	);
	const sparseSpec = resolveSparseSpec(params.include);
	if (sparseSpec.enabled) {
		const sparseArgs = ["-C", outDir, "sparse-checkout", "set"];
		if (sparseSpec.mode === "no-cone") {
			sparseArgs.push("--no-cone");
		}
		sparseArgs.push(...sparseSpec.patterns);
		await git(sparseArgs, {
			timeoutMs: params.timeoutMs,
			logger: params.logger,
			allowFileProtocol: true,
		});
	}
	return {
		usedCache: true,
		cleanup: async () => {
			try {
				await git(["-C", cachePath, "worktree", "remove", "--force", outDir], {
					timeoutMs: params.timeoutMs,
					logger: params.logger,
					allowFileProtocol: true,
				});
			} catch {
				// fall back to removing the directory directly
			}
		},
	};
};

const buildFetchArgs = (ref: string, isCommitRef: boolean) => {
	const fetchArgs = ["fetch", "origin"];
	if (!isCommitRef) {
		const refSpec =
			ref === "HEAD" ? "HEAD" : `${ref}:refs/remotes/origin/${ref}`;
		fetchArgs.push(refSpec, "--depth", String(DEFAULT_GIT_DEPTH));
		return fetchArgs;
	}
	fetchArgs.push("--depth", String(DEFAULT_GIT_DEPTH));
	return fetchArgs;
};

const fetchCommitFromOrigin = async (
	params: FetchParams,
	cachePath: string,
	isCommitRef: boolean,
) => {
	const fetchArgs = buildFetchArgs(params.ref, isCommitRef);
	await git(["-C", cachePath, ...fetchArgs], {
		timeoutMs: params.timeoutMs,
		logger: params.logger,
		progressLogger: params.progressLogger,
		forceProgress: Boolean(params.progressLogger),
		allowFileProtocol: true,
	});
	await ensureCommitAvailable(cachePath, params.resolvedCommit, {
		timeoutMs: params.timeoutMs,
		logger: params.logger,
		offline: params.offline,
	});
};

const handleValidCache = async (
	params: FetchParams,
	cachePath: string,
	isCommitRef: boolean,
): Promise<{ usedCache: boolean; worktreeUsed: boolean }> => {
	if (await isPartialClone(cachePath)) {
		if (params.offline) {
			throw new Error(`Cache for ${params.repo} is partial (offline).`);
		}
		await removeDir(cachePath);
		await cloneRepo(params, cachePath);
		return { usedCache: false, worktreeUsed: false };
	}
	try {
		const commitExists = await hasCommitInRepo(
			cachePath,
			params.resolvedCommit,
			{
				timeoutMs: params.timeoutMs,
				logger: params.logger,
			},
		);
		if (commitExists) {
			return { usedCache: true, worktreeUsed: true };
		}
		if (params.offline) {
			throw new Error(
				`Commit ${params.resolvedCommit} not found in cache (offline).`,
			);
		}
		await fetchCommitFromOrigin(params, cachePath, isCommitRef);
		return { usedCache: true, worktreeUsed: false };
	} catch (_error) {
		if (params.offline) {
			throw new Error(`Cache for ${params.repo} is unavailable (offline).`);
		}
		await removeDir(cachePath);
		await cloneRepo(params, cachePath);
		return { usedCache: false, worktreeUsed: false };
	}
};

const handleMissingCache = async (
	params: FetchParams,
	cachePath: string,
	cacheExists: boolean,
): Promise<{ usedCache: boolean; worktreeUsed: boolean }> => {
	if (cacheExists) {
		await removeDir(cachePath);
	}
	if (params.offline) {
		throw new Error(`Cache for ${params.repo} is missing (offline).`);
	}
	await cloneRepo(params, cachePath);
	return { usedCache: false, worktreeUsed: false };
};

// Clone or update a repository using persistent cache
const cloneOrUpdateRepo = async (
	params: FetchParams,
	outDir: string,
): Promise<CloneResult> => {
	const cachePath = getPersistentCachePath(params.repo);
	const cacheExists = await exists(cachePath);
	const cacheValid = cacheExists && (await isValidGitRepo(cachePath));
	const isCommitRef = /^[0-9a-f]{7,40}$/i.test(params.ref);
	const sparseSpec = resolveSparseSpec(params.include);
	let usedCache = cacheValid;
	let worktreeUsed = false;

	const cacheRoot = resolveGitCacheDir();
	await mkdir(cacheRoot, { recursive: true });

	if (cacheValid) {
		const result = await handleValidCache(params, cachePath, isCommitRef);
		usedCache = result.usedCache;
		worktreeUsed = result.worktreeUsed;
	}
	if (!cacheValid) {
		const result = await handleMissingCache(params, cachePath, cacheExists);
		usedCache = result.usedCache;
		worktreeUsed = result.worktreeUsed;
	}

	if (worktreeUsed && cacheValid) {
		return addWorktreeFromCache(params, cachePath, outDir);
	}

	await mkdir(outDir, { recursive: true });

	const localCloneArgs = [
		"clone",
		"--no-checkout",
		"--depth",
		String(DEFAULT_GIT_DEPTH),
		"--recurse-submodules=no",
		"--no-tags",
	];
	if (await isPartialClone(cachePath)) {
		localCloneArgs.splice(2, 0, "--filter=blob:none");
	}

	if (sparseSpec.enabled) {
		localCloneArgs.push("--sparse");
	}

	if (!isCommitRef) {
		localCloneArgs.push("--single-branch");
		if (params.ref !== "HEAD") {
			localCloneArgs.push("--branch", params.ref);
		}
	}

	const cacheUrl = pathToFileURL(cachePath).href;
	localCloneArgs.push(cacheUrl, outDir);
	await git(localCloneArgs, {
		timeoutMs: params.timeoutMs,
		allowFileProtocol: true,
		logger: params.logger,
		progressLogger: params.progressLogger,
		forceProgress: Boolean(params.progressLogger),
	});

	if (sparseSpec.enabled) {
		const sparseArgs = ["-C", outDir, "sparse-checkout", "set"];
		if (sparseSpec.mode === "no-cone") {
			sparseArgs.push("--no-cone");
		}
		sparseArgs.push(...sparseSpec.patterns);
		await git(sparseArgs, {
			timeoutMs: params.timeoutMs,
			allowFileProtocol: true,
			logger: params.logger,
		});
	}

	await ensureCommitAvailable(outDir, params.resolvedCommit, {
		timeoutMs: params.timeoutMs,
		allowFileProtocol: true,
		logger: params.logger,
		offline: params.offline,
	});

	await git(
		["-C", outDir, "checkout", "--quiet", "--detach", params.resolvedCommit],
		{
			timeoutMs: params.timeoutMs,
			allowFileProtocol: true,
			logger: params.logger,
		},
	);

	return { usedCache, cleanup: async () => undefined };
};

export const fetchSource = async (
	params: FetchParams,
): Promise<FetchResult> => {
	assertSafeSourceId(params.sourceId, "sourceId");
	const tempRoot = await mkdtemp(
		path.join(tmpdir(), `docs-cache-${params.sourceId}-`),
	);
	const tempDir = path.join(tempRoot, "repo");
	try {
		const { usedCache, cleanup } = await cloneOrUpdateRepo(params, tempDir);
		return {
			repoDir: tempDir,
			cleanup: async () => {
				await cleanup();
				await removeDir(tempRoot);
			},
			fromCache: usedCache,
		};
	} catch (error) {
		await removeDir(tempRoot);
		throw error;
	}
};
