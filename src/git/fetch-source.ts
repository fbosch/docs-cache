import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { assertSafeSourceId } from "../source-id";
import { exists, resolveGitCacheDir } from "./cache-dir";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120000; // 120 seconds (2 minutes)

const git = async (
	args: string[],
	options?: { cwd?: string; timeoutMs?: number; allowFileProtocol?: boolean },
) => {
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

	await execFileAsync("git", [...configs, ...args], {
		cwd: options?.cwd,
		timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
		env: {
			PATH: process.env.PATH,
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

type FetchParams = {
	sourceId: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	cacheDir: string;
	depth: number;
	include?: string[];
	timeoutMs?: number;
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
	const cloneArgs = [
		"clone",
		"--no-checkout",
		"--filter=blob:none",
		"--depth",
		String(params.depth),
		"--recurse-submodules=no",
		"--no-tags",
	];
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
		try {
			// Fetch the specific ref or commit
			const fetchArgs = ["fetch", "origin"];
			if (!isCommitRef) {
				// Fetch specific branch/tag
				const refSpec =
					params.ref === "HEAD"
						? "HEAD"
						: `${params.ref}:refs/remotes/origin/${params.ref}`;
				fetchArgs.push(refSpec, "--depth", String(params.depth));
			} else {
				// For commit refs, fetch the default branch and hope the commit is there
				fetchArgs.push("--depth", String(params.depth));
			}

			await git(["-C", cachePath, ...fetchArgs], {
				timeoutMs: params.timeoutMs,
			});
		} catch (error) {
			// Fetch failed, remove corrupt cache and re-clone
			await rm(cachePath, { recursive: true, force: true });
			await cloneRepo(params, cachePath);
		}
	} else {
		// No cache or invalid - do fresh clone
		if (cacheExists) {
			await rm(cachePath, { recursive: true, force: true });
		}
		await cloneRepo(params, cachePath);
	}

	// Now copy from cache to outDir with the specific commit checked out
	await mkdir(outDir, { recursive: true });

	// Clone from local cache (much faster than from remote)
	const localCloneArgs = [
		"clone",
		"--no-checkout",
		"--filter=blob:none",
		"--depth",
		String(params.depth),
		"--recurse-submodules=no",
		"--no-tags",
	];

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
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}
};

export const fetchSource = async (params: FetchParams) => {
	assertSafeSourceId(params.sourceId, "sourceId");
	try {
		const archiveDir = await archiveRepo(params);
		return {
			repoDir: archiveDir,
			cleanup: async () => {
				await rm(archiveDir, { recursive: true, force: true });
			},
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
					await rm(tempDir, { recursive: true, force: true });
				},
			};
		} catch (error) {
			await rm(tempDir, { recursive: true, force: true });
			throw error;
		}
	}
};
