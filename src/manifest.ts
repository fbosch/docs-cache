import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

export type ManifestEntry = {
	path: string;
	size: number;
};

const parseManifestEntry = (value: unknown): ManifestEntry => {
	if (!value || typeof value !== "object") {
		throw new Error("Manifest entry must be an object.");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.path !== "string" || record.path.length === 0) {
		throw new Error("Manifest entry path must be a non-empty string.");
	}
	if (typeof record.size !== "number" || Number.isNaN(record.size)) {
		throw new Error("Manifest entry size must be a number.");
	}
	if (record.size < 0) {
		throw new Error("Manifest entry size must be zero or greater.");
	}
	return { path: record.path, size: record.size };
};

export const MANIFEST_FILENAME = ".manifest.jsonl";

export const readManifest = async (sourceDir: string) => {
	const manifestPath = path.join(sourceDir, MANIFEST_FILENAME);
	const entries: ManifestEntry[] = [];
	const stream = createReadStream(manifestPath, { encoding: "utf8" });
	const lines = readline.createInterface({
		input: stream,
		crlfDelay: Infinity,
	});
	try {
		for await (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			entries.push(parseManifestEntry(JSON.parse(trimmed)));
		}
		return { manifestPath, entries };
	} finally {
		lines.close();
		stream.destroy();
	}
};

export const streamManifestEntries = async function* (
	sourceDir: string,
): AsyncGenerator<ManifestEntry> {
	const manifestPath = path.join(sourceDir, MANIFEST_FILENAME);
	const stream = createReadStream(manifestPath, { encoding: "utf8" });
	const lines = readline.createInterface({
		input: stream,
		crlfDelay: Infinity,
	});
	try {
		for await (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			yield parseManifestEntry(JSON.parse(trimmed));
		}
	} finally {
		lines.close();
		stream.destroy();
	}
};

export const hasManifestEntries = async (sourceDir: string) => {
	for await (const _entry of streamManifestEntries(sourceDir)) {
		return true;
	}
	return false;
};
