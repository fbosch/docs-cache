import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { assertSafeSourceId } from "../source-id";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

const git = async (
	args: string[],
	options?: { cwd?: string; timeoutMs?: number },
) => {
	await execFileAsync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"submodule.recurse=false",
			"-c",
			"protocol.file.allow=never",
			"-c",
			"protocol.ext.allow=never",
			...args,
		],
		{
			cwd: options?.cwd,
			timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
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
		},
	);
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
	await git(["-C", outDir, "checkout", "--detach", params.resolvedCommit], {
		timeoutMs: params.timeoutMs,
	});
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
			await cloneRepo(params, tempDir);
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
