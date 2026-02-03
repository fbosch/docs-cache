import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { execa } from "execa";

import { getErrnoCode } from "../errors";
import { assertSafeSourceId } from "../source-id";
import { exists, resolveGitCacheDir } from "./cache-dir";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120000; // 120 seconds (2 minutes)
const DEFAULT_GIT_DEPTH = 1;
const DEFAULT_RM_RETRIES = 3;
const DEFAULT_RM_BACKOFF_MS = 100;

const git = async (
	args: string[],
	options?: { cwd?: string; timeoutMs?: number; allowFileProtocol?: boolean },
) => {
	const pathValue = process.env.PATH ?? process.env.Path;
	const pathExtValue =
		process.env.PATHEXT ??
		(process.platform === "win32" ? ".COM;.EXE;.BAT;.CMD" : undefined);

	const configs = [
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"submodule.recurse=false",
		"-c",
		"protocol.ext.allow=never",
	];

	// Configure file protocol access
	if (options?.allowFileProtocol) {
		// Explicitly allow file protocol for local cache clones
		configs.push("-c", "protocol.file.allow=always");
	} else {
		// Disallow file protocol by default (when false or undefined)
		configs.push("-c", "protocol.file.allow=never");
	}

	await execa("git", [...configs, ...args], {
		cwd: options?.cwd,
		timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
		env: {
			...process.env,
			...(pathValue ? { PATH: pathValue, Path: pathValue } : {}),
			...(pathExtValue ? { PATHEXT: pathExtValue } : {}),
			HOME: process.env.HOME,
			USER: process.env.USER,
			USERPROFILE: process.env.USERPROFILE,
			TMPDIR: process.env.TMPDIR,
			TMP: process.env.TMP,
			TEMP: process.env.TEMP,
			SYSTEMROOT: process.env.SYSTEMROOT,
			WINDIR: process.env.WINDIR,
			SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
			SSH_AGENT_PID: process.env.SSH_AGENT_PID,
			HTTP_PROXY: process.env.HTTP_PROXY,
			HTTPS_PROXY: process.env.HTTPS_PROXY,
			NO_PROXY: process.env.NO_PROXY,
			GIT_TERMINAL_PROMPT: "0",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_NOGLOBAL: "1",
			...(process.platform === "win32" ? {} : { GIT_ASKPASS: "/bin/false" }),
		},
	});
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

const ensureCommitAvailable = async (
	repoPath: string,
	commit: string,
	options?: { timeoutMs?: number; allowFileProtocol?: boolean },
) => {
	try {
		await git(["-C", repoPath, "cat-file", "-e", `${commit}^{commit}`], {
			timeoutMs: options?.timeoutMs,
			allowFileProtocol: options?.allowFileProtocol,
		});
		return;
	} catch {
		// commit not present, fetch it
	}
	await git(["-C", repoPath, "fetch", "origin", commit], {
		timeoutMs: options?.timeoutMs,
		allowFileProtocol: options?.allowFileProtocol,
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
};

type FetchResult = {
	repoDir: string;
	cleanup: () => Promise<void>;
	fromCache: boolean;
};

const runGitArchive = async (
	repo: string,
	resolvedCommit: string,
	outDir: string,
	timeoutMs?: number,
) => {
	const archivePath = path.join(outDir, "archive.tar");
	await git(
		[
			"archive",
			"--remote",
			repo,
			"--format=tar",
			"--output",
			archivePath,
			resolvedCommit,
		],
		{ timeoutMs },
	);
	await execFileAsync("tar", ["-xf", archivePath, "-C", outDir], {
		timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBuffer: 1024 * 1024,
	});
	await rm(archivePath, { force: true });
};

const isSparseEligible = (include?: string[]) => {
	if (!include || include.length === 0) {
		return false;
	}
	for (const pattern of include) {
		if (!pattern || pattern.includes("**")) {
			return false;
		}
	}
	return true;
};

const extractSparsePaths = (include?: string[]) => {
	if (!include) {
		return [];
	}
	const paths = include.map((pattern) => {
		const normalized = pattern.replace(/\\/g, "/");
		const starIndex = normalized.indexOf("*");
		const base = starIndex === -1 ? normalized : normalized.slice(0, starIndex);
		return base.replace(/\/+$|\/$/, "");
	});
	return Array.from(new Set(paths.filter((value) => value.length > 0)));
};

const cloneRepo = async (params: FetchParams, outDir: string) => {
	const isCommitRef = /^[0-9a-f]{7,40}$/i.test(params.ref);
	const useSparse = isSparseEligible(params.include);
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
	if (useSparse) {
		cloneArgs.push("--sparse");
	}
	if (!isCommitRef) {
		cloneArgs.push("--single-branch");
		if (params.ref !== "HEAD") {
			cloneArgs.push("--branch", params.ref);
		}
	}
	cloneArgs.push(params.repo, outDir);
	await git(cloneArgs, { timeoutMs: params.timeoutMs });
	await ensureCommitAvailable(outDir, params.resolvedCommit, {
		timeoutMs: params.timeoutMs,
	});
	if (useSparse) {
		const sparsePaths = extractSparsePaths(params.include);
		if (sparsePaths.length > 0) {
			await git(["-C", outDir, "sparse-checkout", "set", ...sparsePaths], {
				timeoutMs: params.timeoutMs,
			});
		}
	}
	await git(
		["-C", outDir, "checkout", "--quiet", "--detach", params.resolvedCommit],
		{
			timeoutMs: params.timeoutMs,
		},
	);
};

// Clone or update a repository using persistent cache
const cloneOrUpdateRepo = async (params: FetchParams, outDir: string) => {
	const cachePath = getPersistentCachePath(params.repo);
	const cacheExists = await exists(cachePath);
	const isCommitRef = /^[0-9a-f]{7,40}$/i.test(params.ref);
	const useSparse = isSparseEligible(params.include);

	const cacheRoot = resolveGitCacheDir();
	// Ensure the git cache directory exists
	await mkdir(cacheRoot, { recursive: true });

	// If cache exists and is valid, try to fetch and update
	if (cacheExists && (await isValidGitRepo(cachePath))) {
		if (await isPartialClone(cachePath)) {
			await removeDir(cachePath);
			await cloneRepo(params, cachePath);
		} else {
			try {
				// Fetch the specific ref or commit
				const fetchArgs = ["fetch", "origin"];
				if (!isCommitRef) {
					// Fetch specific branch/tag
					const refSpec =
						params.ref === "HEAD"
							? "HEAD"
							: `${params.ref}:refs/remotes/origin/${params.ref}`;
					fetchArgs.push(refSpec, "--depth", String(DEFAULT_GIT_DEPTH));
				} else {
					// For commit refs, fetch the default branch and hope the commit is there
					fetchArgs.push("--depth", String(DEFAULT_GIT_DEPTH));
				}

				await git(["-C", cachePath, ...fetchArgs], {
					timeoutMs: params.timeoutMs,
				});
				await ensureCommitAvailable(cachePath, params.resolvedCommit, {
					timeoutMs: params.timeoutMs,
				});
			} catch (_error) {
				// Fetch failed, remove corrupt cache and re-clone
				await removeDir(cachePath);
				await cloneRepo(params, cachePath);
			}
		}
	} else {
		// No cache or invalid - do fresh clone
		if (cacheExists) {
			await removeDir(cachePath);
		}
		await cloneRepo(params, cachePath);
	}

	// Now copy from cache to outDir with the specific commit checked out
	await mkdir(outDir, { recursive: true });

	// Clone from local cache (much faster than from remote)
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

	if (useSparse) {
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
	});

	if (useSparse) {
		const sparsePaths = extractSparsePaths(params.include);
		if (sparsePaths.length > 0) {
			await git(["-C", outDir, "sparse-checkout", "set", ...sparsePaths], {
				timeoutMs: params.timeoutMs,
				allowFileProtocol: true,
			});
		}
	}

	await ensureCommitAvailable(outDir, params.resolvedCommit, {
		timeoutMs: params.timeoutMs,
		allowFileProtocol: true,
	});

	await git(
		["-C", outDir, "checkout", "--quiet", "--detach", params.resolvedCommit],
		{
			timeoutMs: params.timeoutMs,
			allowFileProtocol: true,
		},
	);
};

const archiveRepo = async (params: FetchParams) => {
	const tempDir = await mkdtemp(
		path.join(tmpdir(), `docs-cache-${params.sourceId}-`),
	);
	try {
		await runGitArchive(
			params.repo,
			params.resolvedCommit,
			tempDir,
			params.timeoutMs,
		);
		return tempDir;
	} catch (error) {
		await removeDir(tempDir);
		throw error;
	}
};

export const fetchSource = async (
	params: FetchParams,
): Promise<FetchResult> => {
	assertSafeSourceId(params.sourceId, "sourceId");
	try {
		const archiveDir = await archiveRepo(params);
		return {
			repoDir: archiveDir,
			cleanup: async () => {
				await removeDir(archiveDir);
			},
			fromCache: false,
		};
	} catch {
		const tempDir = await mkdtemp(
			path.join(tmpdir(), `docs-cache-${params.sourceId}-`),
		);
		try {
			await cloneOrUpdateRepo(params, tempDir);
			return {
				repoDir: tempDir,
				cleanup: async () => {
					await removeDir(tempDir);
				},
				fromCache: true,
			};
		} catch (error) {
			await removeDir(tempDir);
			throw error;
		}
	}
};
