import { access } from "node:fs/promises";
import path from "node:path";

const exists = async (filePath: string) => {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
};

const configFilesIn = (directory: string) => [
	path.join(directory, "opencode.jsonc"),
	path.join(directory, "opencode.json"),
];

const isProjectConfigDisabled = () => {
	const value = process.env.OPENCODE_DISABLE_PROJECT_CONFIG;
	return value === "true" || value === "1";
};

const findProjectRoot = async (startDir: string) => {
	let directory = path.resolve(startDir);
	while (true) {
		if (await exists(path.join(directory, ".git"))) {
			return directory;
		}
		const parent = path.dirname(directory);
		if (parent === directory) {
			return path.resolve(startDir);
		}
		directory = parent;
	}
};

const projectDirectories = (rootDir: string, startDir: string) => {
	const directories: string[] = [];
	let directory = path.resolve(startDir);
	while (true) {
		directories.push(directory);
		if (directory === rootDir) {
			return directories.reverse();
		}
		directory = path.dirname(directory);
	}
};

const projectConfigCandidates = async (startDir: string) => {
	const rootDir = await findProjectRoot(startDir);
	const directories = projectDirectories(rootDir, path.resolve(startDir));
	return [
		...directories.flatMap(configFilesIn),
		...[...directories]
			.reverse()
			.flatMap((directory) => configFilesIn(path.join(directory, ".opencode"))),
	];
};

export const getOpenCodeConfigCandidates = async (startDir: string) => {
	if (isProjectConfigDisabled()) {
		return [];
	}
	return projectConfigCandidates(startDir);
};

export const detectOpenCodeConfig = async (startDir: string) => {
	const candidates = await getOpenCodeConfigCandidates(startDir);
	let detected: string | null = null;
	for (const candidate of candidates) {
		if (await exists(candidate)) {
			detected = candidate;
		}
	}
	return detected;
};
