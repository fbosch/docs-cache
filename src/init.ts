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

const readJson = async (filePath: string) => {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(raw) as Record<string, unknown>;
};

const findExistingConfigPaths = async (cwd: string) => {
	const defaultConfigPath = path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
	const packagePath = path.resolve(cwd, "package.json");
	const existingConfigPaths: string[] = [];
	if (await exists(defaultConfigPath)) {
		existingConfigPaths.push(defaultConfigPath);
	}
	if (await exists(packagePath)) {
		const parsed = await readJson(packagePath);
		if (parsed["docs-cache"]) {
			existingConfigPaths.push(packagePath);
		}
	}
	return { existingConfigPaths, defaultConfigPath, packagePath };
};

const selectConfigPath = async (
	packagePath: string,
	defaultConfigPath: string,
	select: typeof clackSelect,
	isCancel: typeof clackIsCancel,
) => {
	if (!(await exists(packagePath))) {
		return defaultConfigPath;
	}
	const parsed = await readJson(packagePath);
	if (parsed["docs-cache"]) {
		return defaultConfigPath;
	}
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
	return locationAnswer === "package" ? packagePath : defaultConfigPath;
};

const promptInitAnswers = async (
	cacheDir: string,
	cwd: string,
	confirm: typeof clackConfirm,
	text: typeof clackText,
	isCancel: typeof clackIsCancel,
) => {
	const cacheDirAnswer = await text({
		message: "Cache directory",
		initialValue: cacheDir,
	});
	if (isCancel(cacheDirAnswer)) {
		throw new Error("Init cancelled.");
	}
	const cacheDirValue = cacheDirAnswer || DEFAULT_CACHE_DIR;
	const tocAnswer = await confirm({
		message:
			"Generate TOC.md (table of contents with links to all documentation)",
		initialValue: true,
	});
	if (isCancel(tocAnswer)) {
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
	return {
		cacheDir: cacheDirValue,
		toc: tocAnswer,
		gitignore: gitignoreAnswer,
	};
};

const buildBaseConfig = (cacheDir: string, toc: boolean): DocsCacheConfig => {
	const config: DocsCacheConfig = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [],
	};
	if (cacheDir !== DEFAULT_CACHE_DIR) {
		config.cacheDir = cacheDir;
	}
	if (!toc) {
		config.defaults = { toc: false };
	}
	return config;
};

const writePackageConfig = async (
	configPath: string,
	config: DocsCacheConfig,
	gitignore: boolean,
) => {
	const raw = await readFile(configPath, "utf8");
	const pkg = JSON.parse(raw) as Record<string, unknown>;
	if (pkg["docs-cache"]) {
		throw new Error(`docs-cache config already exists in ${configPath}.`);
	}
	pkg["docs-cache"] = stripDefaultConfigValues(config);
	await writeFile(configPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
	const gitignoreResult = gitignore
		? await ensureGitignoreEntry(
				path.dirname(configPath),
				config.cacheDir ?? DEFAULT_CACHE_DIR,
			)
		: null;
	return {
		configPath,
		created: true,
		gitignoreUpdated: gitignoreResult?.updated ?? false,
		gitignorePath: gitignoreResult?.gitignorePath ?? null,
	};
};

const writeStandaloneConfig = async (
	configPath: string,
	config: DocsCacheConfig,
	gitignore: boolean,
) => {
	await writeConfig(configPath, config);
	const gitignoreResult = gitignore
		? await ensureGitignoreEntry(
				path.dirname(configPath),
				config.cacheDir ?? DEFAULT_CACHE_DIR,
			)
		: null;
	return {
		configPath,
		created: true,
		gitignoreUpdated: gitignoreResult?.updated ?? false,
		gitignorePath: gitignoreResult?.gitignorePath ?? null,
	};
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
	const { existingConfigPaths, defaultConfigPath, packagePath } =
		await findExistingConfigPaths(cwd);
	if (existingConfigPaths.length > 0) {
		throw new Error(
			`Config already exists at ${existingConfigPaths.join(", ")}. Init aborted.`,
		);
	}
	const configPath = await selectConfigPath(
		packagePath,
		defaultConfigPath,
		select,
		isCancel,
	);
	const cacheDir = options.cacheDirOverride ?? DEFAULT_CACHE_DIR;
	const answers = await promptInitAnswers(
		cacheDir,
		cwd,
		confirm,
		text,
		isCancel,
	);
	const resolvedConfigPath = path.resolve(cwd, configPath);
	const config = buildBaseConfig(answers.cacheDir, answers.toc);
	if (path.basename(resolvedConfigPath) === "package.json") {
		return writePackageConfig(resolvedConfigPath, config, answers.gitignore);
	}
	if (await exists(resolvedConfigPath)) {
		throw new Error(`Config already exists at ${resolvedConfigPath}.`);
	}
	return writeStandaloneConfig(resolvedConfigPath, config, answers.gitignore);
};
