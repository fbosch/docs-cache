import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
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
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import fg from "fast-glob";
import { symbols, ui } from "./cli/ui";
import { getErrnoCode } from "./errors";
import { MANIFEST_FILENAME } from "./manifest";
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
	ignoreHidden?: boolean;
	unwrapSingleRootDir?: boolean;
};

type ResolvedMaterializeParams = {
	sourceId: string;
	repoDir: string;
	cacheDir: string;
	include: string[];
	exclude: string[];
	maxBytes: number;
	maxFiles?: number;
	ignoreHidden: boolean;
	unwrapSingleRootDir: boolean;
};

type ManifestStats = {
	bytes: number;
	fileCount: number;
	manifestSha256: string;
};

const normalizePath = (value: string) => toPosixPath(value);

const escapeParens = (value: string) => {
	let output = "";
	let escaped = false;
	for (const char of value) {
		if (escaped) {
			output += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			output += char;
			escaped = true;
			continue;
		}
		if (char === "(" || char === ")") {
			output += `\\${char}`;
			continue;
		}
		output += char;
	}
	return output;
};

const normalizeIncludePatterns = (patterns: string[]) => {
	return patterns.map((pattern) => {
		let decoded = pattern;
		if (pattern.includes("%")) {
			try {
				decoded = decodeURIComponent(pattern);
			} catch {
				decoded = pattern;
			}
		}
		const hasExtGlob = /(^|[^\\])[@!+?*]\(/.test(decoded);
		return hasExtGlob ? decoded : escapeParens(decoded);
	});
};

const STREAM_COPY_THRESHOLD_MB = Number(
	process.env.DOCS_CACHE_STREAM_THRESHOLD_MB ?? "2",
);
const STREAM_COPY_THRESHOLD_BYTES =
	Number.isFinite(STREAM_COPY_THRESHOLD_MB) && STREAM_COPY_THRESHOLD_MB > 0
		? Math.floor(STREAM_COPY_THRESHOLD_MB * 1024 * 1024)
		: 1024 * 1024;

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
		const code = getErrnoCode(error);
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

const resolveUnwrapPrefix = (
	entries: Array<{ normalized: string }>,
	unwrapSingleRootDir?: boolean,
) => {
	if (!unwrapSingleRootDir || entries.length === 0) {
		return null;
	}
	let prefix = "";
	while (true) {
		let rootDir: string | null = null;
		for (const entry of entries) {
			const remaining = prefix
				? entry.normalized.slice(prefix.length)
				: entry.normalized;
			const parts = remaining.split("/");
			if (parts.length < 2) {
				return prefix || null;
			}
			const nextRoot = parts[0];
			if (!rootDir) {
				rootDir = nextRoot;
				continue;
			}
			if (rootDir !== nextRoot) {
				return prefix || null;
			}
		}
		if (!rootDir) {
			return prefix || null;
		}
		const nextPrefix = `${prefix}${rootDir}/`;
		if (nextPrefix === prefix) {
			return prefix || null;
		}
		prefix = nextPrefix;
	}
};

const resolveMaterializeParams = (
	params: MaterializeParams,
): ResolvedMaterializeParams => ({
	...params,
	exclude: params.exclude ?? [],
	ignoreHidden: params.ignoreHidden ?? false,
	unwrapSingleRootDir: params.unwrapSingleRootDir ?? false,
});

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
			const code = getErrnoCode(error);
			if (code !== "EEXIST") {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Failed to acquire lock for ${lockPath}.`);
};

export const materializeSource = async (params: MaterializeParams) => {
	const resolved = resolveMaterializeParams(params);
	assertSafeSourceId(resolved.sourceId, "sourceId");
	const layout = getCacheLayout(resolved.cacheDir, resolved.sourceId);
	await mkdir(resolved.cacheDir, { recursive: true });
	const tempDir = await mkdtemp(
		path.join(resolved.cacheDir, `.tmp-${resolved.sourceId}-`),
	);
	let manifestStreamRef: ReturnType<typeof createWriteStream> | null = null;
	const closeManifestStream = async () => {
		const stream = manifestStreamRef;
		if (!stream || stream.closed || stream.destroyed) {
			return;
		}
		await new Promise<void>((resolve) => {
			const cleanup = () => {
				stream.off("close", onClose);
				stream.off("error", onError);
				resolve();
			};
			const onClose = () => cleanup();
			const onError = () => cleanup();
			stream.once("close", onClose);
			stream.once("error", onError);
			try {
				stream.end();
			} catch {
				cleanup();
			}
		});
	};

	try {
		const ignorePatterns = [
			".git/**",
			...(resolved.ignoreHidden ? [".*", "**/.*", "**/.*/**"] : []),
			...resolved.exclude,
		];
		const includePatterns = normalizeIncludePatterns(resolved.include);
		const files = await fg(includePatterns, {
			cwd: resolved.repoDir,
			ignore: ignorePatterns,
			dot: true,
			onlyFiles: true,
			followSymbolicLinks: false,
		});
		if (includePatterns.length > 0 && files.length === 0) {
			ui.line(
				`${symbols.warn} No files matched include patterns for ${resolved.sourceId}: ${includePatterns.join(", ")}`,
			);
		}
		const entries = files
			.map((relativePath) => ({
				relativePath,
				normalized: normalizePath(relativePath),
			}))
			.sort((left, right) => left.normalized.localeCompare(right.normalized));
		const unwrapPrefix = resolveUnwrapPrefix(
			entries,
			resolved.unwrapSingleRootDir,
		);
		const targetDirs = new Set<string>();
		for (const { normalized } of entries) {
			const rootPath = unwrapPrefix
				? normalized.slice(unwrapPrefix.length)
				: normalized;
			targetDirs.add(path.posix.dirname(rootPath));
		}
		await Promise.all(
			Array.from(targetDirs, (dir) =>
				mkdir(path.join(tempDir, dir), { recursive: true }),
			),
		);
		let bytes = 0;
		let fileCount = 0;
		const concurrency = Math.max(
			1,
			Math.min(
				entries.length,
				Math.max(8, Math.min(128, os.cpus().length * 8)),
			),
		);
		const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
		const manifestStream = createWriteStream(manifestPath, {
			encoding: "utf8",
		});
		manifestStreamRef = manifestStream;
		const manifestHash = createHash("sha256");
		const writeManifestLine = async (line: string) => {
			return new Promise<void>((resolve, reject) => {
				const onError = (error: Error) => {
					manifestStream.off("drain", onDrain);
					reject(error);
				};
				const onDrain = () => {
					manifestStream.off("error", onError);
					resolve();
				};
				manifestStream.once("error", onError);
				if (!manifestStream.write(line)) {
					manifestStream.once("drain", onDrain);
				} else {
					manifestStream.off("error", onError);
					resolve();
				}
			});
		};

		for (let i = 0; i < entries.length; i += concurrency) {
			const batch = entries.slice(i, i + concurrency);
			const results = await Promise.all(
				batch.map(async (entry) => {
					const filePath = path.join(resolved.repoDir, entry.relativePath);
					const fileHandle = await openFileNoFollow(filePath);
					if (!fileHandle) {
						return null;
					}
					try {
						const stats = await fileHandle.stat();
						if (!stats.isFile()) {
							return null;
						}
						const normalizedPath = unwrapPrefix
							? entry.normalized.slice(unwrapPrefix.length)
							: entry.normalized;
						const targetPath = path.join(tempDir, normalizedPath);
						ensureSafePath(tempDir, targetPath);
						if (stats.size >= STREAM_COPY_THRESHOLD_BYTES) {
							const reader = createReadStream(filePath, {
								fd: fileHandle.fd,
								autoClose: false,
							});
							const writer = createWriteStream(targetPath);
							await pipeline(reader, writer);
						} else {
							const data = await fileHandle.readFile();
							await writeFile(targetPath, data);
						}
						return {
							path: unwrapPrefix
								? entry.normalized.slice(unwrapPrefix.length)
								: entry.normalized,
							size: stats.size,
						};
					} finally {
						await fileHandle.close();
					}
				}),
			);
			for (const entry of results) {
				if (!entry) {
					continue;
				}
				if (
					resolved.maxFiles !== undefined &&
					fileCount + 1 > resolved.maxFiles
				) {
					throw new Error(
						`Materialized content exceeds maxFiles (${resolved.maxFiles}).`,
					);
				}
				bytes += entry.size;
				if (bytes > resolved.maxBytes) {
					throw new Error(
						`Materialized content exceeds maxBytes (${resolved.maxBytes}).`,
					);
				}
				const line = `${JSON.stringify(entry)}\n`;
				manifestHash.update(line);
				await writeManifestLine(line);
				fileCount += 1;
			}
		}
		await new Promise<void>((resolve, reject) => {
			manifestStream.end(() => resolve());
			manifestStream.once("error", reject);
		});
		const manifestSha256 = manifestHash.digest("hex");

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
			fileCount,
			manifestSha256,
		};
	} catch (error) {
		try {
			await closeManifestStream();
		} catch {
			// Ignore cleanup errors to preserve root cause.
		}
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}
};

export const computeManifestHash = async (
	params: MaterializeParams,
): Promise<ManifestStats> => {
	assertSafeSourceId(params.sourceId, "sourceId");
	const includePatterns = normalizeIncludePatterns(params.include);
	const files = await fg(includePatterns, {
		cwd: params.repoDir,
		ignore: [
			".git/**",
			...(params.ignoreHidden ? [".*", "**/.*", "**/.*/**"] : []),
			...(params.exclude ?? []),
		],
		dot: true,
		onlyFiles: true,
		followSymbolicLinks: false,
	});
	files.sort((left, right) =>
		normalizePath(left).localeCompare(normalizePath(right)),
	);
	let bytes = 0;
	let fileCount = 0;
	const manifestHash = createHash("sha256");
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
			if (params.maxFiles !== undefined && fileCount + 1 > params.maxFiles) {
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
			const line = `${JSON.stringify({ path: relNormalized, size: stats.size })}\n`;
			manifestHash.update(line);
			fileCount += 1;
		} finally {
			await fileHandle.close();
		}
	}
	return {
		bytes,
		fileCount,
		manifestSha256: manifestHash.digest("hex"),
	};
};
