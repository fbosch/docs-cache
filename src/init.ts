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
	DEFAULT_CONFIG_FILENAME,
	type DocsCacheConfig,
	stripDefaultConfigValues,
	writeConfig,
} from "./config";
import { ensureGitignoreEntry, getGitignoreStatus } from "./gitignore";

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
	const cacheDirValue = cacheDirAnswer || DEFAULT_CACHE_DIR;
	const indexAnswer = await confirm({
		message:
			"Generate index.json (summary of cached sources + paths for tools)",
		initialValue: false,
	});
	if (isCancel(indexAnswer)) {
		throw new Error("Init cancelled.");
	}
	const gitignoreStatus = await getGitignoreStatus(cwd, cacheDirValue);
	let gitignoreAnswer = false;
	if (gitignoreStatus.entry && !gitignoreStatus.hasEntry) {
		const reply = await confirm({
			message: "Add cache directory to .gitignore",
			initialValue: true,
		});
		if (isCancel(reply)) {
			throw new Error("Init cancelled.");
		}
		gitignoreAnswer = reply;
	}

	const answers = {
		configPath,
		cacheDir: cacheDirAnswer,
		index: indexAnswer,
		gitignore: gitignoreAnswer,
	} as {
		configPath: string;
		cacheDir: string;
		index: boolean;
		gitignore: boolean;
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
		const resolvedCacheDir = answers.cacheDir || DEFAULT_CACHE_DIR;
		if (resolvedCacheDir !== DEFAULT_CACHE_DIR) {
			baseConfig.cacheDir = resolvedCacheDir;
		}
		if (answers.index) {
			baseConfig.index = true;
		}
		pkg["docs-cache"] = stripDefaultConfigValues(baseConfig);
		await writeFile(
			resolvedConfigPath,
			`${JSON.stringify(pkg, null, 2)}\n`,
			"utf8",
		);
		const gitignoreResult = answers.gitignore
			? await ensureGitignoreEntry(
					path.dirname(resolvedConfigPath),
					resolvedCacheDir,
				)
			: null;
		return {
			configPath: resolvedConfigPath,
			created: true,
			gitignoreUpdated: gitignoreResult?.updated ?? false,
			gitignorePath: gitignoreResult?.gitignorePath ?? null,
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
	const resolvedCacheDir = answers.cacheDir || DEFAULT_CACHE_DIR;
	if (resolvedCacheDir !== DEFAULT_CACHE_DIR) {
		config.cacheDir = resolvedCacheDir;
	}
	if (answers.index) {
		config.index = true;
	}

	await writeConfig(resolvedConfigPath, config);
	const gitignoreResult = answers.gitignore
		? await ensureGitignoreEntry(
				path.dirname(resolvedConfigPath),
				resolvedCacheDir,
			)
		: null;
	return {
		configPath: resolvedConfigPath,
		created: true,
		gitignoreUpdated: gitignoreResult?.updated ?? false,
		gitignorePath: gitignoreResult?.gitignorePath ?? null,
	};
};
