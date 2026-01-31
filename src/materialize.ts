import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	open,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

import { getCacheLayout, toPosixPath } from "./paths";
import { assertSafeSourceId } from "./source-id";

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

const openFileNoFollow = async (filePath: string) => {
	try {
		return await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ELOOP") {
			return null;
		}
		if (code === "EINVAL" || code === "ENOSYS" || code === "ENOTSUP") {
			const stats = await lstat(filePath);
			if (stats.isSymbolicLink()) {
				return null;
			}
			return await open(filePath, "r");
		}
		throw error;
	}
};

const acquireLock = async (lockPath: string, timeoutMs = 5000) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const fd = await open(lockPath, "wx");
			return {
				release: async () => {
					await fd.close();
					await rm(lockPath, { force: true });
				},
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Failed to acquire lock for ${lockPath}.`);
};

export const materializeSource = async (params: MaterializeParams) => {
	assertSafeSourceId(params.sourceId, "sourceId");
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
			const fileHandle = await openFileNoFollow(filePath);
			if (!fileHandle) {
				continue;
			}
			try {
				const stats = await fileHandle.stat();
				if (!stats.isFile()) {
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
				const data = await fileHandle.readFile();
				await writeFile(targetPath, data);
				manifest.push({ path: relNormalized, size: stats.size });
			} finally {
				await fileHandle.close();
			}
		}

		manifest.sort((left, right) => left.path.localeCompare(right.path));
		const manifestJson = JSON.stringify(manifest, null, 2);
		const manifestSha256 = createHash("sha256")
			.update(manifestJson)
			.digest("hex");
		const manifestData = `${manifestJson}\n`;
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
			const lock = await acquireLock(`${target}.lock`);
			try {
				const hasTarget = await exists(target);
				const backupPath = `${target}.bak-${randomBytes(8).toString("hex")}`;
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
			} finally {
				await lock.release();
			}
		};

		await replaceDirectory(tempDir, layout.sourceDir);
		return {
			bytes,
			fileCount: manifest.length,
			manifestSha256,
		};
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}
};
