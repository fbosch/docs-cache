import { access, readFile, rm, writeFile } from "node:fs/promises";
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

type TocFileEntry = {
	name: string;
	path: string;
};

type TocTree = {
	dirs: Map<string, TocTree>;
	files: TocFileEntry[];
};

const createTocTree = (files: string[]): TocTree => {
	const root: TocTree = { dirs: new Map(), files: [] };

	for (const file of files) {
		const parts = file.split("/").filter(Boolean);
		if (parts.length === 0) {
			continue;
		}

		let node = root;
		for (const part of parts.slice(0, -1)) {
			let child = node.dirs.get(part);
			if (!child) {
				child = { dirs: new Map(), files: [] };
				node.dirs.set(part, child);
			}
			node = child;
		}

		const name = parts[parts.length - 1];
		node.files.push({ name, path: file });
	}

	return root;
};

const renderTocTree = (tree: TocTree, depth: number, lines: string[]) => {
	const indent = "  ".repeat(depth);
	const dirNames = Array.from(tree.dirs.keys()).sort();
	const files = [...tree.files].sort((a, b) => a.name.localeCompare(b.name));

	for (const dirName of dirNames) {
		lines.push(`${indent}- ${dirName}/`);
		const child = tree.dirs.get(dirName);
		if (child) {
			renderTocTree(child, depth + 1, lines);
		}
	}

	for (const file of files) {
		lines.push(`${indent}- [${file.name}](./${file.path})`);
	}
};

const generateSourceToc = (entry: TocEntry): string => {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`id: ${entry.id}`);
	lines.push(`repository: ${entry.repo}`);
	lines.push(`ref: ${entry.ref}`);
	lines.push(`commit: ${entry.resolvedCommit}`);
	if (entry.targetDir) {
		lines.push(`targetDir: ${entry.targetDir}`);
	}
	lines.push("---");
	lines.push("");
	lines.push(`# ${entry.id} - Documentation`);
	lines.push("");
	lines.push("## Files");
	lines.push("");
	const tree = createTocTree(entry.files);
	renderTocTree(tree, 0, lines);
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
	results?: Array<{ id: string; status: "up-to-date" | "changed" | "missing" }>;
}) => {
	const sourcesById = new Map(
		params.sources.map((source) => [source.id, source]),
	);
	const resultsById = new Map(
		(params.results ?? []).map((result) => [result.id, result]),
	);

	for (const [id, lockEntry] of Object.entries(params.lock.sources)) {
		const source = sourcesById.get(id);
		const targetDir = source?.targetDir
			? toPosixPath(resolveTargetDir(params.configPath, source.targetDir))
			: undefined;

		const sourceDir = path.join(params.cacheDir, id);

		// Check if source directory exists (might not exist for offline/missing optional sources)
		try {
			await access(sourceDir);
		} catch {
			// Source directory doesn't exist, skip TOC generation
			continue;
		}

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
		const sourceToc = source?.toc ?? true;
		const sourceTocPath = path.join(sourceDir, DEFAULT_TOC_FILENAME);

		if (sourceToc) {
			const result = resultsById.get(id);
			if (result?.status === "up-to-date") {
				try {
					await access(sourceTocPath);
					continue;
				} catch {
					// Missing TOC; regenerate below.
				}
			}
			const sourceTocContent = generateSourceToc(entry);
			await writeFile(sourceTocPath, sourceTocContent, "utf8");
		} else {
			// Remove TOC.md if it exists but toc is disabled
			try {
				await rm(sourceTocPath, { force: true });
			} catch {
				// Ignore errors if file doesn't exist
			}
		}
	}
};
