import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocsCacheResolvedSource } from "./config";
import type { DocsCacheLock } from "./lock";
import { resolveTargetDir, toPosixPath } from "./paths";

export const DEFAULT_TOC_FILENAME = "TOC.md";

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

const generateGlobalToc = (entries: TocEntry[], _cacheDir: string): string => {
	const lines: string[] = [];
	lines.push("# Documentation Cache - Table of Contents");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push("");
	lines.push("## Cached Sources");
	lines.push("");

	for (const entry of entries) {
		lines.push(`### ${entry.id}`);
		lines.push("");
		lines.push(`- **Repository**: ${entry.repo}`);
		lines.push(`- **Ref**: ${entry.ref}`);
		lines.push(`- **Commit**: ${entry.resolvedCommit}`);
		lines.push(`- **Files**: ${entry.fileCount}`);
		lines.push(`- **Cache Path**: ${entry.cachePath}`);
		if (entry.targetDir) {
			lines.push(`- **Target Directory**: ${entry.targetDir}`);
		}
		lines.push(`- **Source TOC**: [${entry.id}/TOC.md](${entry.id}/TOC.md)`);
		lines.push("");
	}

	return lines.join("\n");
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

	for (const file of entry.files.sort()) {
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
	globalToc: boolean;
}) => {
	const sourcesById = new Map(
		params.sources.map((source) => [source.id, source]),
	);

	const entries: TocEntry[] = [];

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

		entries.push(entry);

		// Generate per-source TOC if the source has toc enabled or if global toc is enabled
		const sourceToc = source?.toc ?? false;
		if (sourceToc || params.globalToc) {
			const sourceTocPath = path.join(sourceDir, DEFAULT_TOC_FILENAME);
			const sourceTocContent = generateSourceToc(entry);
			await writeFile(sourceTocPath, sourceTocContent, "utf8");
		}
	}

	// Generate global TOC if enabled
	if (params.globalToc) {
		const globalTocPath = path.join(params.cacheDir, DEFAULT_TOC_FILENAME);
		const globalTocContent = generateGlobalToc(entries, params.cacheDir);
		await writeFile(globalTocPath, globalTocContent, "utf8");
	}
};
