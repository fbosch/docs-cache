import { access, readFile } from "node:fs/promises";

import {
	DEFAULT_CONFIG,
	resolveConfigPath,
	validateConfig,
	writeConfig,
} from "./config";

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const addSource = async (params: {
	configPath?: string;
	id: string;
	repo: string;
}) => {
	const resolvedPath = resolveConfigPath(params.configPath);
	let config = DEFAULT_CONFIG;
	if (await exists(resolvedPath)) {
		const raw = await readFile(resolvedPath, "utf8");
		config = validateConfig(JSON.parse(raw.toString()));
	}

	if (config.sources.some((source) => source.id === params.id)) {
		throw new Error(`Source '${params.id}' already exists in config.`);
	}

	config.sources = [
		...config.sources,
		{
			id: params.id,
			repo: params.repo,
		},
	];

	await writeConfig(resolvedPath, config);

	return {
		configPath: resolvedPath,
		sourceId: params.id,
		sourceRepo: params.repo,
		created: true,
	};
};
