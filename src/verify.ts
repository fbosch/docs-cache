import { access, stat } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_CACHE_DIR, loadConfig } from "./config";
import { readManifest } from "./manifest";
import { resolveCacheDir } from "./paths";

type VerifyOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const verifyCache = async (options: VerifyOptions) => {
	const { config, resolvedPath, sources } = await loadConfig(
		options.configPath,
	);
	const cacheDir = resolveCacheDir(
		resolvedPath,
		config.cacheDir ?? DEFAULT_CACHE_DIR,
		options.cacheDirOverride,
	);

	const results = await Promise.all(
		sources.map(async (source) => {
			const sourceDir = path.join(cacheDir, source.id);
			if (!(await exists(sourceDir))) {
				return {
					id: source.id,
					ok: false,
					issues: ["missing source directory"],
				};
			}
			try {
				const manifest = await readManifest(sourceDir);
				const missing: string[] = [];
				const sizeMismatch: string[] = [];
				for (const entry of manifest.entries) {
					const filePath = path.join(sourceDir, entry.path);
					if (!(await exists(filePath))) {
						missing.push(entry.path);
						continue;
					}
					const info = await stat(filePath);
					if (info.size !== entry.size) {
						sizeMismatch.push(entry.path);
					}
				}
				const issues: string[] = [];
				if (missing.length > 0) {
					issues.push(`missing files: ${missing.length}`);
				}
				if (sizeMismatch.length > 0) {
					issues.push(`size mismatch: ${sizeMismatch.length}`);
				}
				return {
					id: source.id,
					ok: issues.length === 0,
					issues,
				};
			} catch (error) {
				return {
					id: source.id,
					ok: false,
					issues: ["missing manifest"],
				};
			}
		}),
	);

	return {
		cacheDir,
		results,
	};
};

export const printVerify = (
	report: Awaited<ReturnType<typeof verifyCache>>,
) => {
	const okCount = report.results.filter((r) => r.ok).length;
	const failCount = report.results.length - okCount;
	process.stdout.write(
		`Verified ${report.results.length} sources (${okCount} ok, ${failCount} failed)\n`,
	);
	for (const result of report.results) {
		if (result.ok) {
			process.stdout.write(`✔ ${result.id}\n`);
		} else {
			process.stdout.write(`✖ ${result.id}: ${result.issues.join(", ")}\n`);
		}
	}
};
