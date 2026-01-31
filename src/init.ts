import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { confirm, isCancel, select, text } from "@clack/prompts";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	DEFAULT_CONFIG_FILENAME,
	resolveConfigPath,
	writeConfig,
} from "./config";

type InitOptions = {
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

export const initConfig = async (options: InitOptions) => {
	const defaults = {
		ref: DEFAULT_CONFIG.defaults?.ref ?? "HEAD",
		targetMode:
			DEFAULT_CONFIG.defaults?.targetMode ??
			(process.platform === "win32" ? "copy" : "symlink"),
		allowHosts: DEFAULT_CONFIG.defaults?.allowHosts ?? [
			"github.com",
			"gitlab.com",
		],
	};
	const defaultConfigPath = path.resolve(
		process.cwd(),
		DEFAULT_CONFIG_FILENAME,
	);
	const packagePath = path.resolve(process.cwd(), "package.json");
	const existingConfigPaths: string[] = [];
	if (await exists(defaultConfigPath)) {
		existingConfigPaths.push(defaultConfigPath);
	}
	if (await exists(packagePath)) {
		const raw = await readFile(packagePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (parsed["docs-cache"]) {
			existingConfigPaths.push(packagePath);
		}
	}
	if (existingConfigPaths.length > 0) {
		throw new Error(
			`Config already exists at ${existingConfigPaths.join(", ")}. Init aborted.`,
		);
	}
	let usePackageConfig = false;
	if (!options.configPath && (await exists(packagePath))) {
		const raw = await readFile(packagePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!parsed["docs-cache"]) {
			const locationAnswer = await select({
				message: "Config location",
				options: [
					{ value: "config", label: "docs.config.json" },
					{ value: "package", label: "package.json" },
				],
				initialValue: "config",
			});
			if (isCancel(locationAnswer)) {
				throw new Error("Init cancelled.");
			}
			usePackageConfig = locationAnswer === "package";
		}
	}
	const configPath = options.configPath
		? resolveConfigPath(options.configPath)
		: usePackageConfig
			? packagePath
			: defaultConfigPath;
	const cacheDir = options.cacheDirOverride ?? DEFAULT_CACHE_DIR;

	const configPathAnswer = usePackageConfig
		? configPath
		: await text({
				message: "Config path",
				initialValue: configPath,
			});
	if (!usePackageConfig && isCancel(configPathAnswer)) {
		throw new Error("Init cancelled.");
	}
	const cacheDirAnswer = await text({
		message: "Cache directory",
		initialValue: cacheDir,
	});
	if (isCancel(cacheDirAnswer)) {
		throw new Error("Init cancelled.");
	}
	const indexAnswer = await confirm({
		message:
			"Generate index.json (summary of cached sources + paths for tools)",
		initialValue: false,
	});
	if (isCancel(indexAnswer)) {
		throw new Error("Init cancelled.");
	}

	const answers = {
		configPath: configPathAnswer,
		cacheDir: cacheDirAnswer,
		index: indexAnswer,
	} as {
		configPath: string;
		cacheDir: string;
		index: boolean;
	};

	const resolvedConfigPath = resolveConfigPath(answers.configPath);
	if (path.basename(resolvedConfigPath) === "package.json") {
		const raw = await readFile(resolvedConfigPath, "utf8");
		const pkg = JSON.parse(raw) as Record<string, unknown>;
		if (pkg["docs-cache"]) {
			throw new Error(
				`docs-cache config already exists in ${resolvedConfigPath}.`,
			);
		}
		pkg["docs-cache"] = {
			$schema:
				"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
			cacheDir: answers.cacheDir || DEFAULT_CACHE_DIR,
			index: answers.index,
			sources: [],
		};
		await writeFile(
			resolvedConfigPath,
			`${JSON.stringify(pkg, null, 2)}\n`,
			"utf8",
		);
		return {
			configPath: resolvedConfigPath,
			created: true,
		};
	}
	if (await exists(resolvedConfigPath)) {
		throw new Error(`Config already exists at ${resolvedConfigPath}.`);
	}
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		cacheDir: answers.cacheDir || DEFAULT_CACHE_DIR,
		index: answers.index,
		sources: [],
	};

	await writeConfig(resolvedConfigPath, config);
	return {
		configPath: resolvedConfigPath,
		created: true,
	};
};
