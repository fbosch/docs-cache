import { access, readFile } from "node:fs/promises";

import {
	DEFAULT_CONFIG,
	type DocsCacheConfig,
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
	const plainMatch = trimmed.match(/^([^\s/:]+)\/([^\s#]+)(?:#(.+))?$/);
	if (plainMatch) {
		const [, owner, name, rawRef] = plainMatch;
		const sanitizedPath = `${owner}/${name}`.replace(/\.git$/i, "");
		const repoUrl = `https://github.com/${sanitizedPath}.git`;
		return {
			repoUrl,
			ref: rawRef?.trim() || undefined,
			inferredId: name.replace(/\.git$/i, ""),
		};
	}
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

	try {
		const url = new URL(trimmed);
		if (url.protocol === "https:" || url.protocol === "ssh:") {
			const parts = url.pathname.split("/").filter(Boolean);
			const inferredId = parts.pop()?.replace(/\.git$/i, "");
			return {
				repoUrl: trimmed,
				ref: undefined,
				inferredId,
			};
		}
	} catch {
		// ignore URL parse errors
	}

	return { repoUrl: trimmed, ref: undefined, inferredId: undefined };
};

export const addSources = async (params: {
	configPath?: string;
	entries: Array<{ id?: string; repo: string }>;
	targetDir?: string;
}) => {
	const resolvedPath = resolveConfigPath(params.configPath);
	let config = DEFAULT_CONFIG;
	let rawConfig: DocsCacheConfig | null = null;
	if (await exists(resolvedPath)) {
		const raw = await readFile(resolvedPath, "utf8");
		rawConfig = JSON.parse(raw.toString());
		config = validateConfig(rawConfig);
	}

	const schema =
		"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json";
	const existingIds = new Set(config.sources.map((source) => source.id));
	const newSources = params.entries.map((entry) => {
		const resolved = resolveRepoInput(entry.repo);
		const sourceId = entry.id || resolved.inferredId;
		if (!sourceId) {
			throw new Error("Unable to infer id. Provide an explicit id.");
		}
		if (existingIds.has(sourceId)) {
			throw new Error(`Source '${sourceId}' already exists in config.`);
		}
		existingIds.add(sourceId);
		return {
			id: sourceId,
			repo: resolved.repoUrl,
			...(params.targetDir ? { targetDir: params.targetDir } : {}),
			...(resolved.ref ? { ref: resolved.ref } : {}),
		};
	});
	const nextConfig: DocsCacheConfig = {
		$schema: schema,
		sources: [...config.sources, ...newSources],
	};
	if (rawConfig?.cacheDir) {
		nextConfig.cacheDir = rawConfig.cacheDir;
	}
	if (rawConfig?.defaults) {
		nextConfig.defaults = rawConfig.defaults;
	}

	await writeConfig(resolvedPath, nextConfig);

	return {
		configPath: resolvedPath,
		sources: newSources,
		created: true,
	};
};
