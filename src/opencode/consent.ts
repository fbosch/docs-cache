import path from "node:path";
import { type DocsCacheOpenCode, validateConfig } from "#config";
import {
	mergeConfigBase,
	readConfigAtPath,
	resolveConfigTarget,
	writeConfigFile,
} from "#config/io";
import { getProjectOpenCodeConfigPath } from "#opencode/references";

export const saveOpenCodeConsent = async (params: {
	configPath?: string;
	opencode: DocsCacheOpenCode;
}) => {
	const target = await resolveConfigTarget(params.configPath);
	const { config, rawConfig, rawPackage } = await readConfigAtPath(target);
	const nextConfig = mergeConfigBase(rawConfig ?? config, config.sources);
	if (params.opencode === false) {
		nextConfig.opencode = false;
	} else {
		const openCodeConfigPath = getProjectOpenCodeConfigPath(
			target.resolvedPath,
			params.opencode.configPath,
		);
		if (!openCodeConfigPath) {
			throw new Error(
				`OpenCode config at ${params.opencode.configPath} must be within the docs-cache project.`,
			);
		}
		nextConfig.opencode = { configPath: openCodeConfigPath };
	}
	validateConfig(nextConfig);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath: target.resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	return path.resolve(target.resolvedPath);
};
