import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	DEFAULT_CONFIG,
	type DocsCacheConfig,
	resolveConfigPath,
	stripDefaultConfigValues,
	validateConfig,
	writeConfig,
} from "#config";

const PACKAGE_JSON = "package.json";
const SCHEMA_URL =
	"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json";

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export type ConfigTarget = {
	resolvedPath: string;
	mode: "package" | "config";
};

export const loadPackageConfig = async (configPath: string) => {
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

export const resolveConfigTarget = async (
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

export const readConfigAtPath = async (
	target: ConfigTarget,
	options?: { allowMissing?: boolean },
) => {
	if (!(await exists(target.resolvedPath))) {
		if (!options?.allowMissing) {
			throw new Error(`Config not found at ${target.resolvedPath}.`);
		}
		if (target.mode === "package") {
			throw new Error(`package.json not found at ${target.resolvedPath}.`);
		}
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

export const mergeConfigBase = (
	config: DocsCacheConfig,
	sources: DocsCacheConfig["sources"],
): DocsCacheConfig => {
	const nextConfig: DocsCacheConfig = {
		$schema: config.$schema ?? SCHEMA_URL,
		sources,
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

export const writeConfigFile = async (params: {
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
