import { access, stat } from "node:fs/promises";
import path from "node:path";
import { symbols, ui } from "./cli/ui";
import { DEFAULT_CACHE_DIR, loadConfig } from "./config";
import { streamManifestEntries } from "./manifest";
import { resolveCacheDir, resolveTargetDir } from "./paths";

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

	const verifyDir = async (directory: string, label: "source" | "target") => {
		if (!(await exists(directory))) {
			return {
				ok: false,
				issues: [
					label === "source"
						? "missing source directory"
						: "missing target directory",
				],
			};
		}
		try {
			let missingCount = 0;
			let sizeMismatchCount = 0;
			for await (const entry of streamManifestEntries(directory)) {
				const filePath = path.join(directory, entry.path);
				try {
					const info = await stat(filePath);
					if (info.size !== entry.size) {
						sizeMismatchCount += 1;
					}
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "ENOENT" || code === "ENOTDIR") {
						missingCount += 1;
						continue;
					}
					throw error;
				}
			}
			const issues: string[] = [];
			if (missingCount > 0) {
				issues.push(
					label === "source"
						? `missing files: ${missingCount}`
						: `target missing files: ${missingCount}`,
				);
			}
			if (sizeMismatchCount > 0) {
				issues.push(
					label === "source"
						? `size mismatch: ${sizeMismatchCount}`
						: `target size mismatch: ${sizeMismatchCount}`,
				);
			}
			return {
				ok: issues.length === 0,
				issues,
			};
		} catch (_error) {
			return {
				ok: false,
				issues: [
					label === "source" ? "missing manifest" : "missing target manifest",
				],
			};
		}
	};

	const results = await Promise.all(
		sources.map(async (source) => {
			const sourceDir = path.join(cacheDir, source.id);
			const sourceReport = await verifyDir(sourceDir, "source");
			const issues = [...sourceReport.issues];
			if (source.targetDir && source.targetMode === "copy") {
				const targetDir = resolveTargetDir(resolvedPath, source.targetDir);
				const targetReport = await verifyDir(targetDir, "target");
				issues.push(...targetReport.issues);
			}
			return {
				id: source.id,
				ok: issues.length === 0,
				issues,
			};
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

	if (report.results.length === 0) {
		ui.line(`${symbols.warn} No sources to verify.`);
		return;
	}

	ui.line(
		`${symbols.info} Verified ${report.results.length} sources (${okCount} ok, ${failCount} failed)`,
	);

	for (const result of report.results) {
		if (result.ok) {
			ui.item(symbols.success, result.id);
		} else {
			ui.item(symbols.warn, result.id, result.issues.join(", "));
		}
	}
};
