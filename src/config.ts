import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "./config-schema";
import { resolveTargetDir } from "./paths";
import { assertSafeSourceId } from "./source-id";

export type CacheMode = "materialize";

export type TocFormat = "tree" | "compressed";

export type IntegrityType = "commit" | "manifest";

export interface DocsCacheIntegrity {
	type: IntegrityType;
	value: string | null;
}

export interface DocsCacheDefaults {
	ref: string;
	mode: CacheMode;
	include: string[];
	targetMode?: "symlink" | "copy";
	depth: number;
	required: boolean;
	maxBytes: number;
	maxFiles?: number;
	allowHosts: string[];
	toc?: boolean | TocFormat;
}

export interface DocsCacheSource {
	id: string;
	repo: string;
	targetDir?: string;
	targetMode?: "symlink" | "copy";
	ref?: string;
	mode?: CacheMode;
	depth?: number;
	include?: string[];
	exclude?: string[];
	required?: boolean;
	maxBytes?: number;
	maxFiles?: number;
	integrity?: DocsCacheIntegrity;
	toc?: boolean | TocFormat;
}

export interface DocsCacheConfig {
	$schema?: string;
	cacheDir?: string;
	targetMode?: "symlink" | "copy";
	defaults?: Partial<DocsCacheDefaults>;
	sources: DocsCacheSource[];
}

export interface DocsCacheResolvedSource {
	id: string;
	repo: string;
	targetDir?: string;
	targetMode?: "symlink" | "copy";
	ref: string;
	mode: CacheMode;
	depth: number;
	include?: string[];
	exclude?: string[];
	required: boolean;
	maxBytes: number;
	maxFiles?: number;
	integrity?: DocsCacheIntegrity;
	toc?: boolean | TocFormat;
}

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
		targetMode: DEFAULT_TARGET_MODE,
		depth: 1,
		required: true,
		maxBytes: 200000000,
		allowHosts: ["github.com", "gitlab.com"],
		toc: true,
	},
	sources: [],
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const assertString = (value: unknown, label: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value;
};

const assertBoolean = (value: unknown, label: string): boolean => {
	if (typeof value !== "boolean") {
		throw new Error(`${label} must be a boolean.`);
	}
	return value;
};

const assertNumber = (value: unknown, label: string): number => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		throw new Error(`${label} must be a number.`);
	}
	return value;
};

const assertPositiveNumber = (value: unknown, label: string): number => {
	const numberValue = assertNumber(value, label);
	if (numberValue < 1) {
		throw new Error(`${label} must be greater than zero.`);
	}
	return numberValue;
};

const assertStringArray = (value: unknown, label: string): string[] => {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} must be a non-empty array of strings.`);
	}
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0) {
			throw new Error(`${label} must contain non-empty strings.`);
		}
	}
	return value as string[];
};

const assertTargetMode = (
	value: unknown,
	label: string,
): "symlink" | "copy" => {
	const mode = assertString(value, label) as "symlink" | "copy";
	if (mode !== "symlink" && mode !== "copy") {
		throw new Error(`${label} must be "symlink" or "copy".`);
	}
	return mode;
};

const assertMode = (value: unknown, label: string): CacheMode => {
	if (value !== "materialize") {
		throw new Error(`${label} must be "materialize".`);
	}
	return value;
};

const assertIntegrity = (value: unknown, label: string): DocsCacheIntegrity => {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object.`);
	}
	const type = value.type;
	if (type !== "commit" && type !== "manifest") {
		throw new Error(`${label}.type must be "commit" or "manifest".`);
	}
	const integrityValue = value.value;
	if (typeof integrityValue !== "string" && integrityValue !== null) {
		throw new Error(`${label}.value must be a string or null.`);
	}
	return { type, value: integrityValue };
};

