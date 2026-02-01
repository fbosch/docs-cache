import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocsCacheResolvedSource } from "./config";
import type { DocsCacheLock } from "./lock";
import { DEFAULT_TOC_FILENAME, resolveTargetDir, toPosixPath } from "./paths";

type TocEntry = {
	id: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	fileCount: number;
	cachePath: string;
	targetDir?: string;
	files: string[];
};

const generateSourceToc = (entry: TocEntry): string => {
	const lines: string[] = [];
	lines.push(`# ${entry.id} - Documentation`);
	lines.push("");
	lines.push(`- **Repository**: ${entry.repo}`);
	lines.push(`- **Ref**: ${entry.ref}`);
	lines.push(`- **Commit**: ${entry.resolvedCommit}`);
	lines.push("");
	lines.push("## Files");
	lines.push("");

	for (const file of [...entry.files].sort()) {
		lines.push(`- [${file}](./${file})`);
	}
	lines.push("");

	return lines.join("\n");
};

const readManifest = async (sourceDir: string): Promise<string[]> => {
	const manifestPath = path.join(sourceDir, ".manifest.jsonl");
	try {
		const raw = await readFile(manifestPath, "utf8");
		const files: string[] = [];
		for (const line of raw.split("\n")) {
			if (line.trim()) {
				const entry = JSON.parse(line);
				if (entry.path) {
					files.push(entry.path);
				}
			}
		}
		return files;
	} catch {
		return [];
	}
};

export const writeToc = async (params: {
	cacheDir: string;
	configPath: string;
	lock: DocsCacheLock;
	sources: DocsCacheResolvedSource[];
}) => {
	const sourcesById = new Map(
		params.sources.map((source) => [source.id, source]),
	);

	for (const [id, lockEntry] of Object.entries(params.lock.sources)) {
		const source = sourcesById.get(id);
		const targetDir = source?.targetDir
			? toPosixPath(resolveTargetDir(params.configPath, source.targetDir))
			: undefined;

		const sourceDir = path.join(params.cacheDir, id);
		const files = await readManifest(sourceDir);

		const entry: TocEntry = {
			id,
			repo: lockEntry.repo,
			ref: lockEntry.ref,
			resolvedCommit: lockEntry.resolvedCommit,
			fileCount: lockEntry.fileCount,
			cachePath: toPosixPath(path.join(params.cacheDir, id)),
			targetDir,
			files,
		};

		// Generate per-source TOC if the source has TOC enabled
		const sourceToc = source?.toc ?? false;
		if (sourceToc) {
			const sourceTocPath = path.join(sourceDir, DEFAULT_TOC_FILENAME);
			const sourceTocContent = generateSourceToc(entry);
			await writeFile(sourceTocPath, sourceTocContent, "utf8");
		}
	}
};
