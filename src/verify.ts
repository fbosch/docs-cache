import { access, stat } from "node:fs/promises";
import path from "node:path";
import { symbols, ui } from "./cli/ui";
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
			const manifest = await readManifest(directory);
			const missing: string[] = [];
			const sizeMismatch: string[] = [];
			for (const entry of manifest.entries) {
				const filePath = path.join(directory, entry.path);
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
				issues.push(
					label === "source"
						? `missing files: ${missing.length}`
						: `target missing files: ${missing.length}`,
				);
			}
			if (sizeMismatch.length > 0) {
				issues.push(
					label === "source"
						? `size mismatch: ${sizeMismatch.length}`
						: `target size mismatch: ${sizeMismatch.length}`,
				);
			}
			return {
				ok: issues.length === 0,
				issues,
			};
		} catch (error) {
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
				const targetDir = path.resolve(
					path.dirname(resolvedPath),
					source.targetDir,
				);
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
