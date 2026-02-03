import { rm } from "node:fs/promises";
import type { DocsCacheConfig } from "../config";
import {
	mergeConfigBase,
	readConfigAtPath,
	resolveConfigTarget,
	writeConfigFile,
} from "../config/config-io";
import { resolveTargetDir } from "../paths";
import { resolveRepoInput } from "../resolve-repo";

const resolveIdsToRemove = (ids: string[], config: DocsCacheConfig) => {
	const sourcesById = new Map(
		config.sources.map((source) => [source.id, source]),
	);
	const sourcesByRepo = new Map(
		config.sources.map((source) => [source.repo, source]),
	);
	const idsToRemove = new Set<string>();
	const missing: string[] = [];
	for (const token of ids) {
		if (sourcesById.has(token)) {
			idsToRemove.add(token);
			continue;
		}
		const resolved = resolveRepoInput(token);
		if (resolved.repoUrl && sourcesByRepo.has(resolved.repoUrl)) {
			const source = sourcesByRepo.get(resolved.repoUrl);
			if (source) {
				idsToRemove.add(source.id);
			}
			continue;
		}
		if (resolved.inferredId && sourcesById.has(resolved.inferredId)) {
			idsToRemove.add(resolved.inferredId);
			continue;
		}
		missing.push(token);
	}
	return { idsToRemove, missing };
};

const removeTargets = async (
	resolvedPath: string,
	removedSources: DocsCacheConfig["sources"],
) => {
	const targetRemovals: Array<{ id: string; targetDir: string }> = [];
	for (const source of removedSources) {
		if (!source.targetDir) {
			continue;
		}
		const targetDir = resolveTargetDir(resolvedPath, source.targetDir);
		await rm(targetDir, { recursive: true, force: true });
		targetRemovals.push({ id: source.id, targetDir });
	}
	return targetRemovals;
};

export const removeSources = async (params: {
	configPath?: string;
	ids: string[];
}) => {
	if (params.ids.length === 0) {
		throw new Error("No sources specified to remove.");
	}
	const target = await resolveConfigTarget(params.configPath);
	const resolvedPath = target.resolvedPath;
	const { config, rawConfig, rawPackage } = await readConfigAtPath(target);
	const { idsToRemove, missing } = resolveIdsToRemove(params.ids, config);
	const remaining = config.sources.filter(
		(source) => !idsToRemove.has(source.id),
	);
	const removed = config.sources
		.filter((source) => idsToRemove.has(source.id))
		.map((source) => source.id);
	const removedSources = config.sources.filter((source) =>
		idsToRemove.has(source.id),
	);

	if (removed.length === 0) {
		throw new Error("No matching sources found to remove.");
	}

	const nextConfig = mergeConfigBase(rawConfig ?? config, remaining);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	const targetRemovals = await removeTargets(resolvedPath, removedSources);

	return {
		configPath: resolvedPath,
		removed,
		missing,
		targetsRemoved: targetRemovals,
	};
};
