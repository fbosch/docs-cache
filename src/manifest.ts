import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

type ManifestEntry = {
	path: string;
	size: number;
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
			entries.push(JSON.parse(trimmed) as ManifestEntry);
		}
		return { manifestPath, entries };
	} finally {
		lines.close();
		stream.destroy();
	}
};

export const streamManifestEntries = async function* (sourceDir: string) {
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
			yield JSON.parse(trimmed) as ManifestEntry;
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
