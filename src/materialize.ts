import { createHash } from "node:crypto";
import {
	access,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
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
	concurrency?: number;
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

		// Pre-validate files and compute total size
		let totalBytes = 0;
		const fileInfos: Array<{
			relativePath: string;
			normalizedPath: string;
			size: number;
		}> = [];

		for (const relativePath of files) {
			const filePath = path.join(params.repoDir, relativePath);
			const stats = await lstat(filePath);
			if (stats.isSymbolicLink()) {
				continue;
			}
			if (
				params.maxFiles !== undefined &&
				fileInfos.length + 1 > params.maxFiles
			) {
				throw new Error(
					`Materialized content exceeds maxFiles (${params.maxFiles}).`,
				);
			}
			totalBytes += stats.size;
			if (totalBytes > params.maxBytes) {
				throw new Error(
					`Materialized content exceeds maxBytes (${params.maxBytes}).`,
				);
			}
			fileInfos.push({
				relativePath,
				normalizedPath: normalizePath(relativePath),
				size: stats.size,
			});
		}

		// Copy files with concurrency control
		const concurrency = params.concurrency ?? 10;
		const manifest: Array<{ path: string; size: number }> = [];
		let index = 0;

		const copyNext = async () => {
			while (index < fileInfos.length) {
				const current = index++;
				const fileInfo = fileInfos[current];
				const filePath = path.join(params.repoDir, fileInfo.relativePath);
				const targetPath = path.join(tempDir, fileInfo.relativePath);
				ensureSafePath(tempDir, targetPath);
				await mkdir(path.dirname(targetPath), { recursive: true });
				// Use copyFile for better performance (doesn't load entire file into memory)
				await copyFile(filePath, targetPath);
				manifest.push({
					path: fileInfo.normalizedPath,
					size: fileInfo.size,
				});
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(concurrency, fileInfos.length) }, copyNext),
		);

		// Sort manifest by path for deterministic output
		manifest.sort((a, b) => a.path.localeCompare(b.path));

		const manifestData = `${JSON.stringify(manifest, null, 2)}\n`;
		await writeFile(path.join(tempDir, "manifest.json"), manifestData, "utf8");

		// Compute SHA256 hash of manifest for integrity verification
		const manifestSha256 = createHash("sha256")
			.update(manifestData)
			.digest("hex");

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
					} catch (restoreError) {
						// Log but don't fail - the original error is more important
						const restoreMsg =
							restoreError instanceof Error
								? restoreError.message
								: String(restoreError);
						process.stderr.write(
							`Warning: Failed to restore backup: ${restoreMsg}\n`,
						);
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
			bytes: totalBytes,
			fileCount: manifest.length,
			manifestSha256,
		};
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}
};
