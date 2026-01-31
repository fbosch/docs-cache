import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocsCacheResolvedSource } from "./config";
import type { DocsCacheLock } from "./lock";
import { DEFAULT_INDEX_FILENAME, toPosixPath } from "./paths";

type IndexSource = {
	repo: string;
	ref: string;
	resolvedCommit: string;
	bytes: number;
	fileCount: number;
	manifestSha256: string;
	updatedAt: string;
	cachePath: string;
	targetDir?: string;
};

type DocsCacheIndex = {
	generatedAt: string;
	cacheDir: string;
	sources: Record<string, IndexSource>;
};

export const writeIndex = async (params: {
	cacheDir: string;
	configPath: string;
	lock: DocsCacheLock;
	sources: DocsCacheResolvedSource[];
}) => {
	const sourcesById = new Map(
		params.sources.map((source) => [source.id, source]),
	);
	const sourceEntries: Record<string, IndexSource> = {};
	for (const [id, entry] of Object.entries(params.lock.sources)) {
		const source = sourcesById.get(id);
		const targetDir = source?.targetDir
			? toPosixPath(
					path.resolve(path.dirname(params.configPath), source.targetDir),
				)
			: undefined;
		sourceEntries[id] = {
			repo: entry.repo,
			ref: entry.ref,
			resolvedCommit: entry.resolvedCommit,
			bytes: entry.bytes,
			fileCount: entry.fileCount,
			manifestSha256: entry.manifestSha256,
			updatedAt: entry.updatedAt,
			cachePath: toPosixPath(path.join(params.cacheDir, id)),
			...(targetDir ? { targetDir } : {}),
		};
	}
	const index: DocsCacheIndex = {
		generatedAt: new Date().toISOString(),
		cacheDir: toPosixPath(params.cacheDir),
		sources: sourceEntries,
	};
	const indexPath = path.join(params.cacheDir, DEFAULT_INDEX_FILENAME);
	const data = `${JSON.stringify(index, null, 2)}\n`;
	await writeFile(indexPath, data, "utf8");
};
