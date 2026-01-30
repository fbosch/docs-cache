import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DocsCacheLockSource {
	repo: string;
	ref: string;
	resolvedCommit: string;
	bytes: number;
	fileCount: number;
	manifestSha256: string;
	updatedAt: string;
}

export interface DocsCacheLock {
	version: 1;
	generatedAt: string;
	toolVersion: string;
	sources: Record<string, DocsCacheLockSource>;
}

export const DEFAULT_LOCK_FILENAME = "docs.lock";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
	const generatedAt = assertString(input.generatedAt, "generatedAt");
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
			updatedAt: assertString(value.updatedAt, `sources.${key}.updatedAt`),
		};
	}
	return {
		version: 1,
		generatedAt,
		toolVersion,
		sources,
	};
};

export const resolveLockPath = (configPath: string, lockName?: string) =>
	path.resolve(path.dirname(configPath), lockName ?? DEFAULT_LOCK_FILENAME);

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
	await writeFile(lockPath, data, "utf8");
};
