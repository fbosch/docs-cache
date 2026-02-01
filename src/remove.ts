import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_CONFIG,
	type DocsCacheConfig,
	resolveConfigPath,
	stripDefaultConfigValues,
	validateConfig,
	writeConfig,
} from "./config";
import { resolveTargetDir } from "./paths";
import { resolveRepoInput } from "./resolve-repo";

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const PACKAGE_JSON = "package.json";

const loadPackageConfig = async (configPath: string) => {
	const raw = await readFile(configPath, "utf8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const config = parsed["docs-cache"];
	if (!config) {
		return { parsed, config: null };
	}
	return {
		parsed,
		config: validateConfig(config),
	};
};

const resolveConfigTarget = async (configPath?: string) => {
	if (configPath) {
		const resolvedPath = resolveConfigPath(configPath);
		return {
			resolvedPath,
			mode: path.basename(resolvedPath) === PACKAGE_JSON ? "package" : "config",
		};
	}
	const defaultPath = resolveConfigPath();
	if (await exists(defaultPath)) {
		return { resolvedPath: defaultPath, mode: "config" };
	}
	const packagePath = path.resolve(process.cwd(), PACKAGE_JSON);
	if (await exists(packagePath)) {
		const pkg = await loadPackageConfig(packagePath);
		if (pkg.config) {
			return { resolvedPath: packagePath, mode: "package" };
		}
	}
	return { resolvedPath: defaultPath, mode: "config" };
};

export const removeSources = async (params: {
	configPath?: string;
	ids: string[];
}) => {
	if (params.ids.length === 0) {
		throw new Error("No sources specified to remove.");
	}
	const target = await resolveConfigTarget(params.configPath);
	const resolvedPath = target.resolvedPath;
	let config = DEFAULT_CONFIG;
	let rawConfig: DocsCacheConfig | null = null;
	let rawPackage: Record<string, unknown> | null = null;
	if (await exists(resolvedPath)) {
		if (target.mode === "package") {
			const pkg = await loadPackageConfig(resolvedPath);
			rawPackage = pkg.parsed;
			rawConfig = pkg.config;
			if (!rawConfig) {
				throw new Error(`Missing docs-cache config in ${resolvedPath}.`);
			}
			config = rawConfig;
		} else {
			const raw = await readFile(resolvedPath, "utf8");
			rawConfig = JSON.parse(raw.toString());
			config = validateConfig(rawConfig);
		}
	} else {
		throw new Error(`Config not found at ${resolvedPath}.`);
	}

	const sourcesById = new Map(
		config.sources.map((source) => [source.id, source]),
	);
	const sourcesByRepo = new Map(
		config.sources.map((source) => [source.repo, source]),
	);
	const idsToRemove = new Set<string>();
	const missing: string[] = [];
	for (const token of params.ids) {
		if (sourcesById.has(token)) {
			idsToRemove.add(token);
			continue;
		}
		const resolved = resolveRepoInput(token);
		if (resolved.repoUrl && sourcesByRepo.has(resolved.repoUrl)) {
			const source = sourcesByRepo.get(resolved.repoUrl);
			if (source) {
				idsToRemove.add(source.id);
			}
			continue;
		}
		if (resolved.inferredId && sourcesById.has(resolved.inferredId)) {
			idsToRemove.add(resolved.inferredId);
			continue;
		}
		missing.push(token);
	}
	const remaining = config.sources.filter(
		(source) => !idsToRemove.has(source.id),
	);
	const removed = config.sources
		.filter((source) => idsToRemove.has(source.id))
		.map((source) => source.id);
	const removedSources = config.sources.filter((source) =>
		idsToRemove.has(source.id),
	);

	if (removed.length === 0) {
		throw new Error("No matching sources found to remove.");
	}

	const nextConfig: DocsCacheConfig = {
		$schema:
			rawConfig?.$schema ??
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: remaining,
	};
	if (rawConfig?.cacheDir) {
		nextConfig.cacheDir = rawConfig.cacheDir;
	}
	if (rawConfig?.toc !== undefined) {
		nextConfig.toc = rawConfig.toc;
	}
	if (rawConfig?.defaults) {
		nextConfig.defaults = rawConfig.defaults;
	}
	if (rawConfig?.targetMode) {
		nextConfig.targetMode = rawConfig.targetMode;
	}

	if (target.mode === "package") {
		const pkg = rawPackage ?? {};
		pkg["docs-cache"] = stripDefaultConfigValues(nextConfig);
		await writeFile(resolvedPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
	} else {
		await writeConfig(resolvedPath, nextConfig);
	}

	const targetRemovals: Array<{ id: string; targetDir: string }> = [];
	for (const source of removedSources) {
		if (!source.targetDir) {
			continue;
		}
		const targetDir = resolveTargetDir(resolvedPath, source.targetDir);
		await rm(targetDir, { recursive: true, force: true });
		targetRemovals.push({ id: source.id, targetDir });
	}

	return {
		configPath: resolvedPath,
		removed,
		missing,
		targetsRemoved: targetRemovals,
	};
};
