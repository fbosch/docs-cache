import { access, readFile } from "node:fs/promises";

import {
	DEFAULT_CONFIG,
	resolveConfigPath,
	validateConfig,
	writeConfig,
} from "./config";

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const resolveRepoInput = (repo: string) => {
	const trimmed = repo.trim();
	const shortcutMatch = trimmed.match(/^(github|gitlab):(.+)$/i);
	if (shortcutMatch) {
		const provider = shortcutMatch[1].toLowerCase();
		const rawPath = shortcutMatch[2];
		const [pathPart, rawRef] = rawPath.split("#", 2);
		const sanitizedPath = pathPart.replace(/^\//, "");
		const inferredId = sanitizedPath
			.split("/")
			.filter(Boolean)
			.pop()
			?.replace(/\.git$/i, "");
		const host = provider === "gitlab" ? "gitlab.com" : "github.com";
		const suffix = sanitizedPath.endsWith(".git") ? "" : ".git";
		const repoUrl = `https://${host}/${sanitizedPath}${suffix}`;
		const ref = rawRef?.trim() || undefined;
		return { repoUrl, ref, inferredId };
	}

	const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
	if (sshMatch) {
		const host = sshMatch[1];
		const rawPath = sshMatch[2];
		const [pathPart, rawRef] = rawPath.split("#", 2);
		const sanitizedPath = pathPart.replace(/^\//, "");
		const inferredId = sanitizedPath
			.split("/")
			.filter(Boolean)
			.pop()
			?.replace(/\.git$/i, "");
		const repoUrl = `git@${host}:${sanitizedPath}`;
		const ref = rawRef?.trim() || undefined;
		return { repoUrl, ref, inferredId };
	}

	return { repoUrl: trimmed, ref: undefined, inferredId: undefined };
};

export const addSource = async (params: {
	configPath?: string;
	id: string;
	repo: string;
}) => {
	const resolvedPath = resolveConfigPath(params.configPath);
	let config = DEFAULT_CONFIG;
	if (await exists(resolvedPath)) {
		const raw = await readFile(resolvedPath, "utf8");
		config = validateConfig(JSON.parse(raw.toString()));
	}

	const resolved = resolveRepoInput(params.repo);
	const sourceId = params.id || resolved.inferredId;
	if (!sourceId) {
		throw new Error("Unable to infer id. Provide an explicit id.");
	}

	if (config.sources.some((source) => source.id === sourceId)) {
		throw new Error(`Source '${sourceId}' already exists in config.`);
	}

	config.sources = [
		...config.sources,
		{
			id: sourceId,
			repo: resolved.repoUrl,
			...(resolved.ref ? { ref: resolved.ref } : {}),
		},
	];

	await writeConfig(resolvedPath, config);

	return {
		configPath: resolvedPath,
		sourceId: sourceId,
		sourceRepo: resolved.repoUrl,
		created: true,
		ref: resolved.ref,
	};
};
