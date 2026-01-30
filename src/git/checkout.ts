import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getCacheLayout } from "../paths";

const execFileAsync = promisify(execFile);

type CheckoutParams = {
	sourceId: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	cacheDir: string;
	depth: number;
	timeoutMs?: number;
};

const pathExists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

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
		},
	);
};

export const checkoutRepo = async (params: CheckoutParams) => {
	const layout = getCacheLayout(params.cacheDir, params.sourceId);
	await mkdir(layout.reposDir, { recursive: true });
	const repoDir = path.join(layout.reposDir, params.sourceId);

	const exists = await pathExists(repoDir);
	if (!exists) {
		await git(
			[
				"clone",
				"--no-checkout",
				"--filter=blob:none",
				"--depth",
				String(params.depth),
				"--recurse-submodules=no",
				params.repo,
				repoDir,
			],
			{ timeoutMs: params.timeoutMs },
		);
	} else {
		await git(
			[
				"-C",
				repoDir,
				"fetch",
				"--filter=blob:none",
				"--depth",
				String(params.depth),
				"--recurse-submodules=no",
				"origin",
				params.ref,
			],
			{ timeoutMs: params.timeoutMs },
		);
	}

	await git(["-C", repoDir, "checkout", "--detach", params.resolvedCommit], {
		timeoutMs: params.timeoutMs,
	});

	return repoDir;
};
