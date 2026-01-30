import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
			...args,
		],
		{
			cwd: options?.cwd,
			timeout: options?.timeoutMs,
			maxBuffer: 1024 * 1024,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
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
		timeout: timeoutMs,
		maxBuffer: 1024 * 1024,
	});
	await rm(archivePath, { force: true });
};

const cloneRepo = async (params: FetchParams, outDir: string) => {
	await git(
		[
			"clone",
			"--no-checkout",
			"--filter=blob:none",
			"--depth",
			String(params.depth),
			"--recurse-submodules=no",
			params.repo,
			outDir,
		],
		{ timeoutMs: params.timeoutMs },
	);
	await git(["-C", outDir, "checkout", "--detach", params.resolvedCommit], {
		timeoutMs: params.timeoutMs,
	});
};

const archiveRepo = async (params: FetchParams) => {
	const tmpRoot = path.join(params.cacheDir, "tmp");
	await mkdir(tmpRoot, { recursive: true });
	const tempDir = await mkdtemp(path.join(tmpRoot, `${params.sourceId}-`));
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
	try {
		const archiveDir = await archiveRepo(params);
		return {
			repoDir: archiveDir,
			cleanup: async () => {
				await rm(archiveDir, { recursive: true, force: true });
			},
		};
	} catch {
		const tmpRoot = path.join(params.cacheDir, "tmp");
		await mkdir(tmpRoot, { recursive: true });
		const tempDir = await mkdtemp(path.join(tmpRoot, `${params.sourceId}-`));
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
