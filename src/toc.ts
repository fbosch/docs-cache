import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { symbols, ui } from "./cli/ui";
import type { DocsCacheResolvedSource, TocFormat } from "./config";
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

const renderCompressedToc = (
	files: string[],
	lines: string[],
	label: string,
) => {
	// Group files by directory in Vercel AGENTS.md style
	// Format: [Label]|dir1:{file1,file2}|dir2:{file3,file4}

	// Sort files alphabetically
	const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));

	// Group files by directory
	const dirGroups = new Map<string, string[]>();

	for (const file of sortedFiles) {
		const lastSlash = file.lastIndexOf("/");
		const dir = lastSlash === -1 ? "" : file.substring(0, lastSlash);
		const filename = lastSlash === -1 ? file : file.substring(lastSlash + 1);

		const existing = dirGroups.get(dir);
		if (existing) {
			existing.push(filename);
		} else {
			dirGroups.set(dir, [filename]);
		}
	}

	// Sort directories alphabetically
	const sortedDirs = Array.from(dirGroups.keys()).sort();

	// Build pipe-separated format
	const segments: string[] = [];

	// Add label as first segment
	segments.push(`[${label}]`);

	for (const dir of sortedDirs) {
		const filesInDir = dirGroups.get(dir);
		if (!filesInDir) continue;
		const fileList = filesInDir.join(",");
		if (dir === "") {
			// Root directory
			segments.push(`root:{${fileList}}`);
		} else {
			segments.push(`${dir}:{${fileList}}`);
		}
	}

	// Add as a single line
	lines.push(segments.join("|"));
};

const generateSourceToc = (
	entry: TocEntry,
	format: TocFormat = "compressed",
): string => {
	const lines: string[] = [];

	if (format === "tree") {
		// For tree format, keep the headers for readability
		lines.push(`# ${entry.id} - Documentation`);
		lines.push("");
		lines.push("## Files");
		lines.push("");
		const tree = createTocTree(entry.files);
		renderTocTree(tree, 0, lines);
	} else {
		// compressed format - no headers, just the label and content
		const label = `${entry.id} Docs Index`;
		renderCompressedToc(entry.files, lines, label);
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

		// Determine if TOC should be generated and what format to use
		const sourceTocConfig = source?.toc;

		// Determine if TOC is enabled (default: true)
		const tocEnabled = sourceTocConfig !== false;

		// Determine TOC format
		let tocFormat: TocFormat = "compressed"; // default
		if (typeof sourceTocConfig === "string") {
			tocFormat = sourceTocConfig;
		}

		const sourceTocPath = path.join(sourceDir, DEFAULT_TOC_FILENAME);

		if (tocEnabled) {
			const result = resultsById.get(id);
			if (result?.status === "up-to-date") {
				try {
					await access(sourceTocPath);
					continue;
				} catch {
					// Missing TOC; regenerate below.
				}
			}
			let existingContent: string | null = null;
			try {
				existingContent = await readFile(sourceTocPath, "utf8");
			} catch {
				existingContent = null;
			}
			const sourceTocContent = generateSourceToc(entry, tocFormat);
			if (existingContent !== null && existingContent !== sourceTocContent) {
				ui.line(
					`${symbols.warn} Overwriting existing ${DEFAULT_TOC_FILENAME} for ${id}`,
				);
			}
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
