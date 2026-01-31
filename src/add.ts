import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	DEFAULT_CONFIG,
	type DocsCacheConfig,
	resolveConfigPath,
	validateConfig,
	writeConfig,
} from "./config";
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

export const addSources = async (params: {
	configPath?: string;
	entries: Array<{ id?: string; repo: string; targetDir?: string }>;
}) => {
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
			config = rawConfig ?? DEFAULT_CONFIG;
		} else {
			const raw = await readFile(resolvedPath, "utf8");
			rawConfig = JSON.parse(raw.toString());
			config = validateConfig(rawConfig);
		}
	}

	const schema =
		"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json";
	const existingIds = new Set(config.sources.map((source) => source.id));
	const skipped: string[] = [];
	const newSources = params.entries
		.map((entry) => {
			const resolved = resolveRepoInput(entry.repo);
			const sourceId = entry.id || resolved.inferredId;
			if (!sourceId) {
				throw new Error("Unable to infer id. Provide an explicit id.");
			}
			if (existingIds.has(sourceId)) {
				skipped.push(sourceId);
				return null;
			}
			existingIds.add(sourceId);
			return {
				id: sourceId,
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
	if (newSources.length === 0) {
		throw new Error("All sources already exist in config.");
	}
	const nextConfig: DocsCacheConfig = {
		$schema: schema,
		sources: [...config.sources, ...newSources],
	};
	if (rawConfig?.cacheDir) {
		nextConfig.cacheDir = rawConfig.cacheDir;
	}
	if (rawConfig?.index !== undefined) {
		nextConfig.index = rawConfig.index;
	}
	if (rawConfig?.defaults) {
		nextConfig.defaults = rawConfig.defaults;
	}

	if (target.mode === "package") {
		const pkg = rawPackage ?? {};
		pkg["docs-cache"] = nextConfig;
		await writeFile(resolvedPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
	} else {
		await writeConfig(resolvedPath, nextConfig);
	}

	return {
		configPath: resolvedPath,
		sources: newSources,
		skipped,
		created: true,
	};
};
