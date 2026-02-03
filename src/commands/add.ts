import path from "node:path";
import { DEFAULT_CACHE_DIR, type DocsCacheConfig } from "#config";
import {
	mergeConfigBase,
	readConfigAtPath,
	resolveConfigTarget,
	writeConfigFile,
} from "#config/io";
import { ensureGitignoreEntry } from "#core/gitignore";
import { resolveTargetDir } from "#core/paths";
import { assertSafeSourceId } from "#core/source-id";
import { resolveRepoInput } from "#git/resolve-repo";

const buildNewSources = (
	entries: Array<{ id?: string; repo: string; targetDir?: string }>,
	config: DocsCacheConfig,
	resolvedPath: string,
) => {
	const existingIds = new Set(config.sources.map((source) => source.id));
	const skipped: string[] = [];
	const newSources = entries
		.map((entry) => {
			const resolved = resolveRepoInput(entry.repo);
			const sourceId = entry.id || resolved.inferredId;
			if (!sourceId) {
				throw new Error("Unable to infer id. Provide an explicit id.");
			}
			const safeId = assertSafeSourceId(sourceId, "source id");
			if (existingIds.has(safeId)) {
				skipped.push(safeId);
				return null;
			}
			existingIds.add(safeId);
			if (entry.targetDir) {
				resolveTargetDir(resolvedPath, entry.targetDir);
			}
			return {
				id: safeId,
				repo: resolved.repoUrl,
				...(entry.targetDir ? { targetDir: entry.targetDir } : {}),
				...(resolved.ref ? { ref: resolved.ref } : {}),
			};
		})
		.filter(Boolean) as Array<{
		id: string;
		repo: string;
		targetDir?: string;
		ref?: string;
	}>;
	return { newSources, skipped };
};

const ensureGitignore = async (
	resolvedPath: string,
	cacheDir: string,
	shouldWrite: boolean,
) => {
	if (!shouldWrite) {
		return null;
	}
	return ensureGitignoreEntry(path.dirname(resolvedPath), cacheDir);
};

export const addSources = async (params: {
	configPath?: string;
	entries: Array<{ id?: string; repo: string; targetDir?: string }>;
}) => {
	const target = await resolveConfigTarget(params.configPath);
	const resolvedPath = target.resolvedPath;
	const { config, rawConfig, rawPackage, hadDocsCacheConfig } =
		await readConfigAtPath(target, { allowMissing: true });
	const { newSources, skipped } = buildNewSources(
		params.entries,
		config,
		resolvedPath,
	);
	if (newSources.length === 0) {
		throw new Error("All sources already exist in config.");
	}
	const nextConfig = mergeConfigBase(rawConfig ?? config, [
		...config.sources,
		...newSources,
	]);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	const gitignoreResult = await ensureGitignore(
		resolvedPath,
		rawConfig?.cacheDir ?? DEFAULT_CACHE_DIR,
		!hadDocsCacheConfig,
	);

	return {
		configPath: resolvedPath,
		sources: newSources,
		skipped,
		created: true,
		gitignoreUpdated: gitignoreResult?.updated ?? false,
		gitignorePath: gitignoreResult?.gitignorePath ?? null,
	};
};
