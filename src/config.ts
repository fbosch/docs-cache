import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CacheMode = "materialize" | "sparse";

export type IntegrityType = "commit" | "manifest";

export interface DocsCacheIntegrity {
	type: IntegrityType;
	value: string | null;
}

export interface DocsCacheDefaults {
	ref: string;
	mode: CacheMode;
	include: string[];
	depth: number;
	required: boolean;
	maxBytes: number;
	allowHosts: string[];
}

export interface DocsCacheSource {
	id: string;
	repo: string;
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
	version: 1;
	cacheDir: string;
	defaults: DocsCacheDefaults;
	sources: DocsCacheSource[];
}

export interface DocsCacheResolvedSource {
	id: string;
	repo: string;
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
export const DEFAULT_CONFIG: DocsCacheConfig = {
	version: 1,
	cacheDir: DEFAULT_CACHE_DIR,
	defaults: {
		ref: "HEAD",
		mode: "materialize",
		include: [
			"**/*.{md,mdx,markdown,mkd,txt,rst,adoc,asciidoc}",
			"README*",
			"LICENSE*",
		],
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

const assertMode = (value: unknown, label: string): CacheMode => {
	if (value !== "materialize" && value !== "sparse") {
		throw new Error(`${label} must be "materialize" or "sparse".`);
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

	const version = input.version;
	if (version !== 1) {
		throw new Error("Config version must be 1.");
	}

	const cacheDir = assertString(input.cacheDir, "cacheDir");

	if (!isRecord(input.defaults)) {
		throw new Error("defaults must be an object.");
	}

	const defaults: DocsCacheDefaults = {
		ref: assertString(input.defaults.ref, "defaults.ref"),
		mode: assertMode(input.defaults.mode, "defaults.mode"),
		include: assertStringArray(input.defaults.include, "defaults.include"),
		depth: assertPositiveNumber(input.defaults.depth, "defaults.depth"),
		required: assertBoolean(input.defaults.required, "defaults.required"),
		maxBytes: assertPositiveNumber(
			input.defaults.maxBytes,
			"defaults.maxBytes",
		),
		allowHosts: assertStringArray(
			input.defaults.allowHosts,
			"defaults.allowHosts",
		),
	};

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
		version: 1,
		cacheDir,
		defaults,
		sources,
	};
};

export const resolveSources = (
	config: DocsCacheConfig,
): DocsCacheResolvedSource[] =>
	config.sources.map((source) => ({
		id: source.id,
		repo: source.repo,
		ref: source.ref ?? config.defaults.ref,
		mode: source.mode ?? config.defaults.mode,
		depth: source.depth ?? config.defaults.depth,
		include: source.include ?? config.defaults.include,
		exclude: source.exclude,
		required: source.required ?? config.defaults.required,
		maxBytes: source.maxBytes ?? config.defaults.maxBytes,
		integrity: source.integrity,
	}));

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
