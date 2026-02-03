import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	type DocsCacheConfig,
	resolveConfigPath,
	stripDefaultConfigValues,
	validateConfig,
	writeConfig,
} from "./config";
import { ensureGitignoreEntry } from "./gitignore";
import { resolveTargetDir } from "./paths";
import { resolveRepoInput } from "./resolve-repo";
import { assertSafeSourceId } from "./source-id";

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
		return {
			config: DEFAULT_CONFIG,
			rawConfig: null,
			rawPackage: null,
			hadDocsCacheConfig: false,
		};
	}
	if (target.mode === "package") {
		const pkg = await loadPackageConfig(target.resolvedPath);
		return {
			config: pkg.config ?? DEFAULT_CONFIG,
			rawConfig: pkg.config,
			rawPackage: pkg.parsed,
			hadDocsCacheConfig: Boolean(pkg.config),
		};
	}
	const raw = await readFile(target.resolvedPath, "utf8");
	const rawConfig = JSON.parse(raw.toString());
	return {
		config: validateConfig(rawConfig),
		rawConfig,
		rawPackage: null,
		hadDocsCacheConfig: true,
	};
};

const buildNewSources = (
	entries: Array<{ id?: string; repo: string; targetDir?: string }>,
	config: DocsCacheConfig,
	resolvedPath: string,
) => {
	const existingIds = new Set(config.sources.map((source) => source.id));
	const skipped: string[] = [];
	const newSources = entries
		.map((entry) => {
			const resolved = resolveRepoInput(entry.repo);
			const sourceId = entry.id || resolved.inferredId;
			if (!sourceId) {
				throw new Error("Unable to infer id. Provide an explicit id.");
			}
			const safeId = assertSafeSourceId(sourceId, "source id");
			if (existingIds.has(safeId)) {
				skipped.push(safeId);
				return null;
			}
			existingIds.add(safeId);
			if (entry.targetDir) {
				resolveTargetDir(resolvedPath, entry.targetDir);
			}
			return {
				id: safeId,
				repo: resolved.repoUrl,
				...(entry.targetDir ? { targetDir: entry.targetDir } : {}),
				...(resolved.ref ? { ref: resolved.ref } : {}),
			};
		})
		.filter(Boolean) as Array<{
		id: string;
		repo: string;
		targetDir?: string;
		ref?: string;
	}>;
	return { newSources, skipped };
};

const buildNextConfig = (
	config: DocsCacheConfig,
	newSources: DocsCacheConfig["sources"],
) => {
	const schema =
		"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json";
	const nextConfig: DocsCacheConfig = {
		$schema: config.$schema ?? schema,
		sources: [...config.sources, ...newSources],
	};
	if (config.cacheDir) {
		nextConfig.cacheDir = config.cacheDir;
	}
	if (config.defaults) {
		nextConfig.defaults = config.defaults;
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

const ensureGitignore = async (
	resolvedPath: string,
	cacheDir: string,
	shouldWrite: boolean,
) => {
	if (!shouldWrite) {
		return null;
	}
	return ensureGitignoreEntry(path.dirname(resolvedPath), cacheDir);
};

export const addSources = async (params: {
	configPath?: string;
	entries: Array<{ id?: string; repo: string; targetDir?: string }>;
}) => {
	const target = await resolveConfigTarget(params.configPath);
	const resolvedPath = target.resolvedPath;
	const { config, rawConfig, rawPackage, hadDocsCacheConfig } =
		await readConfigAtPath(target);
	const { newSources, skipped } = buildNewSources(
		params.entries,
		config,
		resolvedPath,
	);
	if (newSources.length === 0) {
		throw new Error("All sources already exist in config.");
	}
	const nextConfig = buildNextConfig(rawConfig ?? config, newSources);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	const gitignoreResult = await ensureGitignore(
		resolvedPath,
		rawConfig?.cacheDir ?? DEFAULT_CACHE_DIR,
		!hadDocsCacheConfig,
	);

	return {
		configPath: resolvedPath,
		sources: newSources,
		skipped,
		created: true,
		gitignoreUpdated: gitignoreResult?.updated ?? false,
		gitignorePath: gitignoreResult?.gitignorePath ?? null,
	};
};