export const validateConfig = (input: unknown): DocsCacheConfig => {
	if (!isRecord(input)) {
		throw new Error("Config must be a JSON object.");
	}
	const parsed = ConfigSchema.safeParse(input);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "config"} ${issue.message}`)
			.join("; ");
		throw new Error(`Config does not match schema: ${details}.`);
	}

	const cacheDir = input.cacheDir
		? assertString(input.cacheDir, "cacheDir")
		: DEFAULT_CACHE_DIR;

	const defaultsInput = input.defaults;
	const targetModeOverride =
		input.targetMode !== undefined
			? assertTargetMode(input.targetMode, "targetMode")
			: undefined;
	const defaultValues = DEFAULT_CONFIG.defaults as DocsCacheDefaults;
	let defaults: DocsCacheDefaults = defaultValues;
	if (defaultsInput !== undefined) {
		if (!isRecord(defaultsInput)) {
			throw new Error("defaults must be an object.");
		}

		defaults = {
			ref:
				defaultsInput.ref !== undefined
					? assertString(defaultsInput.ref, "defaults.ref")
					: defaultValues.ref,
			mode:
				defaultsInput.mode !== undefined
					? assertMode(defaultsInput.mode, "defaults.mode")
					: defaultValues.mode,
			include:
				defaultsInput.include !== undefined
					? assertStringArray(defaultsInput.include, "defaults.include")
					: defaultValues.include,
			targetMode:
				defaultsInput.targetMode !== undefined
					? assertTargetMode(defaultsInput.targetMode, "defaults.targetMode")
					: (targetModeOverride ?? defaultValues.targetMode),
			depth:
				defaultsInput.depth !== undefined
					? assertPositiveNumber(defaultsInput.depth, "defaults.depth")
					: defaultValues.depth,
			required:
				defaultsInput.required !== undefined
					? assertBoolean(defaultsInput.required, "defaults.required")
					: defaultValues.required,
			maxBytes:
				defaultsInput.maxBytes !== undefined
					? assertPositiveNumber(defaultsInput.maxBytes, "defaults.maxBytes")
					: defaultValues.maxBytes,
			maxFiles:
				defaultsInput.maxFiles !== undefined
					? assertPositiveNumber(defaultsInput.maxFiles, "defaults.maxFiles")
					: defaultValues.maxFiles,
			allowHosts:
				defaultsInput.allowHosts !== undefined
					? assertStringArray(defaultsInput.allowHosts, "defaults.allowHosts")
					: defaultValues.allowHosts,
			toc:
				defaultsInput.toc !== undefined
					? (defaultsInput.toc as boolean | TocFormat)
					: defaultValues.toc,
		};
	} else if (targetModeOverride !== undefined) {
		defaults = {
			...defaultValues,
			targetMode: targetModeOverride,
		};
	}

	if (!Array.isArray(input.sources)) {
		throw new Error("sources must be an array.");
	}

	const sources = input.sources.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new Error(`sources[${index}] must be an object.`);
		}
		const source: DocsCacheSource = {
			id: assertSafeSourceId(entry.id, `sources[${index}].id`),
			repo: assertString(entry.repo, `sources[${index}].repo`),
		};
		if (entry.targetDir !== undefined) {
			source.targetDir = assertString(
				entry.targetDir,
				`sources[${index}].targetDir`,
			);
		}
		if (entry.targetMode !== undefined) {
			const targetMode = assertString(
				entry.targetMode,
				`sources[${index}].targetMode`,
			);
			if (targetMode !== "symlink" && targetMode !== "copy") {
				throw new Error(
					`sources[${index}].targetMode must be "symlink" or "copy".`,
				);
			}
			source.targetMode = targetMode;
		}
		if (entry.ref !== undefined) {
			source.ref = assertString(entry.ref, `sources[${index}].ref`);
		}
		if (entry.mode !== undefined) {
			source.mode = assertMode(entry.mode, `sources[${index}].mode`);
		}
		if (entry.depth !== undefined) {
			source.depth = assertPositiveNumber(
				entry.depth,
				`sources[${index}].depth`,
			);
		}
		if (entry.include !== undefined) {
			source.include = assertStringArray(
				entry.include,
				`sources[${index}].include`,
			);
		}
		if (entry.exclude !== undefined) {
			source.exclude = assertStringArray(
				entry.exclude,
				`sources[${index}].exclude`,
			);
		}
		if (entry.required !== undefined) {
			source.required = assertBoolean(
				entry.required,
				`sources[${index}].required`,
			);
		}
		if (entry.maxBytes !== undefined) {
			source.maxBytes = assertPositiveNumber(
				entry.maxBytes,
				`sources[${index}].maxBytes`,
			);
		}
		if (entry.maxFiles !== undefined) {
			source.maxFiles = assertPositiveNumber(
				entry.maxFiles,
				`sources[${index}].maxFiles`,
			);
		}
		if (entry.integrity !== undefined) {
			source.integrity = assertIntegrity(
				entry.integrity,
				`sources[${index}].integrity`,
			);
		}

		if (entry.toc !== undefined) {
			source.toc = entry.toc as boolean | TocFormat;
		}

		return source;
	});

	// Validate unique source IDs
	const idSet = new Set<string>();
	const duplicates: string[] = [];
	for (const source of sources) {
		if (idSet.has(source.id)) {
			duplicates.push(source.id);
		}
		idSet.add(source.id);
	}
	if (duplicates.length > 0) {
		throw new Error(
			`Duplicate source IDs found: ${duplicates.join(", ")}. Each source must have a unique ID.`,
		);
	}

	return {
		cacheDir,
		targetMode: targetModeOverride,
		defaults,
		sources,
	};
};

export const resolveSources = (
	config: DocsCacheConfig,
): DocsCacheResolvedSource[] => {
	const defaults = (config.defaults ??
		DEFAULT_CONFIG.defaults) as DocsCacheDefaults;
	return config.sources.map((source) => ({
		id: source.id,
		repo: source.repo,
		targetDir: source.targetDir,
		targetMode: source.targetMode ?? defaults.targetMode,
		ref: source.ref ?? defaults.ref,
		mode: source.mode ?? defaults.mode,
		depth: source.depth ?? defaults.depth,
		include: source.include ?? defaults.include,
		exclude: source.exclude,
		required: source.required ?? defaults.required,
		maxBytes: source.maxBytes ?? defaults.maxBytes,
		maxFiles: source.maxFiles ?? defaults.maxFiles,
		integrity: source.integrity,
		toc: source.toc ?? defaults.toc,
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
		} catch {
			// fall through to error below
		}
	}
	throw new Error(
		`No docs.config.json found at ${resolvedPath} and no docs-cache config in ${packagePath}.`,
	);
};
