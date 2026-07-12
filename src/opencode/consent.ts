import path from "node:path";
import { type DocsCacheOpenCode, validateConfig } from "#config";
import {
	mergeConfigBase,
	readConfigAtPath,
	resolveConfigTarget,
	writeConfigFile,
} from "#config/io";

export const saveOpenCodeConsent = async (params: {
	configPath?: string;
	opencode: DocsCacheOpenCode;
}) => {
	const target = await resolveConfigTarget(params.configPath);
	const { config, rawConfig, rawPackage } = await readConfigAtPath(target);
	const nextConfig = mergeConfigBase(rawConfig ?? config, config.sources);
	nextConfig.opencode = params.opencode;
	validateConfig(nextConfig);
	await writeConfigFile({
		mode: target.mode,
		resolvedPath: target.resolvedPath,
		config: nextConfig,
		rawPackage,
	});
	return path.resolve(target.resolvedPath);
};
