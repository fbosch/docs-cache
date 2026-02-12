import { resolveSources } from "#config";
import {
	mergeConfigBase,
	readConfigAtPath,
	resolveConfigTarget,
	writeConfigFile,
} from "#config/io";
import { resolveRemoteCommit } from "#git/resolve-remote";

const DEFAULT_ALLOW_HOSTS = ["github.com", "gitlab.com", "visualstudio.com"];

const isPinnedCommitRef = (ref: string) => /^[0-9a-f]{40}$/i.test(ref.trim());

type PinParams = {
	configPath?: string;
	ids: string[];
	all: boolean;
	dryRun?: boolean;
	timeoutMs?: number;
};

type PinDeps = {
	resolveRemoteCommit?: typeof resolveRemoteCommit;
};

type PinResultEntry = {
	id: string;
	fromRef: string;
	toRef: string;
	repo: string;
};

export const pinSources = async (params: PinParams, deps: PinDeps = {}) => {
	if (!params.all && params.ids.length === 0) {
		throw new Error("Usage: docs-cache pin <id...> [--all]");
	}

	const target = await resolveConfigTarget(params.configPath);
	const resolvedPath = target.resolvedPath;
	const { config, rawConfig, rawPackage } = await readConfigAtPath(target);

	const selectedIds = params.all
		? new Set(config.sources.map((source) => source.id))
		: new Set(params.ids);
	const missing = params.all
		? []
		: params.ids.filter(
				(id) => !config.sources.some((source) => source.id === id),
			);

	if (!params.all && selectedIds.size === 0) {
		throw new Error("No source ids provided to pin.");
	}

	const resolvedSources = resolveSources(config);
	const resolvedById = new Map(
		resolvedSources.map((source) => [source.id, source]),
	);
	const allowHosts = config.defaults?.allowHosts ?? DEFAULT_ALLOW_HOSTS;
	const resolveCommit = deps.resolveRemoteCommit ?? resolveRemoteCommit;

	const entriesById = new Map<string, PinResultEntry>();
	for (const source of config.sources) {
		if (!selectedIds.has(source.id)) {
			continue;
		}
		const resolved = resolvedById.get(source.id);
		if (!resolved) {
			continue;
		}
		const fromRef = source.ref ?? resolved.ref;
		if (isPinnedCommitRef(fromRef)) {
			entriesById.set(source.id, {
				id: source.id,
				fromRef,
				toRef: fromRef,
				repo: resolved.repo,
			});
			continue;
		}
		const remote = await resolveCommit({
			repo: resolved.repo,
			ref: resolved.ref,
			allowHosts,
			timeoutMs: params.timeoutMs,
		});
		entriesById.set(source.id, {
			id: source.id,
			fromRef,
			toRef: remote.resolvedCommit,
			repo: remote.repo,
		});
	}

	if (entriesById.size === 0) {
		throw new Error("No matching sources found to pin.");
	}

	const nextSources = config.sources.map((source) => {
		const pin = entriesById.get(source.id);
		if (!pin) {
			return source;
		}
		if (source.ref === pin.toRef) {
			return source;
		}
		return {
			...source,
			ref: pin.toRef,
		};
	});

	if (!params.dryRun) {
		const nextConfig = mergeConfigBase(rawConfig ?? config, nextSources);
		await writeConfigFile({
			mode: target.mode,
			resolvedPath,
			config: nextConfig,
			rawPackage,
		});
	}

	const pinned = Array.from(entriesById.values());
	const updated = pinned.filter((entry) => entry.fromRef !== entry.toRef);
	const unchanged = pinned
		.filter((entry) => entry.fromRef === entry.toRef)
		.map((entry) => entry.id);

	return {
		configPath: resolvedPath,
		dryRun: Boolean(params.dryRun),
		pinned,
		updated,
		unchanged,
		missing,
	};
};
