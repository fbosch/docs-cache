import type { materializeSource } from "#cache/materialize";
import { getSyncPlan, runSync } from "#commands/sync";
import { loadConfig } from "#config";
import type { fetchSource } from "#git/fetch-source";
import type { resolveRemoteCommit } from "#git/resolve-remote";

type UpdateOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	ids: string[];
	all: boolean;
	dryRun: boolean;
	json: boolean;
	lockOnly: boolean;
	failOnMiss: boolean;
	timeoutMs?: number;
	verbose?: boolean;
	concurrency?: number;
	frozen?: boolean;
};

type UpdateDeps = {
	resolveRemoteCommit?: typeof resolveRemoteCommit;
	fetchSource?: typeof fetchSource;
	materializeSource?: typeof materializeSource;
};

const resolveSelectedSourceIds = async (options: UpdateOptions) => {
	const { sources } = await loadConfig(options.configPath);
	if (options.all) {
		return {
			selectedIds: sources.map((source) => source.id),
			missing: [] as string[],
		};
	}
	const existing = new Set(sources.map((source) => source.id));
	const selectedIds = options.ids.filter((id) => existing.has(id));
	const missing = options.ids.filter((id) => !existing.has(id));
	if (selectedIds.length === 0) {
		throw new Error("No matching sources found to update.");
	}
	return { selectedIds, missing };
};

export const updateSources = async (
	options: UpdateOptions,
	deps: UpdateDeps = {},
) => {
	if (!options.all && options.ids.length === 0) {
		throw new Error("Usage: docs-cache update <id...> [--all]");
	}
	const { selectedIds, missing } = await resolveSelectedSourceIds(options);
	const syncOptions = {
		configPath: options.configPath,
		cacheDirOverride: options.cacheDirOverride,
		json: options.json,
		lockOnly: options.lockOnly,
		offline: false,
		failOnMiss: options.failOnMiss,
		frozen: options.frozen,
		verbose: options.verbose,
		concurrency: options.concurrency,
		sourceFilter: selectedIds,
		timeoutMs: options.timeoutMs,
	};
	if (options.dryRun) {
		const plan = await getSyncPlan(syncOptions, deps);
		return {
			dryRun: true,
			missing,
			plan,
		};
	}
	const plan = await runSync(syncOptions, deps);
	return {
		dryRun: false,
		missing,
		plan,
	};
};
