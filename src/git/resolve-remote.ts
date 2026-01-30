import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { redactRepoUrl } from "./redact";

const execFileAsync = promisify(execFile);

type ResolveRemoteParams = {
	repo: string;
	ref: string;
	allowHosts: string[];
	timeoutMs?: number;
};

const parseRepoHost = (repo: string) => {
	if (repo.startsWith("git@")) {
		const atIndex = repo.indexOf("@");
		const colonIndex = repo.indexOf(":", atIndex + 1);
		if (colonIndex === -1) {
			return null;
		}
		const host = repo.slice(atIndex + 1, colonIndex);
		return host || null;
	}

	try {
		const url = new URL(repo);
		if (url.protocol !== "https:" && url.protocol !== "ssh:") {
			return null;
		}
		return url.hostname || null;
	} catch {
		return null;
	}
};

const enforceHostAllowlist = (repo: string, allowHosts: string[]) => {
	const host = parseRepoHost(repo);
	if (!host) {
		throw new Error(
			`Unsupported repo URL '${redactRepoUrl(repo)}'. Use HTTPS or SSH.`,
		);
	}
	const normalizedHost = host.toLowerCase();
	const allowed = allowHosts.map((entry) => entry.toLowerCase());
	if (!allowed.includes(normalizedHost)) {
		throw new Error(
			`Host '${host}' is not in allowHosts for '${redactRepoUrl(repo)}'.`,
		);
	}
};

const parseLsRemote = (stdout: string) => {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length === 0) {
		return null;
	}
	const first = lines[0].split(/\s+/)[0];
	return first || null;
};

export const resolveRemoteCommit = async (params: ResolveRemoteParams) => {
	enforceHostAllowlist(params.repo, params.allowHosts);

	const { stdout } = await execFileAsync(
		"git",
		["ls-remote", params.repo, params.ref],
		{
			timeout: params.timeoutMs,
			maxBuffer: 1024 * 1024,
		},
	);

	const resolvedCommit = parseLsRemote(stdout);
	if (!resolvedCommit) {
		throw new Error(
			`Unable to resolve ref '${params.ref}' for ${redactRepoUrl(params.repo)}.`,
		);
	}

	return {
		repo: params.repo,
		ref: params.ref,
		resolvedCommit,
	};
};
