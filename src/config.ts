import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "./config-schema";

export type CacheMode = "materialize";

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
	allowHosts: string[];
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
	integrity?: DocsCacheIntegrity;
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
	integrity?: DocsCacheIntegrity;
}

export const DEFAULT_CONFIG_FILENAME = "docs.config.json";
export const DEFAULT_CACHE_DIR = ".docs";
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
	},
	sources: [],
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
			allowHosts:
				defaultsInput.allowHosts !== undefined
					? assertStringArray(defaultsInput.allowHosts, "defaults.allowHosts")
					: defaultValues.allowHosts,
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
			id: assertString(entry.id, `sources[${index}].id`),
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
		if (entry.integrity !== undefined) {
			source.integrity = assertIntegrity(
				entry.integrity,
				`sources[${index}].integrity`,
			);
		}
		return source;
	});

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
		integrity: source.integrity,
	}));
};

export const resolveConfigPath = (configPath?: string) =>
	configPath
		? path.resolve(configPath)
		: path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

export const writeConfig = async (
	configPath: string,
	config: DocsCacheConfig,
) => {
	const data = `${JSON.stringify(config, null, 2)}\n`;
	await writeFile(configPath, data, "utf8");
};

export const loadConfig = async (configPath?: string) => {
	const resolvedPath = resolveConfigPath(configPath);
	let raw: string;
	try {
		raw = await readFile(resolvedPath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read config at ${resolvedPath}: ${message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${resolvedPath}: ${message}`);
	}
	const config = validateConfig(parsed);
	return {
		config,
		resolvedPath,
		sources: resolveSources(config),
	};
};
