import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { redactRepoUrl } from "./redact";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

type ResolveRemoteParams = {
	repo: string;
	ref: string;
	allowHosts: string[];
	timeoutMs?: number;
};

const BLOCKED_PROTOCOLS = new Set(["file:", "ftp:", "data:", "javascript:"]);

const assertAllowedProtocol = (repo: string) => {
	try {
		const url = new URL(repo);
		if (BLOCKED_PROTOCOLS.has(url.protocol)) {
			throw new Error(
				`Blocked protocol '${url.protocol}' in repo URL '${redactRepoUrl(repo)}'.`,
			);
		}
	} catch (error) {
		if (error instanceof TypeError) {
			return;
		}
		throw error;
	}
};

const parseRepoHost = (repo: string) => {
	assertAllowedProtocol(repo);
	const scpMatch = repo.match(/^[^@]+@([^:]+):/);
	if (scpMatch) {
		return scpMatch[1] || null;
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

export const enforceHostAllowlist = (repo: string, allowHosts: string[]) => {
	const host = parseRepoHost(repo);
	if (!host) {
		throw new Error(
			`Unsupported repo URL '${redactRepoUrl(repo)}'. Use HTTPS or SSH.`,
		);
	}
	const normalizedHost = host.toLowerCase();
	const allowed = allowHosts.map((entry) => entry.toLowerCase());
	const isAllowed = allowed.some(
		(entry) => normalizedHost === entry || normalizedHost.endsWith(`.${entry}`),
	);
	if (!isAllowed) {
		throw new Error(
			`Host '${host}' is not in allowHosts for '${redactRepoUrl(repo)}'.`,
		);
	}
};

export const parseLsRemote = (stdout: string) => {
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
			timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
