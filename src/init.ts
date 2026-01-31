import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	confirm as clackConfirm,
	isCancel as clackIsCancel,
	select as clackSelect,
	text as clackText,
} from "@clack/prompts";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_CONFIG,
	DEFAULT_CONFIG_FILENAME,
	type DocsCacheConfig,
	resolveConfigPath,
	writeConfig,
} from "./config";

type InitOptions = {
	cacheDirOverride?: string;
	json: boolean;
	cwd?: string;
};

type PromptDeps = {
	confirm?: typeof clackConfirm;
	isCancel?: typeof clackIsCancel;
	select?: typeof clackSelect;
	text?: typeof clackText;
};

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const initConfig = async (
	options: InitOptions,
	deps: PromptDeps = {},
) => {
	const confirm = deps.confirm ?? clackConfirm;
	const isCancel = deps.isCancel ?? clackIsCancel;
	const select = deps.select ?? clackSelect;
	const text = deps.text ?? clackText;
	const cwd = options.cwd ?? process.cwd();
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
	const defaultConfigPath = path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
	const packagePath = path.resolve(cwd, "package.json");
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
	if (await exists(packagePath)) {
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
	const configPath = usePackageConfig ? packagePath : defaultConfigPath;
	const cacheDir = options.cacheDirOverride ?? DEFAULT_CACHE_DIR;
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
		configPath,
		cacheDir: cacheDirAnswer,
		index: indexAnswer,
	} as {
		configPath: string;
		cacheDir: string;
		index: boolean;
	};

	const resolvedConfigPath = path.resolve(cwd, answers.configPath);
	if (path.basename(resolvedConfigPath) === "package.json") {
		const raw = await readFile(resolvedConfigPath, "utf8");
		const pkg = JSON.parse(raw) as Record<string, unknown>;
		if (pkg["docs-cache"]) {
			throw new Error(
				`docs-cache config already exists in ${resolvedConfigPath}.`,
			);
		}
		const baseConfig: DocsCacheConfig = {
			$schema:
				"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
			sources: [],
		};
		const cacheDirValue = answers.cacheDir || DEFAULT_CACHE_DIR;
		if (cacheDirValue !== DEFAULT_CACHE_DIR) {
			baseConfig.cacheDir = cacheDirValue;
		}
		if (answers.index) {
			baseConfig.index = true;
		}
		pkg["docs-cache"] = baseConfig;
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
	const config: DocsCacheConfig = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [],
	};
	const cacheDirValue = answers.cacheDir || DEFAULT_CACHE_DIR;
	if (cacheDirValue !== DEFAULT_CACHE_DIR) {
		config.cacheDir = cacheDirValue;
	}
	if (answers.index) {
		config.index = true;
	}

	await writeConfig(resolvedConfigPath, config);
	return {
		configPath: resolvedConfigPath,
		created: true,
	};
};
