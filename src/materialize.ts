import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

import { getCacheLayout, toPosixPath } from "./paths";

type MaterializeParams = {
	sourceId: string;
	repoDir: string;
	cacheDir: string;
	include: string[];
	exclude?: string[];
	maxBytes: number;
	maxFiles?: number;
};

const normalizePath = (value: string) => toPosixPath(value);

const ensureSafePath = (root: string, target: string) => {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(target);
	if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
		throw new Error(`Path traversal detected: ${target}`);
	}
};

export const materializeSource = async (params: MaterializeParams) => {
	const layout = getCacheLayout(params.cacheDir, params.sourceId);
	await mkdir(params.cacheDir, { recursive: true });
	const tempDir = await mkdtemp(
		path.join(params.cacheDir, `.tmp-${params.sourceId}-`),
	);

	try {
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
			if (
				params.maxFiles !== undefined &&
				manifest.length + 1 > params.maxFiles
			) {
				throw new Error(
					`Materialized content exceeds maxFiles (${params.maxFiles}).`,
				);
			}
			bytes += stats.size;
			if (bytes > params.maxBytes) {
				throw new Error(
					`Materialized content exceeds maxBytes (${params.maxBytes}).`,
				);
			}
			const targetPath = path.join(tempDir, relativePath);
			ensureSafePath(tempDir, targetPath);
			await mkdir(path.dirname(targetPath), { recursive: true });
			const data = await readFile(filePath);
			await writeFile(targetPath, data);
			manifest.push({ path: relNormalized, size: stats.size });
		}

		const manifestData = `${JSON.stringify(manifest, null, 2)}\n`;
		await writeFile(path.join(tempDir, "manifest.json"), manifestData, "utf8");

		const exists = async (target: string) => {
			try {
				await access(target);
				return true;
			} catch {
				return false;
			}
		};

		const replaceDirectory = async (source: string, target: string) => {
			const hasTarget = await exists(target);
			const backupPath = `${target}.bak-${Date.now().toString(36)}`;
			if (hasTarget) {
				await rename(target, backupPath);
			}
			try {
				await rename(source, target);
			} catch (error) {
				if (hasTarget) {
					try {
						await rename(backupPath, target);
					} catch {
						// ignore restore failures
					}
				}
				throw error;
			}
			if (hasTarget) {
				await rm(backupPath, { recursive: true, force: true });
			}
		};

		await replaceDirectory(tempDir, layout.sourceDir);
		return {
			bytes,
			fileCount: manifest.length,
		};
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}
};
