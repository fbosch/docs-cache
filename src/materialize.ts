import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

import { getCacheLayout } from "./paths";

type MaterializeParams = {
	sourceId: string;
	repoDir: string;
	cacheDir: string;
	include: string[];
	exclude?: string[];
	maxBytes: number;
};

const normalizePath = (value: string) => value.split(path.sep).join("/");

const ensureSafePath = (root: string, target: string) => {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(target);
	if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
		throw new Error(`Path traversal detected: ${target}`);
	}
};

export const materializeSource = async (params: MaterializeParams) => {
	const layout = getCacheLayout(params.cacheDir, params.sourceId);
	await mkdir(layout.sourceDir, { recursive: true });

	const files = await fg(params.include, {
		cwd: params.repoDir,
		ignore: [".git/**", ...(params.exclude ?? [])],
		dot: true,
		onlyFiles: true,
		followSymbolicLinks: false,
	});
	let bytes = 0;
	const manifest: Array<{ path: string; size: number }> = [];

	for (const relativePath of files) {
		const relNormalized = normalizePath(relativePath);
		const filePath = path.join(params.repoDir, relativePath);
		const stats = await lstat(filePath);
		if (stats.isSymbolicLink()) {
			continue;
		}
		bytes += stats.size;
		if (bytes > params.maxBytes) {
			throw new Error(
				`Materialized content exceeds maxBytes (${params.maxBytes}).`,
			);
		}
		const targetPath = path.join(layout.sourceDir, relativePath);
		ensureSafePath(layout.sourceDir, targetPath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		const data = await readFile(filePath);
		await writeFile(targetPath, data);
		manifest.push({ path: relNormalized, size: stats.size });
	}

	return {
		bytes,
		fileCount: manifest.length,
	};
};
