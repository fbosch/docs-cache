import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomically } from "#core/atomic-write";
import { isRecord } from "#core/is-record";

export interface DocsCacheLockSource {
	repo: string;
	ref: string;
	resolvedCommit: string;
	bytes: number;
	fileCount: number;
	manifestSha256: string;
	rulesSha256?: string;
}

export interface DocsCacheOpenCodeLock {
	configPath: string;
	aliases: string[];
}

export interface DocsCacheLock {
	version: 1;
	toolVersion: string;
	sources: Record<string, DocsCacheLockSource>;
	opencode?: DocsCacheOpenCodeLock;
}

export const DEFAULT_LOCK_FILENAME = "docs-lock.json";

const assertString = (value: unknown, label: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
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
	if (numberValue < 0) {
		throw new Error(`${label} must be zero or greater.`);
	}
	return numberValue;
};

export const validateLock = (input: unknown): DocsCacheLock => {
	if (!isRecord(input)) {
		throw new Error("Lock file must be a JSON object.");
	}
	const version = input.version;
	if (version !== 1) {
		throw new Error("Lock file version must be 1.");
	}
	const toolVersion = assertString(input.toolVersion, "toolVersion");
	if (!isRecord(input.sources)) {
		throw new Error("sources must be an object.");
	}
	const sources: Record<string, DocsCacheLockSource> = {};
	for (const [key, value] of Object.entries(input.sources)) {
		if (!isRecord(value)) {
			throw new Error(`sources.${key} must be an object.`);
		}
		sources[key] = {
			repo: assertString(value.repo, `sources.${key}.repo`),
			ref: assertString(value.ref, `sources.${key}.ref`),
			resolvedCommit: assertString(
				value.resolvedCommit,
				`sources.${key}.resolvedCommit`,
			),
			bytes: assertPositiveNumber(value.bytes, `sources.${key}.bytes`),
			fileCount: assertPositiveNumber(
				value.fileCount,
				`sources.${key}.fileCount`,
			),
			manifestSha256: assertString(
				value.manifestSha256,
				`sources.${key}.manifestSha256`,
			),
			rulesSha256:
				value.rulesSha256 === undefined
					? undefined
					: assertString(value.rulesSha256, `sources.${key}.rulesSha256`),
		};
	}
	let opencode: DocsCacheOpenCodeLock | undefined;
	if (input.opencode !== undefined) {
		if (!isRecord(input.opencode)) {
			throw new Error("opencode must be an object.");
		}
		const configPath = assertString(
			input.opencode.configPath,
			"opencode.configPath",
		);
		if (!Array.isArray(input.opencode.aliases)) {
			throw new Error("opencode.aliases must be an array.");
		}
		const aliases = input.opencode.aliases.map((alias, index) =>
			assertString(alias, `opencode.aliases.${index}`),
		);
		if (new Set(aliases).size !== aliases.length) {
			throw new Error("opencode.aliases must not contain duplicates.");
		}
		opencode = { configPath, aliases };
	}
	return {
		version: 1,
		toolVersion,
		sources,
		...(opencode ? { opencode } : {}),
	};
};

export const resolveLockPath = (configPath: string) =>
	path.resolve(path.dirname(configPath), DEFAULT_LOCK_FILENAME);

export const readLock = async (lockPath: string) => {
	let raw: string;
	try {
		raw = await readFile(lockPath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read lock file at ${lockPath}: ${message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${lockPath}: ${message}`);
	}
	return validateLock(parsed);
};

export const writeLock = async (lockPath: string, lock: DocsCacheLock) => {
	const data = `${JSON.stringify(lock, null, 2)}\n`;
	await writeFileAtomically(lockPath, data);
};
