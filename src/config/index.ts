import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	CacheMode,
	DocsCacheConfig,
	DocsCacheDefaults,
	DocsCacheIntegrity,
	DocsCacheResolvedSource,
	DocsCacheSource,
	TocFormat,
} from "#config/schema";
import { ConfigSchema } from "#config/schema";
import { resolveTargetDir } from "#core/paths";

export type {
	CacheMode,
	DocsCacheConfig,
	DocsCacheDefaults,
	DocsCacheIntegrity,
	DocsCacheResolvedSource,
	DocsCacheSource,
	TocFormat,
};

export const DEFAULT_CONFIG_FILENAME = "docs.config.json";
export const DEFAULT_CACHE_DIR = ".docs";
const PACKAGE_JSON_FILENAME = "package.json";
const DEFAULT_TARGET_MODE = process.platform === "win32" ? "copy" : "symlink";
export const DEFAULT_CONFIG: DocsCacheConfig = {
	cacheDir: DEFAULT_CACHE_DIR,
	defaults: {
		ref: "HEAD",
		mode: "materialize",
		include: ["**/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}"],
		exclude: [],
		targetMode: DEFAULT_TARGET_MODE,
		required: true,
		maxBytes: 200000000,
		ignoreHidden: false,
		allowHosts: ["github.com", "gitlab.com", "visualstudio.com"],
		toc: true,
		unwrapSingleRootDir: true,
	},
	sources: [],
} as const;

const isEqualStringArray = (left?: string[], right?: string[]) => {
	if (!left || !right) {
		return left === right;
	}
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const pruneDefaults = (
	value: Record<string, unknown>,
	baseline: Record<string, unknown>,
): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		const base = baseline[key];
		if (Array.isArray(entry) && Array.isArray(base)) {
			if (!isEqualStringArray(entry, base)) {
				result[key] = entry;
			}
			continue;
		}
		if (isObject(entry) && isObject(base)) {
			const pruned = pruneDefaults(entry, base);
			if (Object.keys(pruned).length > 0) {
				result[key] = pruned;
			}
			continue;
		}
		if (entry !== base) {
			result[key] = entry;
		}
	}
	return result;
};

export const stripDefaultConfigValues = (
	config: DocsCacheConfig,
): DocsCacheConfig => {
	const baseline: DocsCacheConfig = {
		...DEFAULT_CONFIG,
		$schema: config.$schema,
		defaults: {
			...DEFAULT_CONFIG.defaults,
			...(config.targetMode ? { targetMode: config.targetMode } : undefined),
		},
	};
	const pruned = pruneDefaults(
		config as unknown as Record<string, unknown>,
		baseline as unknown as Record<string, unknown>,
	);
	const next: DocsCacheConfig = {
		$schema: pruned.$schema as DocsCacheConfig["$schema"],
		cacheDir: pruned.cacheDir as DocsCacheConfig["cacheDir"],
		targetMode: pruned.targetMode as DocsCacheConfig["targetMode"],
		defaults: pruned.defaults as DocsCacheConfig["defaults"],
		sources: config.sources,
	};
	if (!next.defaults || Object.keys(next.defaults).length === 0) {
		delete next.defaults;
	}
	return next;
};

export const validateConfig = (input: unknown): DocsCacheConfig => {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new Error("Config must be a JSON object.");
	}
	const parsed = ConfigSchema.safeParse(input);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "config"} ${issue.message}`)
			.join("; ");
		throw new Error(`Config does not match schema: ${details}.`);
	}
	const configInput = parsed.data;
	const cacheDir = configInput.cacheDir ?? DEFAULT_CACHE_DIR;
	const defaultValues = DEFAULT_CONFIG.defaults as DocsCacheDefaults;
	const targetModeOverride = configInput.targetMode;
	const defaultsInput = configInput.defaults;
	const defaults: DocsCacheDefaults = {
		...defaultValues,
		...(defaultsInput ?? {}),
		targetMode:
			defaultsInput?.targetMode ??
			targetModeOverride ??
			defaultValues.targetMode,
	};

	return {
		cacheDir,
		targetMode: targetModeOverride,
		defaults,
		sources: configInput.sources as DocsCacheSource[],
	};
};

export const resolveSources = (
	config: DocsCacheConfig,
): DocsCacheResolvedSource[] => {
	const defaults = (config.defaults ??
		DEFAULT_CONFIG.defaults) as DocsCacheDefaults;
	const { allowHosts: _allowHosts, ...defaultValues } = defaults;
	return config.sources.map((source) => ({
		...defaultValues,
		...source,
		targetMode: source.targetMode ?? defaultValues.targetMode,
		include: source.include ?? defaultValues.include,
		exclude: source.exclude ?? defaultValues.exclude,
		maxFiles: source.maxFiles ?? defaultValues.maxFiles,
		toc: source.toc ?? defaultValues.toc,
		unwrapSingleRootDir:
			source.unwrapSingleRootDir ?? defaultValues.unwrapSingleRootDir,
	}));
};

export const resolveConfigPath = (configPath?: string) =>
	configPath
		? path.resolve(configPath)
		: path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

const resolvePackagePath = () =>
	path.resolve(process.cwd(), PACKAGE_JSON_FILENAME);

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const loadConfigFromFile = async (
	filePath: string,
	mode: "config" | "package",
) => {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read config at ${filePath}: ${message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${filePath}: ${message}`);
	}
	const configInput =
		mode === "package"
			? (parsed as Record<string, unknown>)?.["docs-cache"]
			: parsed;
	if (mode === "package" && configInput === undefined) {
		throw new Error(`Missing docs-cache config in ${filePath}.`);
	}
	const config = validateConfig(configInput);
	for (const source of config.sources) {
		if (source.targetDir) {
			resolveTargetDir(filePath, source.targetDir);
		}
	}
	return {
		config,
		resolvedPath: filePath,
		sources: resolveSources(config),
	};
};

export const writeConfig = async (
	configPath: string,
	config: DocsCacheConfig,
) => {
	const data = `${JSON.stringify(config, null, 2)}\n`;
	await writeFile(configPath, data, "utf8");
};

export const loadConfig = async (configPath?: string) => {
	const resolvedPath = resolveConfigPath(configPath);
	const isPackageConfig = path.basename(resolvedPath) === PACKAGE_JSON_FILENAME;
	if (configPath) {
		return loadConfigFromFile(
			resolvedPath,
			isPackageConfig ? "package" : "config",
		);
	}
	if (await exists(resolvedPath)) {
		return loadConfigFromFile(resolvedPath, "config");
	}
	const packagePath = resolvePackagePath();
	if (await exists(packagePath)) {
		try {
			return await loadConfigFromFile(packagePath, "package");
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("Missing docs-cache config")
			) {
				// fall through to error below
			} else {
				throw error;
			}
		}
	}
	throw new Error(
		`No docs.config.json found at ${resolvedPath} and no docs-cache config in ${packagePath}.`,
	);
};
