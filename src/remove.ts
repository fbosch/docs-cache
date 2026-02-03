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

type ConfigTarget = {
	resolvedPath: string;
	mode: "package" | "config";
};

const resolveConfigTarget = async (
	configPath?: string,
): Promise<ConfigTarget> => {
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

const readConfigAtPath = async (target: ConfigTarget) => {
	if (!(await exists(target.resolvedPath))) {
		throw new Error(`Config not found at ${target.resolvedPath}.`);
	}
	if (target.mode === "package") {
		const pkg = await loadPackageConfig(target.resolvedPath);
		if (!pkg.config) {
			throw new Error(`Missing docs-cache config in ${target.resolvedPath}.`);
		}
		return {
			config: pkg.config,
			rawConfig: pkg.config,
			rawPackage: pkg.parsed,
		};
	}
	const raw = await readFile(target.resolvedPath, "utf8");
	const rawConfig = JSON.parse(raw.toString());
	return {
		config: validateConfig(rawConfig),
		rawConfig,
		rawPackage: null,
	};
};

const resolveIdsToRemove = (ids: string[], config: DocsCacheConfig) => {
	const sourcesById = new Map(
		config.sources.map((source) => [source.id, source]),
	);
	const sourcesByRepo = new Map(
		config.sources.map((source) => [source.repo, source]),
	);
	const idsToRemove = new Set<string>();
	const missing: string[] = [];
	for (const token of ids) {
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
	return { idsToRemove, missing };
};

const buildNextConfig = (
	config: DocsCacheConfig,
	remaining: DocsCacheConfig["sources"],
): DocsCacheConfig => {
	const nextConfig: DocsCacheConfig = {
		$schema:
			config.$schema ??
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: remaining,
	};
	if (config.cacheDir) {
		nextConfig.cacheDir = config.cacheDir;
	}
	if (config.defaults) {
		nextConfig.defaults = config.defaults;
	}
	if (config.targetMode) {
		nextConfig.targetMode = config.targetMode;
	}
	return nextConfig;
};

const writeConfigFile = async (params: {
	mode: "package" | "config";
	resolvedPath: string;
	config: DocsCacheConfig;
	rawPackage: Record<string, unknown> | null;
}) => {
	const { mode, resolvedPath, config, rawPackage } = params;
	if (mode === "package") {
		const pkg = rawPackage ?? {};
		pkg["docs-cache"] = stripDefaultConfigValues(config);
		await writeFile(resolvedPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
		return;
	}
	await writeConfig(resolvedPath, config);
};

const removeTargets = async (
	resolvedPath: string,
	removedSources: DocsCacheConfig["sources"],
) => {
	const targetRemovals: Array<{ id: string; targetDir: string }> = [];
	for (const source of removedSources) {
		if (!source.targetDir) {
			continue;
		}
		const targetDir = resolveTargetDir(resolvedPath, source.targetDir);
		await rm(targetDir, { recursive: true, force: true });
		targetRemovals.push({ id: source.id, targetDir });
	}
	return targetRemovals;
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
	const { config, rawConfig, rawPackage } = await readConfigAtPath(target);
	const { idsToRemove, missing } = resolveIdsToRemove(params.ids, config);
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

	const nextConfig = buildNextConfig(rawConfig ?? DEFAULT_CONFIG, remaining);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	const targetRemovals = await removeTargets(resolvedPath, removedSources);

	return {
		configPath: resolvedPath,
		removed,
		missing,
		targetsRemoved: targetRemovals,
	};
};
